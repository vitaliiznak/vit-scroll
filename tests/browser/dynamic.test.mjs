import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SCROLL_TEST_URL || "http://127.0.0.1:4173/";

test("dynamic adapters measure actual content and update it without remounting", { timeout: 90000 }, async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
    for (const engine of ["window", "tanstack", "scaled", "virtuoso", "virtua", "rc", "ag"]) {
      await t.test(engine, async () => {
        const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
        try {
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(new URL("demo.html?audit=1", base).href);
          await page.waitForFunction(() => !!window.scrollAudit);
          await page.evaluate((id) => window.scrollAudit.mount(id, 1000, 48, "dynamic"), engine);
          assert.equal((await page.evaluate(() => window.scrollAudit.checkDynamic(0))).passed, true);
          const sizes = () => page.locator("[data-row-index]").evaluateAll((nodes) => nodes.slice(0, 4).map((node) => node.getBoundingClientRect().height));
          assert.deepEqual(await sizes(), [32, 48, 72, 96]);
          // Count mount/unmount mutations: a remount would invalidate this marker.
          await page.evaluate(() => { window.scrollAudit.inputTarget(); document.querySelector('[data-audit-input]').dataset.sameMount = "yes"; });
          await page.evaluate(() => window.scrollAudit.setExpanded(true));
          assert.equal((await page.evaluate(() => window.scrollAudit.checkDynamic(0))).passed, true);
          assert.deepEqual(await sizes(), [96, 48, 72, 96]);
          await page.evaluate(() => window.scrollAudit.setExpanded(false));
          assert.equal((await page.evaluate(() => window.scrollAudit.checkDynamic(0))).passed, true);
          await page.setViewportSize({ width: 640, height: 700 });
          assert.equal((await page.evaluate(() => window.scrollAudit.checkDynamic(0))).passed, true);
          assert.deepEqual(await sizes(), [56, 72, 96, 120]);
          assert.equal(await page.locator('[data-same-mount="yes"]').count(), 1);
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
        }
      });
    }
    await t.test("unsupported adapter fails before allocating", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(new URL("demo.html?audit=1", base).href);
        await page.waitForFunction(() => !!window.scrollAudit);
        await assert.rejects(page.evaluate(() => window.scrollAudit.mount("vit", 100000000, 48, "dynamic")), /Invalid audit configuration/);
        assert.equal(await page.locator("[data-row-index]").count(), 0);
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser?.close();
  }
});
