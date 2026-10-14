import test from "node:test";
import assert from "node:assert/strict";
import { createGeometry } from "../packages/vit-scroll/core.mjs";

test("the full logical range maps to a bounded scrollbar and back", () => {
  for (const count of [0, 1, 10_000, 1_000_000, 100_000_000]) {
    const g = createGeometry({ count, rowHeight: 48, viewportHeight: 360 });
    assert.ok(g.physical <= 8_000_000);
    for (const fraction of [0, 0.00001, 0.1, 0.5, 0.99999, 1]) {
      const top = fraction * g.logicalRange;
      assert.ok(Math.abs(g.toLogical(g.toPhysical(top)) - top) < 0.001);
      const r = g.range(top);
      assert.ok(r.end - r.first <= 21, "DOM window stays bounded");
      assert.ok(r.first >= 0 && r.end <= count);
    }
    assert.equal(g.range(g.logicalRange).end, count);
  }
});

test("last row remains inside viewport at the physical end", () => {
  const g = createGeometry({
    count: 100_000_000,
    rowHeight: 80,
    viewportHeight: 360,
  });
  const top = g.rowTop(g.count - 1, g.logicalRange, g.physicalRange);
  assert.equal(top - g.physicalRange, 280);
});

test("local wheel movement stays in logical pixels under compression", () => {
  const g = createGeometry({
    count: 100_000_000,
    rowHeight: 48,
    viewportHeight: 360,
  });
  const start = 2_000_000_000;
  const next = g.clamp(start + 48);
  assert.equal(next - start, 48);
  assert.ok(g.toPhysical(next) - g.toPhysical(start) < 1);
  assert.equal(g.clamp(-20), 0);
  assert.equal(g.clamp(g.total), g.logicalRange);
});

test("invalid geometry is rejected", () => {
  for (const count of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(
      () => createGeometry({ count, rowHeight: 48, viewportHeight: 360 }),
      RangeError,
    );
  }
  assert.throws(
    () => createGeometry({ count: 1, rowHeight: 0, viewportHeight: 360 }),
    RangeError,
  );
});

// Firefox collapses excessively tall elements while Chromium clamps them.
// Both must yield a usable measured cap rather than a zero-sized geometry.
test("height probe supports both clamping and zero-height overflow", async () => {
  const { probeHeightLimit } = await import("../packages/vit-scroll/core.mjs");
  const previous = globalThis.document;
  try {
    for (const mode of ["clamp", "collapse"]) {
      let removed = false;
      globalThis.document = {
        body: { append() {} },
        createElement() {
          return {
            style: {},
            append() {},
            remove() {
              removed = true;
            },
            scrollHeight: 16000000,
            scrollTop: 0,
            getBoundingClientRect() {
              const requested = Number.parseFloat(this.style.height);
              return {
                height:
                  requested <= 16000000
                    ? requested
                    : mode === "clamp"
                      ? 16000000
                      : 0,
              };
            },
          };
        },
      };
      assert.equal(probeHeightLimit().height, 16000000);
      assert.equal(removed, true);
    }
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
