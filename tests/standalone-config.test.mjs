import test from "node:test";
import assert from "node:assert/strict";
import { ENGINES } from "../src/engines.mjs";
import {
  readTableConfig,
  tableUrl,
  WINDOW_SUPPORT,
} from "../src/standalone-config.mjs";

test("standalone links preserve geometry and choose a supported default scroll mode", () => {
  for (const { id } of ENGINES) {
    assert.deepEqual(readTableConfig(tableUrl(id, 100_000, 48)), {
      engine: id,
      mode: WINDOW_SUPPORT[id] ? "window" : "container",
      count: 100_000,
      rowHeight: 48,
    });
  }
});

test("explicit window requests stay explicit so unsupported adapters can explain the limitation", () => {
  assert.equal(readTableConfig("?table=rc&scroll=window").mode, "window");
  assert.equal(readTableConfig("?table=vit").mode, "window");
});

test("unsafe or invalid deep links are rejected before an adapter can allocate", () => {
  for (const query of [
    "table=unknown",
    "table=vit&count=100000001",
    "table=rc&count=Infinity",
    "table=vit&count=-1",
    "table=vit&count=0",
    "table=vit&count=2.5",
    "table=vit&rowHeight=0",
    "table=vit&rowHeight=NaN",
    "table=vit&rowHeight=121",
    "table=vit&scroll=fake",
  ])
    assert.ok(readTableConfig(`?${query}`).error, query);
  assert.equal(
    readTableConfig("?table=vit&count=100000000").count,
    100_000_000,
  );
});

test("all libraries accept 100M without a library-specific restriction", () => {
  for (const { id } of ENGINES)
    assert.equal(
      readTableConfig(tableUrl(id, 100_000_000, 48)).count,
      100_000_000,
    );
});

test("full-height libraries stop at the browser height limit; compressed ones do not", async () => {
  const { reachability } = await import("../src/standalone-config.mjs");
  const limit = 33_554_428; // Chromium, measured
  // Measured: react-window, rc-virtual-list and virtua stop near row 699,050 at 48px.
  for (const id of ["window", "rc", "virtua"])
    assert.deepEqual(reachability(id, 1_000_000, 48, limit), {
      fails: true,
      total: 48_000_000,
      limit,
      lastRow: 699_050,
      hidden: 300_950,
    });
  // Page scroll also spends the content above the list (TanStack/Virtuoso: 699,047).
  assert.equal(reachability("tanstack", 1_000_000, 48, limit, 150).lastRow, 699_047);
  for (const id of ["scaled", "ag", "vit"])
    assert.equal(reachability(id, 100_000_000, 48, limit).fails, false);
  for (const { id } of ENGINES)
    assert.equal(reachability(id, 100_000, 48, limit).fails, false);
});
