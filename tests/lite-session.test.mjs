import test from "node:test";
import assert from "node:assert/strict";
import { liteFrame } from "../src/lite-session.mjs";

function frames(t) {
  const pending = new Map();
  const cancelled = [];
  let next = 0;
  for (const [name, value] of Object.entries({
    requestAnimationFrame: (callback) => { pending.set(++next, callback); return next; },
    cancelAnimationFrame: (id) => { cancelled.push(id); pending.delete(id); },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
  }
  return { pending, cancelled };
}

test("a hidden-tab stop cancels a suspended frame without waiting for another paint", async (t) => {
  const { pending, cancelled } = frames(t);
  const controller = new AbortController();
  const reason = new Error("Tab hidden");
  const wait = liteFrame(controller.signal);
  assert.equal(pending.size, 1);
  controller.abort(reason);
  await assert.rejects(wait, (error) => error === reason);
  assert.equal(pending.size, 0);
  assert.deepEqual(cancelled, [1]);
  await assert.rejects(liteFrame(controller.signal), (error) => error === reason);
  assert.equal(pending.size, 0, "An already stopped run never schedules more work");
});

test("completed frames release their abort listener", async (t) => {
  const { pending, cancelled } = frames(t);
  const controller = new AbortController();
  const wait = liteFrame(controller.signal);
  pending.get(1)(123);
  pending.delete(1);
  assert.equal(await wait, 123);
  controller.abort();
  assert.deepEqual(cancelled, [], "No stale callback fires after completion");
});
