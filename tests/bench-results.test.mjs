import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPublishedRun,
  pageDownResult,
  slimCase,
  summarizeGroup,
  summarizeRun,
  updateManifest,
} from "../src/bench-results.mjs";
import { findRunDirs, publishRun } from "../scripts/bench-publish.mjs";
import { explainError } from "../src/measurements.mjs";
import { MEASURES, describe } from "../src/bench-glossary.mjs";

const observation = (first, last, lastRowVisible = false) => ({
  first,
  last,
  visible: [first, last],
  overlap: false,
  gaps: false,
  lastRowVisible,
});
function rawCase(
  engine,
  round,
  { count = 1000, passed = true, status = "completed" } = {},
) {
  const seek = (index, reached) => ({
    index,
    reached,
    visibleMs: 5,
    observation: observation(index, index + 7),
  });
  return {
    engine,
    browser: "chromium",
    browserVersion: "149",
    count,
    round,
    status,
    lastStage: status === "completed" ? "unmount" : "local-scroll",
    elapsedMs: 1200,
    errors:
      status === "completed"
        ? []
        : ["Minified React error #185; visit https://react.dev/errors/185"],
    error:
      status === "completed"
        ? undefined
        : "page.evaluate: TypeError: x is null\n    at stack",
    mount:
      status === "completed"
        ? { visibleMs: 10 + round, synchronousCommitMs: 5 }
        : null,
    scroll:
      status === "completed" ? { invalidFrames: [], peakMounted: 20 } : null,
    seeks:
      status === "completed" ? [seek(0, true), seek(count - 1, passed)] : [],
    nativeEnd:
      status === "completed"
        ? observation(count - 8, passed ? count - 1 : 699, passed)
        : null,
    nativePassed: status === "completed" ? passed : undefined,
    jumpPassed: status === "completed" ? passed : undefined,
    wheel: { logicalPixels: 48 },
    longTasks: [{ start: 1, duration: 60 }],
    heapBefore: { usedSize: 4 * 1048576 },
    heapMountedGC: { usedSize: 5 * 1048576 },
    rssSamples: [{ stage: "mount", elapsedMs: 200, rssMiB: 500 }],
    peakProcessRssMiB: 512.4,
    environment: { userAgent: "HeadlessChrome/149", hardwareConcurrency: 8 },
  };
}

test("slim cases keep measurements, drop diagnostics, and never invent zero heap", () => {
  const slim = slimCase(rawCase("vit", 0));
  assert.equal(slim.rssSamples, undefined);
  assert.equal(slim.mount.visibleMs, 10);
  assert.deepEqual(slim.scroll, { invalidFrames: 0, peakMounted: 20 });
  // Raw runs recorded before the rename keep their scroll check.
  const { scroll, ...older } = rawCase("vit", 0);
  assert.deepEqual(slimCase({ ...older, pacing: { ...scroll, p95: 9 } }).scroll, slim.scroll);
  assert.equal(slim.heap.afterWork, null);
  assert.equal(slim.longTasks.count, 1);
  assert.equal(slim.outcome.label, "Checks passed");
  const stopped = slimCase(rawCase("rc", 0, { status: "error" }));
  assert.equal(stopped.error, "page.evaluate: TypeError: x is null");
  assert.deepEqual(stopped.pageErrors, [
    "React #185: maximum update depth exceeded",
  ]);
  // The page error is the cause; the harness error follows from it.
  assert.match(
    stopped.outcome.detail,
    /React #185: maximum update depth exceeded → page\.evaluate: TypeError/,
  );
  assert.equal(
    explainError("Minified React error #418; visit"),
    "React error #418",
  );
});

test("groups separate pass, failed checks, stopped passes and missing data", () => {
  const slim = (...args) => slimCase(rawCase(...args));
  const pass = summarizeGroup([slim("vit", 0), slim("vit", 1), slim("vit", 2)]);
  assert.equal(pass.verdict, "pass");
  assert.equal(pass.mountMs, 11);
  assert.deepEqual(pass.jumps, { passed: 6, checked: 6 });
  assert.equal(pass.heapMountedMiB, 1);
  assert.equal(pass.heapRetainedMiB, null);

  const fail = summarizeGroup([slim("window", 0, { passed: false })]);
  assert.equal(fail.verdict, "fail");
  assert.equal(fail.nativeStoppedAt, 699);
  assert.match(fail.details.join(), /First failed jump/);

  const stopped = summarizeGroup([
    slim("rc", 0),
    slim("rc", 1, { status: "error" }),
  ]);
  assert.equal(stopped.verdict, "error");
  assert.equal(stopped.completed, 1);
  assert.deepEqual(stopped.statuses, ["error"]);
  assert.equal(summarizeGroup([]).verdict, "none");
});

