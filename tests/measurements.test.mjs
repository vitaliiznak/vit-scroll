import test from "node:test";
import assert from "node:assert/strict";
import { caseOutcome, explainError } from "../src/measurements.mjs";

test("resource stops, crashes and completed correctness failures remain distinct", () => {
  assert.deepEqual(caseOutcome({ status: "resource-budget", lastStage: "mount", elapsedMs: 1500 }), { label: "Memory budget reached", detail: "mount · 1.5s" });
  assert.equal(caseOutcome({ status: "renderer-crash", lastStage: "local-scroll" }).label, "Browser renderer crashed");
  const outcome = caseOutcome({ status: "completed", seeks: [{ index: 25, reached: false }], nativeEnd: { last: 9, lastRowVisible: false } });
  assert.equal(outcome.label, "Checks failed");
  assert.match(outcome.detail, /row 26/);
  assert.match(outcome.detail, /row 10/);
  assert.equal(caseOutcome({ status: "completed", scroll: { invalidFrames: [1] } }).label, "Checks failed");
  assert.equal(caseOutcome({ status: "resource-budget", lastStage: "mount", elapsedMs: 2200, stop: { elapsedMs: 1500 }, error: "Browser shutdown logs" }).detail, "mount · 1.5s");
  assert.equal(caseOutcome({ status: "error", lastStage: "mount", error: "Actual cause\nVerbose browser logs" }).detail, "mount · Actual cause");
});

test("a stopped pass names the page error before the harness error that followed", () => {
  const run = {
    status: "error",
    lastStage: "local-scroll",
    errors: ["Minified React error #185; visit https://react.dev/errors/185"],
    error: "page.evaluate: Error: The list unmounted itself; see page errors.\n    at stack",
  };
  assert.equal(
    caseOutcome(run).detail,
    "local-scroll · React #185: maximum update depth exceeded → page.evaluate: Error: The list unmounted itself; see page errors.",
  );
  assert.equal(explainError("Plain error\nstack"), "Plain error");
});
