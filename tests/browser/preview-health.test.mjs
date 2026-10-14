import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ENGINES } from "../../src/engines.mjs";

const base = process.env.SCROLL_TEST_URL || "http://127.0.0.1:4173/";
const demo = new URL("demo.html", base).href;

test("large previews, memory warnings and recoverable comparison failures", { timeout: 180_000 }, async (t) => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addInitScript(() => {
      // Deterministic diagnostics: never exhaust the test machine's real heap.
      window.__testHeap = { usedJSHeapSize: 10 * 1024 ** 2, totalJSHeapSize: 100 * 1024 ** 2, jsHeapSizeLimit: 100 * 1024 ** 2 };
      Object.defineProperty(performance, "memory", { configurable: true, get: () => window.__testHeap });
      const from = Array.from;
      Array.from = function (data, ...args) {
        if (window.__failRc && data?.length === 10_000)
          throw new RangeError("Injected allocation failure");
        return from.call(this, data, ...args);
      };
    });
    const page = await context.newPage();
    const rows = page.locator(".viewport-shell [data-row-index]");
    const waitRows = () => rows.first().waitFor();
    const heap = async (percent) => {
      await page.evaluate((value) => { window.__testHeap.usedJSHeapSize = value * 1024 ** 2; }, percent);
    };

    await t.test("100M keeps every choice enabled and records a real react-window reach failure", async () => {
      await page.goto(demo);
      await page.getByRole("combobox", { name: "Number of rows" }).selectOption("100000000");
      assert.equal(await page.getByRole("radio").count(), ENGINES.length);
      assert.equal(await page.locator('input[name="library"]:disabled').count(), 0);
      await page.getByRole("radio", { name: "react-window", exact: true }).check();
      await waitRows();
      await page.getByRole("button", { name: "Check last row" }).click();
      await page.locator(".finding").filter({ hasText: "Row jump: failed" }).waitFor();
      assert.match(await page.locator('.library-table tr:has(input[value="window"])').innerText(), /Last-row checks failed/);
      await page.getByRole("radio", { name: "VitScroll", exact: true }).check();
      await waitRows();
      await page.getByRole("button", { name: "Check last row" }).click();
      await page.locator(".finding").filter({ hasText: "Row jump: passed" }).waitFor();
    });

    await t.test("80% warns, 90% unloads, and controls recover", async () => {
      await page.goto(demo);
      await waitRows();
      await heap(80);
      await page.locator(".heap-status.warning").waitFor();
      assert.match(await page.locator('.library-table tr:has(input[value="vit"])').innerText(), /Near memory limit/);
      await heap(90);
      await page.getByRole("alert").filter({ hasText: "Preview stopped near the page heap limit" }).waitFor();
      assert.equal(await rows.count(), 0);
      assert.equal(await page.getByRole("button", { name: "Check last row" }).isDisabled(), true);
      await heap(10);
      await page.getByRole("combobox", { name: "Number of rows" }).selectOption("10000");
      await waitRows();
      assert.equal(await page.getByRole("button", { name: "Check last row" }).isEnabled(), true);
    });

    await t.test("runtime allocation failure stays visible and another library can open", async () => {
      await page.goto(demo);
      await page.getByRole("combobox", { name: "Number of rows" }).selectOption("10000");
      await page.evaluate(() => { window.__failRc = true; });
      await page.getByRole("radio", { name: "rc-virtual-list", exact: true }).check();
      await page.getByRole("alert").filter({ hasText: "Injected allocation failure" }).waitFor();
      assert.match(await page.locator('.library-table tr:has(input[value="rc"])').innerText(), /Stopped[\s\S]*Injected allocation failure/);
      await page.getByRole("radio", { name: "VitScroll", exact: true }).check();
      await waitRows();
      assert.equal(await page.getByRole("alert").count(), 0);
    });

    await t.test("all-library comparison continues after a render failure and retains the reason", async () => {
      await page.goto(demo);
      await page.getByRole("combobox", { name: "Number of rows" }).selectOption("10000");
      await page.evaluate(() => { window.__failRc = true; });
      await page.getByRole("button", { name: `Run all ${ENGINES.length} libraries` }).click();
      await page.locator(".run-message").filter({ hasText: `${(ENGINES.length - 1) * 3} of ${ENGINES.length * 3} passes completed` }).waitFor({ timeout: 90_000 });
      const results = page.locator("#benchmark-lite .results-table tbody tr");
      assert.equal(await results.count(), ENGINES.length);
      assert.match(await results.filter({ hasText: "rc-virtual-list" }).innerText(), /0\/3[\s\S]*Runtime error[\s\S]*Injected allocation failure/);
      assert.match(await results.filter({ hasText: "VitScroll" }).innerText(), /3\/3[\s\S]*Checks passed/);
      await page.getByRole("alert").filter({ hasText: "Preview paused" }).waitFor();
      assert.equal(await rows.count(), 0);
      assert.equal(await page.locator("#root").evaluate((node) => node.inert), false);
    });

    await t.test("a run locks input, keeps Stop reachable, and cleans up before a rerun", async () => {
      await page.goto(demo);
      await page.getByRole("combobox", { name: "Number of rows" }).selectOption("10000");
      await page.getByRole("button", { name: "Run VitScroll only" }).click();
      await page.getByRole("dialog", { name: "Benchmark running · page locked" }).waitFor();
      await waitRows();
      assert.equal(await page.locator("#root").evaluate((node) => node.inert), true);
      const top = await page.evaluate(() => scrollY);
      await page.mouse.move(650, 400);
      await page.mouse.wheel(0, 500);
      await page.keyboard.press("PageDown");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.textContent), "Stop");
      assert.equal(await page.evaluate(() => scrollY), top);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.locator(".run-message").filter({ hasText: "Stopped by you" }).waitFor();
      assert.equal(await rows.count(), 0);
      assert.equal(await page.locator("#root").evaluate((node) => node.inert), false);
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "");
      assert.equal(await page.getByRole("combobox", { name: "Number of rows" }).isEnabled(), true);
      // The next run must start directly from the paused state too.
      await page.getByRole("button", { name: "Run VitScroll only" }).click();
      await page.locator(".run-message").filter({ hasText: "Complete · VitScroll" }).waitFor();
      assert.equal(await rows.count(), 0);
      assert.match(await page.locator("#benchmark-lite .results-table").innerText(), /3\/3/);
      await page.getByRole("button", { name: "Resume preview" }).click();
      await waitRows();
    });

    await t.test("hidden, unfocused and resized runs stop and restore the page", async () => {
      for (const change of ["hidden", "blur", "resize"]) {
        await page.goto(demo);
        await page.getByRole("combobox", { name: "Number of rows" }).selectOption("10000");
        await page.getByRole("button", { name: "Run VitScroll only" }).click();
        await waitRows();
        if (change === "resize") {
          await page.setViewportSize({ width: 1400, height: 1000 });
        } else {
          await page.evaluate((kind) => {
            if (kind === "hidden") {
              // Reproduce suspended rAF without hiding the test controller.
              window.requestAnimationFrame = () => 0;
              Object.defineProperty(document, "hidden", { configurable: true, value: true });
              document.dispatchEvent(new Event("visibilitychange"));
            } else window.dispatchEvent(new Event("blur"));
          }, change);
        }
        // Polling with timers works even when the simulated tab suspends rAF.
        await page.waitForFunction(() => document.querySelector(".run-message")?.textContent.includes("Stopped because"), null, { polling: 50 });
        assert.match(await page.locator(".run-message").innerText(), /tab was hidden|window lost focus|window size changed/);
        assert.equal(await rows.count(), 0);
        assert.equal(await page.locator(".run-guard").count(), 0);
        assert.equal(await page.locator("#root").evaluate((node) => node.inert), false);
        assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "");
      }
      await page.setViewportSize({ width: 1440, height: 1050 });
    });

    await t.test("memory stop preserves the sample and stops the whole comparison", async () => {
      await page.goto(demo);
      await page.getByRole("combobox", { name: "Number of rows" }).selectOption("10000");
      await page.getByRole("button", { name: `Run all ${ENGINES.length} libraries` }).click();
      await page.locator(".live-heading h3").filter({ hasText: "Running now" }).waitFor();
      await heap(91);
      await page.locator(".run-message").filter({ hasText: "Stopped near the page heap limit" }).waitFor();
      assert.equal(await page.locator(".lite-outcome").filter({ hasText: "Memory stop" }).count(), 1);
      assert.match(await page.locator(".heap-result.critical").innerText(), /91.0%[\s\S]*Near memory limit/);
      assert.ok(await page.locator(".lite-outcome").filter({ hasText: "Not run" }).count() > 0);
      assert.equal(await rows.count(), 0);
    });

    await t.test("unsupported memory remains unavailable in a completed result", async () => {
      await page.goto(demo);
      await page.evaluate(() => { window.__testHeap = undefined; });
      await page.getByRole("combobox", { name: "Number of rows" }).selectOption("10000");
      await page.getByRole("button", { name: "Run VitScroll only" }).click();
      await page.locator(".run-message").filter({ hasText: "Complete · VitScroll" }).waitFor();
      assert.match(await page.locator(".heap-result").innerText(), /Unavailable in this browser/);
      assert.equal(await page.locator(".heap-result.warning, .heap-result.critical").count(), 0);
    });

    await t.test("standalone table reports memory pressure and unloads its rows", async () => {
      await page.goto(new URL("demo.html?table=vit&scroll=container&count=100000&rowHeight=48", base).href);
      await waitRows();
      await heap(80);
      await page.locator(".heap-status.warning").waitFor();
      await heap(90);
      await page.getByRole("alert").filter({ hasText: "Preview stopped" }).waitFor();
      assert.equal(await rows.count(), 0);
      assert.equal(await page.getByRole("button", { name: "First row" }).isDisabled(), true);
    });
  } finally {
    await browser.close();
  }
});
