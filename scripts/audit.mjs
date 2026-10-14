import { fork } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { captureRunMetadata } from "./run-metadata.mjs";
// Spawned by scripts/bench.mjs, which builds and serves the site and sets
// every AUDIT_* variable. Run `npm run bench` instead of this file.
const browserName = process.env.AUDIT_BROWSER || "chromium";
const suite = process.env.AUDIT_SUITE || "performance";
import { ENGINES, adapterById, engineOf } from "../src/engines.mjs";
import { unsupportedReason, DYNAMIC_METHOD } from "../src/row-scenario.mjs";
const rowMode = process.env.AUDIT_ROW_MODE || "fixed";
if (!["fixed", "dynamic"].includes(rowMode)) throw new Error("Invalid AUDIT_ROW_MODE");
const base = process.env.AUDIT_URL;
const output = process.env.AUDIT_OUTPUT;
if (!base || !output) throw new Error("Run the benchmark with: npm run bench");
const counts = (process.env.AUDIT_COUNTS || "100000,1000000")
  .split(",")
  .map(Number);
const repetitions = Number(process.env.AUDIT_REPEATS || 3);
const ids = (
  process.env.AUDIT_ENGINES || ENGINES.map((e) => e.id).join(",")
).split(",");
const budgetMiB = 2048,
  deadlineMs = 25000;
const metadata = process.env.AUDIT_RUN_METADATA
  ? JSON.parse(fs.readFileSync(process.env.AUDIT_RUN_METADATA, "utf8"))
  : captureRunMetadata();
const report = {
  schema: "vit-scroll-isolated/1",
  startedAt: new Date().toISOString(),
  execution: metadata.execution,
  host: metadata.host,
  versions: ENGINES,
  // The exact setup behind every adapter ID; a result is never the library alone.
  adapters: ids.map((id) => ({ ...adapterById(id), id, engine: engineOf(id) })),
  config: {
    counts,
    repetitions,
    viewport: { width: 1100, height: 700 },
    rowHeight: 48,
    rowMode,
    rowScenario: rowMode === "dynamic" ? DYNAMIC_METHOD : "Fixed 48px rows; generated index data.",
    suite,
    heapLimitMiB: suite === "memory" ? 1024 : null,
    processRssBudgetMiB: budgetMiB,
    caseDeadlineMs: deadlineMs,
    production: true,
    scope: "container",
    browser: `${browserName} headless; fresh process for every case`,
    memory:
      "Process-tree RSS sampled every 200ms outside the browser, including shared pages; not unique physical memory. CDP heap/backing storage only in the memory suite. Memory suite forces GC at baseline, mounted, retained and cleanup checkpoints. Stage maximum is not a continuous heap peak.",
  },
  cases: [],
};
fs.mkdirSync(path.dirname(output), { recursive: true });
const save = () =>
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
function rssTree(root) {
  const processes = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number));
  const family = new Set([root]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [pid, ppid] of processes)
      if (family.has(ppid) && !family.has(pid)) {
        family.add(pid);
        changed = true;
      }
  }
  return (
    processes
      .filter(([pid]) => family.has(pid))
      .reduce((sum, p) => sum + p[2], 0) / 1024
  );
}
let current;
let stopping = false;
function interrupt() {
  if (stopping) return;
  stopping = true;
  save();
  const target = current;
  if (!target) process.exit(130);
  target.once("exit", () => process.exit(130));
  try {
    process.kill(-target.pid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-target.pid, "SIGKILL");
    } catch {}
    process.exit(130);
  }, 1500);
}
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
async function run(engine, count, round) {
  const reason = unsupportedReason(engine, rowMode);
  if (reason) return { engine, library: engineOf(engine), count, round, browser: browserName, suite, rowMode,
    status: "unsupported", lastStage: "capability", reason, elapsedMs: null,
    peakProcessRssMiB: null, seeks: [], errors: [] };
  return new Promise((resolve) => {
    const started = Date.now();
    let stage = "starting",
      partial = { engine, count, browser: browserName, suite, rowMode },
      result,
      limit,
      stopSample,
      baselineRssMiB,
      lastRssMiB,
      peak = 0,
      stderr = "";
    const rssSamples = [];
    const child = fork(
      new URL("./audit-worker.mjs", import.meta.url),
      [base, engine, String(count)],
      { detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    current = child;
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on("message", (m) => {
      if (m.type === "stage") {
        stage = m.stage;
        partial = m.result;
        fs.writeFileSync(
          output + ".partial.json",
          JSON.stringify({ stage, ...partial }),
        );
        if (stage === "mount" && baselineRssMiB == null) {
          try {
            baselineRssMiB = rssTree(child.pid);
          } catch {}
        }
      } else if (m.type === "result") result = m.result;
    });
    const stop = (reason) => {
      if (limit) return;
      limit = reason;
      stopSample = {
        reason,
        stage,
        elapsedMs: Date.now() - started,
        rssMiB: lastRssMiB ?? null,
      };
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 1200).unref();
    };
    const timer = setInterval(() => {
      try {
        lastRssMiB = rssTree(child.pid);
        peak = Math.max(peak, lastRssMiB);
        rssSamples.push({
          stage,
          elapsedMs: Date.now() - started,
          rssMiB: lastRssMiB,
        });
        if (peak > budgetMiB) stop("resource-budget");
      } catch {}
      if (Date.now() - started > deadlineMs) stop("timeout");
    }, 200);
    child.on("exit", (code, signal) => {
      clearInterval(timer);
      current = null;
      resolve({
        ...partial,
        ...result,
        engine,
        library: engineOf(engine),
        count,
        round,
        status:
          limit ||
          result?.status ||
          (partial.crashed ? "renderer-crash" : "worker-exit"),
        lastStage: stage,
        peakProcessRssMiB: peak,
        baselineProcessRssMiB: baselineRssMiB ?? null,
        lastProcessRssMiB: lastRssMiB ?? null,
        rssSamples,
        stop: stopSample ?? null,
        elapsedMs: Date.now() - started,
        exitCode: code,
        signal,
        ...(!result || result.status !== "completed" ? { stderr } : {}),
      });
    });
  });
}
for (const count of counts)
  for (let round = 0; round < repetitions; round++) {
    const order = [
      ...ids.slice(round % ids.length),
      ...ids.slice(0, round % ids.length),
    ];
    for (const engine of order) {
      console.log(`START ${count} ${round + 1}/${repetitions} ${engine}`);
      const r = await run(engine, count, round);
      report.cases.push(r);
      save();
      console.log(
        `DONE ${r.status} ${engine} · stage=${r.lastStage} · RSS=${r.peakProcessRssMiB == null ? "unavailable" : `${Math.round(r.peakProcessRssMiB)}MiB`} · jumps=${r.jumpPassed ?? "incomplete"} · aligned=${r.alignPassed ?? "incomplete"} · native=${r.nativePassed ?? "incomplete"} · height changes=${r.dynamicChecks?.filter((c) => c.passed).length ?? 0}/${r.dynamicChecks?.length ?? 0}`,
      );
    }
  }
fs.rmSync(output + ".partial.json", { force: true });
report.completedAt = new Date().toISOString();
save();
