import test from "node:test";
import assert from "node:assert/strict";
import { reportHtml } from "../scripts/bench-report.mjs";
test("combined report separates heap from timings and explains unavailable APIs", () => {
  const c = {
    engine: "vit",
    count: 1000,
    round: 0,
    status: "completed",
    seeks: [],
    errors: [],
    mount: { visibleMs: 12 },
    heapSamples: [],
  };
  const reports = [
    {
      file: "chromium-performance.json",
      config: { suite: "performance" },
      cases: [{ ...c, browser: "chromium", suite: "performance" }],
    },
    {
      file: "chromium-memory.json",
      config: { suite: "memory" },
      cases: [
        {
          ...c,
          browser: "chromium",
          suite: "memory",
          mount: { visibleMs: 9999 },
          heapBefore: { usedSize: 1048576 },
          heapMountedGC: { usedSize: 2097152 },
        },
      ],
    },
    {
      file: "firefox-performance.json",
      config: { suite: "performance" },
      cases: [{ ...c, browser: "firefox", error: "<script>unsafe</script>" }],
    },
  ];
  const html = reportHtml(reports, "all");
  assert(html.includes("Heap memory · separate passes"));
  assert(html.includes("unavailable through this runner"));
  assert(html.includes("12.0"));
  assert(!html.includes("9999"));
  assert(!html.includes("<script>unsafe"));
  assert(html.includes("&lt;script&gt;unsafe"));
});

test("dynamic reports name unsupported adapters and explain height failures", () => {
  const html = reportHtml([{
    file: "chromium-performance.json", config: { suite: "performance", rowMode: "dynamic", rowScenario: "Measured rows" },
    cases: [
      { browser: "chromium", engine: "vit", suite: "performance", count: 100000000, round: 0, status: "unsupported", reason: "Fixed-height prototype" },
      { browser: "chromium", engine: "window", suite: "performance", count: 100000000, round: 0, status: "completed", dynamicChecks: [{ name: "restore width", passed: false, heightChecks: true, anchorVisible: false }] },
    ],
  }], "performance");
  assert.match(html, /Row mode: dynamic/);
  assert.match(html, /Unsupported/);
  assert.match(html, /Fixed-height prototype/);
  assert.match(html, /anchor left viewport/);
  assert.match(html, /Height changes/);
});

test("reports group by browser or library, expand rows and explain every column", () => {
  const pass = (browser, engine, round) => ({
    browser, engine, round, count: 1000, status: "completed", suite: "performance",
    mount: { visibleMs: 10 }, seeks: [{ index: 0, reached: true, visibleMs: 4 }], errors: [],
  });
  const reports = ["chromium", "firefox"].map((browser) => ({
    file: `${browser}-performance.json`,
    config: { suite: "performance", rowMode: "fixed" },
    cases: [pass(browser, "vit", 0), pass(browser, "window", 0)],
  }));
  const html = reportHtml(reports, "performance");
  assert.match(html, /class="view view-browser"/);
  assert.match(html, /class="view view-library"/);
  assert.match(html, /aria-controls="browser-perf-1000-chromium-vit"/);
  assert.match(html, /aria-controls="library-perf-1000-firefox-window"/);
  // Every "?" points at a glossary entry that exists.
  const ids = new Set([...html.matchAll(/aria-describedby="(m-[a-zA-Z0-9]+)"/g)].map((m) => m[1]));
  assert.ok(ids.has("m-mount") && ids.has("m-invalidFrames"));
  // Frame intervals only measured the display refresh rate; they are not reported.
  assert.ok(![...ids].some((id) => id.startsWith("m-frame")));
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `${id} has a definition`);
  // Fixed-height runs never ran height-change checks, so no such column.
  assert.ok(!/<th scope="col"><span class="term">Height changes/.test(html));
});
