import test from "node:test";
import assert from "node:assert/strict";
import { rowSize, rowOffset, unsupportedReason } from "../src/row-scenario.mjs";
import { parseOptions } from "../scripts/bench-options.mjs";
import { slimCase, summarizeGroup } from "../src/bench-results.mjs";

test("dynamic logical offsets match content including expansion and width changes", () => {
  for (const expanded of [false, true]) for (const narrow of [false, true]) {
    const options = { expanded, narrow };
    let total = 0;
    for (let index = 0; index < 1000; index++) {
      assert.equal(rowOffset(index, options), total);
      total += rowSize(index, options);
    }
    assert.equal(rowOffset(100_000_000, options), 6_200_000_000 + (expanded ? 640_000_000 : 0) + (narrow ? 2_400_000_000 : 0));
  }
});

test("100M is accepted in both row modes; mistyped modes are rejected", () => {
  for (const rowMode of ["fixed", "dynamic"]) {
    const options = parseOptions(["--row-mode", rowMode, "--rows", "100000000"]);
    assert.equal(options.rowMode, rowMode);
    assert.deepEqual(options.counts, [100_000_000]);
  }
  assert.throws(() => parseOptions(["--row-mode", "dynamics"]), /row-mode/);
  assert.equal(unsupportedReason("ag", "fixed"), null);
  assert.equal(unsupportedReason("ag", "dynamic"), null);
});

test("unsupported configurations cannot be counted as failures or successful measurements", () => {
  const slim = slimCase({ engine: "vit", rowMode: "dynamic", status: "unsupported", reason: unsupportedReason("vit", "dynamic") });
  const summary = summarizeGroup([slim]);
  assert.equal(summary.verdict, "unsupported");
  assert.equal(summary.mountMs, null);
  assert.equal(summary.peakRssMiB, null);
  assert.match(summary.details[0], /fixed-height/);
});

test("a failed height change fails a completed case even if all navigation succeeded", () => {
  const raw = { status: "completed", rowMode: "dynamic", seeks: [{ index: 999, reached: true }], nativeEnd: { lastRowVisible: true }, dynamicChecks: [{ name: "expand", passed: false, anchorDriftPx: 64 }] };
  const summary = summarizeGroup([slimCase(raw)]);
  assert.equal(summary.verdict, "fail");
  assert.match(summary.details[0], /expand/);
  assert.deepEqual(summary.dynamic, { passed: 0, checked: 1 });
  assert.equal(slimCase(raw).dynamicChecks[0].anchorDriftPx, 64);
});