test("passes that disagree are flaky, not a plain failure", () => {
  const slim = (...args) => slimCase(rawCase(...args));
  const flaky = summarizeGroup([
    slim("ag", 0),
    slim("ag", 1, { passed: false }),
    slim("ag", 2),
  ]);
  assert.equal(flaky.verdict, "flaky");
  assert.equal(flaky.failedPasses, 1);
  const fail = summarizeGroup([
    slim("ag", 0, { passed: false }),
    slim("ag", 1, { passed: false }),
  ]);
  assert.equal(fail.verdict, "fail");
  // A stopped pass outranks disagreement among the rest.
  assert.equal(
    summarizeGroup([slim("ag", 0), slim("ag", 1, { passed: false }), slim("ag", 2, { status: "timeout" })]).verdict,
    "error",
  );
});

test("published runs report completeness and the manifest stays newest-first", () => {
  const options = {
    browsers: ["chromium"],
    suite: "performance",
    engines: ["vit", "rc"],
    counts: [1000],
    repetitions: 1,
  };
  const report = {
    startedAt: "2026-10-13T10:00:00Z",
    completedAt: "2026-10-13T10:01:00Z",
    config: { suite: "performance", counts: [1000] },
    cases: [rawCase("vit", 0), rawCase("rc", 0)],
  };
  const run = buildPublishedRun({
    id: "a",
    meta: { options, startedAt: report.startedAt },
    reports: [{ ...report, browser: "chromium" }],
  });
  assert.equal(run.complete, true);
  assert.equal(run.browsers[0].version, "149");
  assert.deepEqual(
    summarizeRun(run, "chromium", 1000).map((s) => s.verdict),
    ["pass", "pass"],
  );

  const partial = buildPublishedRun({
    id: "b",
    meta: { options: { ...options, browsers: ["chromium", "firefox"] } },
    reports: [{ ...report, browser: "chromium" }],
  });
  assert.equal(partial.complete, false);

  const older = { ...run, id: "old", startedAt: "2026-10-12T10:00:00Z" };
  let manifest = updateManifest(null, older);
  manifest = updateManifest(manifest, run);
  manifest = updateManifest(manifest, run);
  assert.deepEqual(
    manifest.runs.map((r) => r.id),
    ["a", "old"],
  );
  assert.deepEqual(
    updateManifest(manifest, { ...run, id: "c", startedAt: "2026-10-14" }, 2)
      .dropped,
    ["runs/old.json"],
  );
});

test("findRunDirs publishes every nested artifact and ignores other JSON", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-artifacts-"));
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-public-"));
  try {
    const write = (folder, id) => {
      const dir = path.join(root, folder, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "run.json"),
        JSON.stringify({
          startedAt: `2026-10-13T1${id.length}:00:00Z`,
          options: {
            browsers: ["chromium"],
            suite: "performance",
            engines: ["vit"],
            counts: [1000],
            repetitions: 1,
          },
        }),
      );
      fs.writeFileSync(
        path.join(dir, "chromium-performance.json"),
        JSON.stringify({
          completedAt: "2026-10-13T10:01:00Z",
          config: { suite: "performance" },
          cases: [rawCase("vit", 0)],
        }),
      );
      fs.mkdirSync(path.join(dir, "site"), { recursive: true });
      fs.writeFileSync(path.join(dir, "site", "chromium-performance.json"), "{}");
    };
    write("fixed/output/bench", "2026-10-13T10-00-00Z");
    write("dynamic/output/bench", "2026-10-13T11-00-00Z");
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.writeFileSync(path.join(root, "notes", "index.json"), "{}");
    const dirs = findRunDirs(root);
    assert.equal(dirs.length, 2);
    for (const dir of dirs) publishRun(dir, { publicDir });
    const index = JSON.parse(fs.readFileSync(path.join(publicDir, "index.json"), "utf8"));
    assert.equal(index.runs.length, 2);
    assert.deepEqual(
      index.runs.map((run) => run.id).sort(),
      dirs.map((dir) => `${path.basename(dir)}-performance`).sort(),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(publicDir, { recursive: true, force: true });
  }
});

