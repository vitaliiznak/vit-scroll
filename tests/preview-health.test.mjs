import test from "node:test";
import assert from "node:assert/strict";
import { heapPressure, heapLabel, peakHeap, previewError, runLitePasses } from "../src/preview-health.mjs";

test("heap warnings have explicit thresholds; unavailable is never zero or safe", () => {
  for (const heap of [null, {}, { usedSize: 1 }, { usedSize: 1, heapLimit: 0 }, { usedSize: NaN, heapLimit: 10 }])
    assert.equal(heapPressure(heap).level, "unavailable");
  for (const [usedSize, level] of [[0, "normal"], [79, "normal"], [80, "warning"], [89, "warning"], [90, "critical"], [110, "critical"]])
    assert.equal(heapPressure({ usedSize, heapLimit: 100 }).level, level);
  assert.equal(heapLabel(null), "Unavailable in this browser");
  assert.match(heapLabel({ usedSize: 100 }), /limit unavailable/);
  assert.match(heapLabel({ usedSize: 80, heapLimit: 100 }), /80.0%/);
});

test("partial heap samples survive errors and missing later samples", () => {
  const sample = { usedSize: 80, heapLimit: 100 };
  assert.equal(peakHeap(null, null), null);
  assert.equal(peakHeap(sample, null), sample);
  assert.equal(peakHeap(sample, { usedSize: 30 }), sample);
  assert.equal(peakHeap(sample, { usedSize: 90 }).usedSize, 90);
});

test("one library failure preserves partial observations and other libraries still finish", async () => {
  const visits = [], results = [];
  const summary = await runLitePasses({
    targets: [{ id: "broken" }, { id: "good" }, { id: "also-good" }], repeats: 3,
    runPass: async (item, round) => {
      visits.push(`${item.id}:${round}`);
      if (item.id === "broken") {
        const error = previewError("Allocation failed");
        error.observations = { heapPeak: { usedSize: 80, heapLimit: 100 }, seeks: [{ target: 0, reached: true }] };
        throw error;
      }
      return { seeks: [{ target: 0, reached: true }] };
    },
    onResult: (result) => results.push(result),
  });
  assert.deepEqual(summary, { completed: 6, attempted: 7, total: 9, failed: 1, skipped: 2 });
  assert.equal(visits.filter((v) => v.startsWith("broken")).length, 1);
  assert.equal(results[0].heapPeak.usedSize, 80);
  assert.equal(results[0].seeks.length, 1);
  assert.equal(results[0].status, "error");
  assert.equal(results.filter((r) => r.engine === "also-good" && r.status === "completed").length, 3);
});

test("memory pressure and user stops prevent starting the next library", async () => {
  for (const status of ["resource-budget", "stopped"]) {
    let visits = 0;
    const results = [];
    const summary = await runLitePasses({
      targets: [{ id: "one" }, { id: "two" }], repeats: 3,
      runPass: async () => { visits++; throw previewError("Stop reason", status); },
      onResult: (result) => results.push(result),
    });
    assert.equal(visits, 1);
    assert.equal(summary.stopped, "Stop reason");
    assert.equal(results[0].status, status);
  }
});

test("a cooperative timeout is recorded separately and does not block another library", async () => {
  const results = [];
  await runLitePasses({
    targets: [{ id: "slow" }, { id: "good" }], repeats: 1,
    runPass: async ({ id }) => { if (id === "slow") throw previewError("Deadline", "timeout"); return {}; },
    onResult: (result) => results.push(result),
  });
  assert.deepEqual(results.map((r) => r.status), ["timeout", "completed"]);
});
