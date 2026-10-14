import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { ENGINES } from "../../src/engines.mjs";
import { tableUrl, WINDOW_SUPPORT } from "../../src/standalone-config.mjs";

const base = process.env.SCROLL_TEST_URL || "http://127.0.0.1:4173/";
const demo = new URL("demo.html", base).href;
const output = new URL("../../output/playwright/", import.meta.url);
// npm run test:browser uses one headless browser and always closes it.
// Chrome is the default; PLAYWRIGHT_CHANNEL=chromium uses an installed Playwright browser.
test(
  "standalone and native browser scrolling",
  { timeout: 240_000 },
  async (t) => {
    await mkdir(output, { recursive: true });
    const browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
      headless: true,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const frames = (count = 10) =>
        page.evaluate(async (n) => {
          for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
        }, count);
      const open = async (id, mode, count = 100_000, rowHeight = 48) => {
        await page.goto(
          new URL(tableUrl(id, count, rowHeight, mode), demo).href,
        );
        await page
          .locator(".standalone-table [data-row-index]")
          .first()
          .waitFor();
        await frames();
      };
      const visible = () =>
        page.evaluate(() => {
          const inset = document
            .querySelector(".standalone-bar")
            .getBoundingClientRect().bottom;
          return [...document.querySelectorAll("[data-row-index]")]
            .map((row) => ({
              index: Number(row.dataset.rowIndex),
              top: row.getBoundingClientRect().top,
              bottom: row.getBoundingClientRect().bottom,
            }))
            .filter(
              (row) => row.bottom > inset + 1 && row.top < innerHeight - 1,
            )
            .sort((a, b) => a.top - b.top);
        });
      const reached = async (index) => {
        await page.waitForFunction(
          (target) => {
            const row = document.querySelector(`[data-row-index="${target}"]`);
            if (!row) return false;
            const rect = row.getBoundingClientRect();
            return (
              rect.bottom >
                document
                  .querySelector(".standalone-bar")
                  .getBoundingClientRect().bottom +
                  1 && rect.top < innerHeight - 1
            );
          },
          index,
          { timeout: 5000 },
        );
        const rows = await visible();
        assert.ok(
          rows.every((row, i) => !i || row.top >= rows[i - 1].bottom - 1),
          "Visible rows must not overlap",
        );
        assert.ok(
          (await page.locator("[data-row-index]").count()) < 100,
          "DOM remains virtualized",
        );
      };
      await t.test("demo switches between every library", async () => {
        await page.goto(demo);
        const libraries = page.getByRole("region", { name: "Libraries" });
        for (const { id, name } of ENGINES) {
          // By ID: "virtua" is also part of TanStack Virtual's and two other labels.
          await libraries.locator(`input[type="radio"][value="${id}"]`).check();
          await page
            .locator(".live-heading h3")
            .filter({ hasText: name })
            .waitFor();
          await page.locator(".viewport-shell [data-row-index]").first().waitFor();
        }
      });

      await t.test(
        "100M opens immediately in the demo and VitScroll reaches the last row",
        async () => {
          await page.goto(demo);
          await page.getByRole("combobox", { name: "Number of rows" }).selectOption("100000000");
          await page.locator(".viewport-shell [data-row-index]").first().waitFor();
          assert.match(
            await page.locator(".limit-note.over").innerText(),
            /= 4\.8B px\. Above[\s\S]*5 libraries can’t show all rows/,
          );
          // The library table marks the same five, with the row where they stop.
          const stopped = page.locator(".library-table tr:has(.reach.fails) .library-choice");
          assert.deepEqual(
            await stopped.allInnerTexts(),
            ["react-window", "TanStack Virtual", "React Virtuoso", "virtua", "rc-virtual-list"],
          );
          assert.match(
            await page.locator(".library-table .reach.fails").first().innerText(),
            /Stops near row 699,050/,
          );
          await page.getByRole("button", { name: "Check last row" }).click();
          const finding = page.locator(".finding");
          await finding.filter({ hasText: "VitScroll · row 100,000,000" }).waitFor();
          assert.match(await finding.innerText(), /Row jump: passed/);
          assert.match(await finding.innerText(), /Native end: passed/);
        },
      );

      await t.test("benchmark lite runs in the demo tab, separate from published results", async () => {
        await page.goto(demo);
        await page.getByRole("combobox", { name: "Number of rows" }).selectOption("10000");
        await page.locator(".viewport-shell [data-row-index]").first().waitFor();
        const lite = page.locator("#benchmark-lite");
        assert.equal(
          await lite.getByRole("link", { name: "published benchmark results" }).getAttribute("href"),
          "/",
        );
        await lite.getByRole("button", { name: "Run VitScroll only" }).click();
        await lite.locator(".run-message").filter({ hasText: "Complete · VitScroll · 3 of 3 passes." }).waitFor({ timeout: 60_000 });
        const row = lite.locator(".results-table tbody tr");
        assert.equal(await row.count(), 1);
        assert.match(await row.innerText(), /✓ Passed[\s\S]*✓ Passed[\s\S]*3\/3/);
        assert.equal(await page.locator(".viewport-shell [data-row-index]").count(), 0);
        await page.getByRole("button", { name: "Resume preview" }).click();
        await page.locator(".viewport-shell [data-row-index]").first().waitFor();
      });

      await t.test("full-screen page lists every library as a tab", async () => {
        await page.goto(demo);
        assert.equal(
          await page.getByRole("link", { name: "Open full screen ↗" }).getAttribute("href"),
          "?table=vit&scroll=window&count=1000000&rowHeight=48",
        );
        await open("vit", "window", 100_000, 56);
        const tabs = page.getByRole("navigation", { name: "Libraries" }).getByRole("link");
        assert.deepEqual(await tabs.allInnerTexts(), ENGINES.map((item) => item.name));
        await tabs.filter({ hasText: "AG Grid" }).click();
        await page.waitForURL(/table=ag&scroll=container&count=100000&rowHeight=56/);
        await page.locator(".standalone-table [data-row-index]").first().waitFor();
        assert.equal(await page.locator('.library-tabs [aria-current="page"]').innerText(), "AG Grid");
        const fill = await page.locator(".standalone-table .viewport-shell").evaluate((node) => ({
          top: node.getBoundingClientRect().top,
          bottom: node.getBoundingClientRect().bottom,
          bar: document.querySelector(".standalone-bar").getBoundingClientRect().bottom,
        }));
        assert.ok(Math.abs(fill.top - fill.bar) <= 1, "Container starts under the bar");
        assert.ok(Math.abs(fill.bottom - 1050) <= 1, "Container fills the screen");
        await tabs.filter({ hasText: "TanStack Virtual" }).click();
        await page.waitForURL(/table=tanstack&scroll=window&count=100000&rowHeight=56/);
        await page.locator(".standalone-table [data-row-index]").first().waitFor();
        assert.equal(await page.locator(".library-tabs a.fails").count(), 0, "100K fits every library");

        // Above the browser height limit, full-height libraries are red and say why.
        await open("vit", "window", 1_000_000, 48);
        assert.deepEqual(
          await page.locator(".library-tabs a.fails").allInnerTexts(),
          ["react-window", "TanStack Virtual", "React Virtuoso", "virtua", "rc-virtual-list"],
        );
        await tabs.filter({ hasText: "react-window" }).hover();
        const tip = page.getByRole("tooltip");
        assert.match(await tip.innerText(), /react-window · Can’t show all rows[\s\S]*cuts it off near row 699,050/);
        await tabs.filter({ hasText: "VitScroll" }).hover();
        assert.match(await tip.innerText(), /VitScroll · Shows all rows/);
        assert.equal(await page.locator(".mode-note.fails").count(), 0);
        await open("tanstack", "window", 1_000_000, 48);
        assert.match(await page.locator(".mode-note.fails").innerText(), /Can’t show all rows/);
      });

      for (const { id, name } of ENGINES)
        await t.test(
          `${name}: separate container page and last row`,
          async () => {
            await open(id, "container");
            assert.equal(
              await page.getByRole("button", { name: /benchmark/i }).count(),
              0,
              "Separate tables have no in-page benchmark",
            );
            await page.locator(".standalone-table").scrollIntoViewIfNeeded();
            await page
              .getByRole("button", { name: "Native scroll end" })
              .click();
            await reached(99_999);
            assert.ok(await page.locator(".viewport-shell").count());
          },
        );

      for (const id of Object.keys(WINDOW_SUPPORT))
        await t.test(
          `${id}: real window wheel, native end, keyboard and resize at 100K`,
          async () => {
            await open(id, "window");
            await page
              .getByRole("button", { name: "First row", exact: true })
              .click();
            await reached(0);
            // virtua re-applies a jump for a few frames; let it settle so the
            // wheel is measured, not raced against the jump.
            await frames(10);
            const before = await page.evaluate(() => scrollY);
            await page.mouse.move(650, 450);
            await page.mouse.wheel(0, 240);
            await frames(20);
            assert.ok(
              (await page.evaluate(() => scrollY)) > before,
              "Wheel moves the document",
            );
            assert.ok((await visible())[0].index > 0);
            assert.equal(
              await page
                .locator(".standalone-table")
                .evaluate(
                  (root) =>
                    [...root.querySelectorAll("*")].filter(
                      (el) =>
                        /^(auto|scroll)$/.test(
                          getComputedStyle(el).overflowY,
                        ) && el.scrollHeight > el.clientHeight + 1,
                    ).length,
                ),
              0,
              "No nested vertical scroll container",
            );
            await page.getByRole("button", { name: "Middle row" }).click();
            await reached(50_000);
            await page.setViewportSize({ width: 1180, height: 800 });
            await frames(12);
            assert.ok(
              (await visible()).length > 0,
              "Resize leaves visible rows",
            );
            await page.evaluate(() => {
              document.activeElement?.blur();
              window.scrollTo({
                top: document.scrollingElement.scrollHeight,
                behavior: "instant",
              });
            });
            await reached(99_999);
            await page.keyboard.press("Home");
            await frames(25);
            assert.ok(
              (await page.evaluate(() => scrollY)) < 2,
              "Home returns to document start",
            );
            await page.keyboard.press("End");
            await reached(99_999);
            await page.setViewportSize({ width: 1440, height: 1050 });
          },
        );

      for (const id of ["vit", "tanstack"])
        await t.test(
          `${id}: page scroll at 1M ${id === "vit" ? "reaches" : "stops before"} the last row`,
          async () => {
            await open(id, "window", 1_000_000);
            const lastVisible = async () => {
              await frames(12);
              const rows = await visible();
              assert.ok(rows.length > 0, "Rows stay visible");
              return rows.some((row) => row.index === 999_999);
            };
            await page.getByRole("button", { name: "Native scroll end" }).click();
            if (id === "vit") await reached(999_999);
            else assert.equal(await lastVisible(), false, "Native end is capped by the browser height limit");
            await page.getByLabel("Jump to row number").fill("1000000");
            await page.getByRole("button", { name: "Jump", exact: true }).click();
            if (id === "vit") await reached(999_999);
            else assert.equal(await lastVisible(), false, "Index jump cannot pass the browser height limit");
          },
        );
      await t.test(
        "VitScroll: 100M page end, precise wheel and keyboard, mobile resize",
        async () => {
          await open("vit", "window", 100_000_000);
          await page.getByRole("button", { name: "Middle row" }).click();
          await reached(50_000_000);
          const rowBefore = (await visible())[0].index;
          await page.mouse.move(650, 450);
          await page.mouse.wheel(0, 48);
          await frames();
          assert.equal(
            (await visible())[0].index,
            rowBefore + 1,
            "One wheel row stays precise under compression",
          );
          await page.evaluate(() => document.activeElement?.blur());
          await page.keyboard.press("ArrowDown");
          await frames();
          assert.equal((await visible())[0].index, rowBefore + 2);
          await page.setViewportSize({ width: 390, height: 844 });
          await frames();
          await reached(rowBefore + 2);
          // Fractional document prefixes must not amplify rounding into
          // missing rows when the document scrollbar reaches its actual end.
          await page.locator(".standalone-table").evaluate((node) => {
            node.style.paddingTop = "24.375px";
          });
          await frames();
          await page.evaluate(() =>
            window.scrollTo({
              top: document.scrollingElement.scrollHeight,
              behavior: "instant",
            }),
          );
          await reached(99_999_999);
          await page
            .locator(".standalone-visible")
            .filter({ hasText: "100,000,000" })
            .waitFor();
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            "No mobile horizontal overflow",
          );
          await page.screenshot({
            path: new URL("window-mobile-end.png", output).pathname,
          });
          await page.setViewportSize({ width: 1440, height: 1050 });
        },
      );
      await t.test("benchmark results are the home page; old links still work", async () => {
        const home = new URL(base).pathname;
        await page.goto(demo);
        await page.getByRole("link", { name: "Benchmarks", exact: true }).click();
        await page.waitForURL((url) => url.pathname === home);
        await page.getByRole("heading", { name: "How each library held up" }).waitFor();
        await page.locator("#matrix-title, .bench-empty").first().waitFor();
        assert.equal(
          await page.locator("[data-row-index]").count(),
          0,
          "The results page mounts no live table",
        );
        await page.getByRole("link", { name: "Demo", exact: true }).click();
        await page.waitForURL(/\/demo\.html$/);
        await page.locator(".viewport-shell [data-row-index]").first().waitFor();
        // The old results page and the old in-demo results view arrive home.
        for (const old of ["benchmarks.html?rows=100000", "?page=benchmarks&rows=100000"]) {
          await page.goto(new URL(old, base).href);
          await page.waitForURL(
            (url) =>
              url.pathname === home &&
              url.searchParams.get("rows") === "100000" &&
              !url.searchParams.has("page"),
          );
          await page.getByRole("heading", { name: "How each library held up" }).waitFor();
        }
        // Old demo anchors and full-screen links arrive at the demo.
        await page.goto(new URL("#features", base).href);
        await page.waitForURL(/\/demo\.html#libraries$/);
        await page.getByRole("radio", { name: "VitScroll" }).waitFor();
        await page.goto(new URL("?table=vit&scroll=container&count=100000&rowHeight=48", base).href);
        await page.waitForURL(/\/demo\.html\?table=vit/);
        await page.locator(".standalone-table [data-row-index]").first().waitFor();
      });
      await t.test("no runtime or console errors", () =>
        assert.deepEqual(errors, []),
      );
    } finally {
      await browser.close();
    }
  },
);