test("publishRun turns an output/bench directory into page data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-out-"));
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-public-"));
  try {
    const options = {
      browsers: ["chromium"],
      suite: "performance",
      engines: ["vit"],
      counts: [1000],
      repetitions: 1,
    };
    fs.writeFileSync(
      path.join(dir, "run.json"),
      JSON.stringify({ startedAt: "2026-10-13T10:00:00Z", options,
        execution: { kind: "ci", provider: "github-actions", runId: "123" },
        host: { cpu: "Original CI CPU", cores: 4, memoryGiB: 16 },
      }),
    );
    fs.writeFileSync(
      path.join(dir, "chromium-performance.json"),
      JSON.stringify({
        completedAt: "2026-10-13T10:01:00Z",
        config: { suite: "performance" },
        cases: [rawCase("vit", 0)],
      }),
    );
    fs.writeFileSync(
      path.join(dir, "chromium-performance.json.partial.json"),
      "{}",
    );
    const run = publishRun(dir, { publicDir });
    const index = JSON.parse(
      fs.readFileSync(path.join(publicDir, "index.json"), "utf8"),
    );
    assert.equal(index.runs[0].id, run.id);
    assert.ok(run.id.endsWith("-performance"));
    const saved = JSON.parse(
      fs.readFileSync(path.join(publicDir, index.runs[0].file), "utf8"),
    );
    assert.equal(saved.cases.length, 1);
    assert.equal(saved.complete, true);
    assert.equal(saved.execution.provider, "github-actions");
    assert.equal(saved.host.cpu, "Original CI CPU");
    assert.equal(index.runs[0].execution.runId, "123");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(publicDir, { recursive: true, force: true });
  }
});

test("combined runs retain phase identity and count all planned cases", () => {
  const reports = ["performance", "memory"].map((suite) => ({
    browser: "chromium",
    config: { suite },
    completedAt: "2026-10-13",
    cases: [{ ...rawCase("vit", 0), suite }],
  }));
  const meta = {
    options: {
      suite: "all",
      browsers: ["chromium"],
      engines: ["vit"],
      counts: [1000],
      repetitions: 1,
    },
    plan: [
      { browser: "chromium", suite: "performance" },
      { browser: "chromium", suite: "memory" },
    ],
  };
  const run = buildPublishedRun({ id: "combined", meta, reports });
  assert.equal(run.complete, true);
  assert.equal(run.expectedCases, 2);
  assert.equal(run.browsers.length, 1);
  assert.deepEqual(
    run.cases.map((c) => c.suite),
    ["performance", "memory"],
  );
  assert.equal(
    buildPublishedRun({ id: "partial", meta, reports: reports.slice(0, 1) })
      .complete,
    false,
  );
});

test("groups summarise keyboard, resize and broken-frame checks per pass", () => {
  const withInput = (round, keyboard, resize) =>
    slimCase({ ...rawCase("vit", round), keyboard, resize });
  const after = (first) => ({ first, visible: [first], overlap: false, gaps: false });
  const s = summarizeGroup([
    withInput(0, { focused: true, afterPageDown: after(108) }, after(100)),
    withInput(1, { focused: true, afterPageDown: after(100) }, after(90)),
    withInput(2, { focused: false }, undefined),
  ]);
  assert.deepEqual(s.pageDown, { passed: 1, checked: 2, notFocusable: 1 });
  assert.deepEqual(s.resize, { passed: 1, checked: 2 });
  assert.equal(s.invalidFrames, 0);
  assert.equal(s.commitMs, 5);
  assert.equal(s.longTaskMs, 180);
  assert.equal(pageDownResult(slimCase(rawCase("vit", 0))), null);
});

test("every published measurement has a plain-language definition", () => {
  for (const [id, m] of Object.entries(MEASURES)) {
    assert.ok(m.label && m.what && m.how, `${id} needs label, what and how`);
  }
  assert.match(describe("dynamic"), /--row-mode dynamic/);
});
