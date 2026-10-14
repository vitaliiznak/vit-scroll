import test from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTERS,
  ENGINES,
  adapterLabel,
  engineOf,
  selectAdapters,
} from "../src/engines.mjs";
import { parseOptions } from "../scripts/bench-options.mjs";
import { expectedStartTop, unsupportedReason } from "../src/row-scenario.mjs";
import { slimCase, summarizeGroup } from "../src/bench-results.mjs";
import { reportHtml } from "../scripts/bench-report.mjs";

test("every library has exactly one default and one best-effort adapter", () => {
  for (const { id } of ENGINES)
    for (const profile of ["default", "best-effort"])
      assert.equal(
        ADAPTERS.filter((a) => a.engine === id && a.profiles.includes(profile))
          .length,
        1,
        `${id} ${profile}`,
      );
  // Shared adapters must say why no option improves on the default.
  for (const a of ADAPTERS.filter((a) => a.profiles.includes("best-effort")))
    assert.ok(a.bestEffort, `${a.id} explains its best effort`);
});

test("profiles select adapters; library IDs expand and adapter IDs are exact", () => {
  const ids = ENGINES.map((e) => e.id);
  assert.deepEqual(parseOptions(["--profile", "default"]).engines, ids);
  assert.deepEqual(
    parseOptions(["--profile", "best-effort"]).engines,
    ids.map((id) => (id === "tanstack" ? "tanstack-scaled" : id)),
  );
  assert.deepEqual(
    parseOptions(["--library", "tanstack"]).engines,
    ["tanstack", "tanstack-scaled"],
  );
  assert.deepEqual(
    parseOptions(["--library", "tanstack", "--profile", "best-effort"]).engines,
    ["tanstack-scaled"],
  );
  assert.deepEqual(
    parseOptions(["--library", "vit,tanstack-scaled", "--profile", "default"])
      .engines,
    ["tanstack-scaled", "vit"],
  );
  // A published run's adapter list reproduces itself.
  const run = parseOptions(["--profile", "all"]);
  assert.deepEqual(selectAdapters(run.engines, run.profiles), run.engines);
  assert.throws(() => parseOptions(["--profile", "tuned"]), /profile/);
});

test("labels name the library and the setup; old results map to defaults", () => {
  assert.equal(engineOf("tanstack-scaled"), "tanstack");
  assert.equal(engineOf("tanstack"), "tanstack");
  assert.deepEqual(
    [adapterLabel("tanstack").profile, adapterLabel("tanstack-scaled").profile],
    ["Default", "Best effort"],
  );
  assert.equal(adapterLabel("vit").profile, "Default = best effort");
  assert.equal(adapterLabel("tanstack-scaled").name, "TanStack Virtual");
  assert.match(
    unsupportedReason("tanstack-scaled", "dynamic"),
    /fixed-height/,
  );
  assert.equal(unsupportedReason("tanstack-scaled", "fixed"), null);
});

test("start-aligned jumps expect the top, or the list end on the last screen", () => {
  const fixed = { count: 1000, viewportHeight: 360, rowHeight: 48 };
  assert.equal(expectedStartTop({ ...fixed, index: 0 }), 0);
  assert.equal(expectedStartTop({ ...fixed, index: 992 }), 0);
  // 7 rows (336px) remain: the list rests at its end, row 994 at 24px.
  assert.equal(expectedStartTop({ ...fixed, index: 993 }), 24);
  assert.equal(expectedStartTop({ ...fixed, index: 999 }), 312);
  // Dynamic heights cycle 32/48/72/96: the last row is 96px tall.
  assert.equal(
    expectedStartTop({
      index: 999,
      count: 1000,
      viewportHeight: 360,
      rowMode: "dynamic",
    }),
    264,
  );
});

test("a visible but misaligned jump fails the case; legacy seeks do not", () => {
  const raw = (seeks) => ({
    engine: "scaled",
    browser: "chromium",
    count: 1000,
    round: 0,
    status: "completed",
    errors: [],
    seeks,
  });
  const seek = (index, aligned, alignErrorPx) => ({
    index,
    reached: true,
    visibleMs: 4,
    aligned,
    alignErrorPx,
  });
  const off = summarizeGroup([
    slimCase(raw([seek(0, true, 0), seek(500, false, -143.2)])),
  ]);
  assert.equal(off.verdict, "fail");
  assert.deepEqual(
    { passed: off.alignment.passed, checked: off.alignment.checked },
    { passed: 1, checked: 2 },
  );
  assert.equal(off.alignment.worstPx, 143.2);
  assert.match(off.details.join(), /row 501 landed 143\.2 px above/);
  const legacy = summarizeGroup([
    slimCase(raw([{ index: 0, reached: true, visibleMs: 4 }])),
  ]);
  assert.equal(legacy.verdict, "pass");
  assert.deepEqual(legacy.alignment, { passed: 0, checked: 0, worstPx: null });
});

test("reports list each configuration and its alignment", () => {
  const pass = (engine) => ({
    browser: "chromium", engine, round: 0, count: 1000, status: "completed",
    suite: "performance", mount: { visibleMs: 10 }, errors: [],
    seeks: [{ index: 999, reached: true, visibleMs: 4, aligned: false, alignErrorPx: 6 }],
  });
  const html = reportHtml([{
    file: "chromium-performance.json",
    config: { suite: "performance", rowMode: "fixed" },
    adapters: ADAPTERS.filter((a) => ["tanstack", "tanstack-scaled"].includes(a.id)),
    cases: [pass("tanstack"), pass("tanstack-scaled")],
  }], "performance");
  assert.match(html, /Configurations measured/);
  assert.match(html, /observeElementOffset/);
  assert.match(html, /Best effort · Scaled coordinates/);
  assert.match(html, /worst 6\.0 px/);
  assert.ok(html.includes('id="m-aligned"') && html.includes('id="m-profile"'));
});

test("alignment is relative to where the list rests row 0", () => {
  // AG Grid rests row 0 1px below its viewport top; its scroll height grows by 1px.
  const ag = { count: 100000, viewportHeight: 360, rowHeight: 48, origin: 1 };
  assert.equal(expectedStartTop({ ...ag, index: 50000 }), 1);
  assert.equal(expectedStartTop({ ...ag, index: 99999 }), 312);
  // A list shorter than its viewport cannot scroll: rows stay in place.
  assert.equal(
    expectedStartTop({ index: 3, count: 5, viewportHeight: 360, origin: 1 }),
    145,
  );
});
