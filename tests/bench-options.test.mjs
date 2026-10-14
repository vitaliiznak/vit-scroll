import test from "node:test";
import assert from "node:assert/strict";
import { parseOptions } from "../scripts/bench-options.mjs";
test("browser matrix and defaults expand to real library IDs", () => {
  const o = parseOptions(["--browser", "chromium,firefox,webkit"]);
  assert.deepEqual(o.browsers, ["chromium", "firefox", "webkit"]);
  // Eight libraries; TanStack adds a separate best-effort adapter.
  assert.equal(o.engines.length, 9);
  assert.deepEqual(o.counts, [100000, 1000000]);
  assert.equal(o.repetitions, 3);
});
test("memory rejects browsers without CDP and accepts isolated Chromium suite", () => {
  assert.throws(
    () => parseOptions(["--suite", "memory", "--browser", "firefox"]),
    /Chromium|chromium/,
  );
  assert.equal(parseOptions(["--suite", "memory"]).suite, "memory");
});
test("invalid and mistyped options fail before starting any expensive work", () => {
  for (const args of [
    ["--browser", "safari"],
    ["--rows", "0"],
    ["--rows", "NaN"],
    ["--rows", "100000001"],
    ["--repeats", "0"],
    ["--library", "unknown"],
    ["--browser"],
    ["--browsre", "chromium"],
  ])
    assert.throws(() => parseOptions(args));
});
test("results publish to the demo page unless --no-publish is passed", () => {
  assert.equal(parseOptions([]).publish, true);
  assert.equal(parseOptions(["--no-publish"]).publish, false);
});

test("default all suite schedules isolated heap passes only where supported", async () => {
  const { planRuns } = await import("../scripts/bench-options.mjs");
  const options = parseOptions(["--browser", "chromium,firefox,webkit"]);
  assert.equal(options.suite, "all");
  assert.deepEqual(planRuns(options), [
    { browser: "chromium", suite: "performance" },
    { browser: "chromium", suite: "memory" },
    { browser: "firefox", suite: "performance" },
    { browser: "webkit", suite: "performance" },
  ]);
});
