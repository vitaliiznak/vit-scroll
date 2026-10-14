import { chromium, firefox, webkit } from "playwright";
import { rowOffset } from "../src/row-scenario.mjs";
const rowMode = process.env.AUDIT_ROW_MODE || "fixed";
const browserName = process.env.AUDIT_BROWSER || "chromium";
const suite = process.env.AUDIT_SUITE || "performance";
const collectHeap = suite === "memory";
const [base, engine, countText] = process.argv.slice(2);
const count = Number(countText);
let browser;
let cdp;
let currentStage = "starting";
const started = Date.now();
const result = {
  engine,
  browser: browserName,
  suite,
  count,
  rowHeight: 48,
  rowMode,
  mount: null,
  seeks: [],
  errors: [],
  longTasks: [],
  heapSamples: [],
  dynamicChecks: [],
};
function stage(name) {
  currentStage = name;
  process.send?.({ type: "stage", stage: name, result });
}
async function heap(stageName) {
  if (!cdp || !collectHeap) return null;
  const sample = await cdp.send("Runtime.getHeapUsage");
  result.heapSamples.push({
    stage: stageName,
    elapsedMs: Date.now() - started,
    ...sample,
  });
  stage(currentStage);
  return sample;
}
async function close() {
  if (browser) {
    const b = browser;
    browser = null;
    await b.close().catch(() => {});
  }
}
process.on("SIGTERM", async () => {
  await close();
  process.exit(143);
});
try {
  stage("browser");
  browser = await { chromium, firefox, webkit }[browserName].launch({
    headless: true,
    ...(collectHeap ? { args: ["--js-flags=--max-old-space-size=1024"] } : {}),
  });
  result.browserVersion = browser.version();
  const page = await browser.newPage({
    viewport: { width: 1100, height: 700 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => {
    result.errors.push(e.message);
    stage(currentStage);
  });
  page.on("crash", () => {
    result.crashed = true;
    result.status = "renderer-crash";
    stage(currentStage);
  });
  if (collectHeap && browserName === "chromium")
    cdp = await page.context().newCDPSession(page);
  await page.goto(`${base}/demo.html?audit=1`, { waitUntil: "load", timeout: 15000 });
  await page.waitForFunction(() => !!window.scrollAudit, null, {
    timeout: 5000,
  });
  result.environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio,
    window: { width: innerWidth, height: innerHeight },
  }));
  if (cdp) await cdp.send("HeapProfiler.collectGarbage");
  result.heapBefore = await heap("baseline");
  await page.evaluate(() => {
    window.auditLongTasks = [];
    window.auditLongTasksSupported =
      PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false;
    if (!window.auditLongTasksSupported) return;
    window.auditObserver = new PerformanceObserver((list) => {
      window.auditLongTasks.push(
        ...list
          .getEntries()
          .map((e) => ({ start: e.startTime, duration: e.duration })),
      );
    });
    try {
      window.auditObserver.observe({ type: "longtask", buffered: false });
    } catch {}
  });
  stage("mount");
  result.mount = await page.evaluate(
    async ({ engine, count, rowMode }) => window.scrollAudit.mount(engine, count, 48, rowMode),
    { engine, count, rowMode },
  );
  result.heapAfterMount = await heap("after-mount");
  if (!result.mount.observation?.visible.includes(0))
    throw new Error("First row not visible after mount");
  if (suite === "memory") {
    if (cdp) await cdp.send("HeapProfiler.collectGarbage");
    result.heapMountedGC = await heap("mounted-gc");
  }
  if (rowMode === "dynamic") {
    stage("dynamic-initial");
    result.dynamicChecks.push({ name: "initial mixed heights", ...await page.evaluate(() => window.scrollAudit.checkDynamic(0)) });
    await page.evaluate(() => window.scrollAudit.seek(100));
    for (const expanded of [true, false]) {
      stage(expanded ? "dynamic-expand" : "dynamic-collapse");
      const before = await page.evaluate(() => window.scrollAudit.sample());
      await page.evaluate((value) => window.scrollAudit.setExpanded(value), expanded);
      const check = await page.evaluate((anchor) => window.scrollAudit.checkDynamic(anchor), before.first);
      result.dynamicChecks.push({ name: expanded ? "expand every tenth row" : "collapse rows", ...check,
        anchor: before.first, anchorDriftPx: check.anchorTop == null ? null : check.anchorTop - before.firstTop });
    }
    for (const width of [640, 1100]) {
      stage(width === 640 ? "dynamic-narrow" : "dynamic-restore-width");
      const before = await page.evaluate(() => window.scrollAudit.sample());
      await page.setViewportSize({ width, height: 700 });
      const check = await page.evaluate((anchor) => window.scrollAudit.checkDynamic(anchor), before.first);
      result.dynamicChecks.push({ name: width === 640 ? "narrow viewport" : "restore width", ...check,
        anchor: before.first, anchorDriftPx: check.anchorTop == null ? null : check.anchorTop - before.firstTop });
    }
    await heap("after-dynamic-changes");
  }
  if (suite === "memory") {
    stage("memory-scroll");
    await page.evaluate(() => window.scrollAudit.scrollLocal());
    await heap("after-memory-scroll");
    for (const index of [0, Math.floor(count / 2), count - 1]) {
      stage(`memory-seek:${index}`);
      result.seeks.push(
        await page.evaluate((i) => window.scrollAudit.seek(i), index),
      );
      await heap(`memory-seek:${index}`);
    }
    if (cdp) await cdp.send("HeapProfiler.collectGarbage");
    result.heapAfterWork = await heap("retained-gc");
    result.status = "completed";
    result.jumpPassed = result.seeks.every((s) => s.reached);
    result.alignPassed = result.seeks.every((s) => s.aligned !== false);
  } else {
    // Run common low-index work before large random access so partial results survive a budget stop.
    stage("local-scroll");
    result.scroll = await page.evaluate(() => window.scrollAudit.scrollLocal());
    await heap("after-local-scroll");
    stage("wheel");
    await page.evaluate(() => window.scrollAudit.seek(100));
    const target = await page.evaluate(() => window.scrollAudit.inputTarget());
    const before = await page.evaluate(() => window.scrollAudit.sample());
    await page.locator("[data-audit-input]").hover();
    await page.mouse.wheel(0, 48);
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
    });
    const after = await page.evaluate(() => window.scrollAudit.sample());
    result.wheel = {
      deltaY: 48,
      before,
      after,
      logicalPixels:
        before?.first != null && after?.first != null
          ? (rowMode === "dynamic" ? rowOffset(after.first) - rowOffset(before.first) : (after.first - before.first) * 48) -
            (after.firstTop - before.firstTop)
          : null,
    };
    await heap("after-wheel");
    stage("keyboard");
    await page.evaluate(() => window.scrollAudit.seek(100));
    const focused = await page.evaluate(() => window.scrollAudit.focus());
    result.keyboard = { tabIndex: target.tabIndex, focused };
    if (focused) {
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(250);
      result.keyboard.afterPageDown = await page.evaluate(() =>
        window.scrollAudit.sample(),
      );
    }
    await heap("after-keyboard");
    stage("resize");
    await page.evaluate(() => window.scrollAudit.seek(100));
    await page.setViewportSize({ width: 640, height: 700 });
    await page.waitForTimeout(150);
    result.resize = await page.evaluate(() => window.scrollAudit.sample());
    await page.setViewportSize({ width: 1100, height: 700 });
    await heap("after-resize");
    stage("random-seeks");
    for (const index of [
      0,
      Math.floor(count / 4),
      Math.floor(count / 2),
      Math.floor(count * 0.9),
      count - 1,
    ]) {
      stage(`seek:${index}`);
      result.seeks.push(
        await page.evaluate((i) => window.scrollAudit.seek(i), index),
      );
      await heap(`after-seek:${index}`);
    }
    stage("native-end");
    result.nativeEnd = await page.evaluate(() =>
      window.scrollAudit.nativeEnd(),
    );
    result.heapAfterWork = await heap("after-work");
    result.longTasksSupported = await page.evaluate(
      () => window.auditLongTasksSupported,
    );
    result.longTasks = result.longTasksSupported
      ? await page.evaluate(() => window.auditLongTasks)
      : null;
    result.status = "completed";
    result.jumpPassed = result.seeks.every((s) => s.reached);
    result.alignPassed = result.seeks.every((s) => s.aligned !== false);
    result.nativePassed = !!result.nativeEnd?.lastRowVisible;
  }
  stage("unmount");
  await page.evaluate(() => window.scrollAudit.unmount());
  if (cdp) await cdp.send("HeapProfiler.collectGarbage");
  result.heapAfterUnmountGC = await heap("after-unmount-gc");
} catch (error) {
  result.status = result.crashed ? "renderer-crash" : "error";
  result.error = error.message;
  stage(currentStage);
} finally {
  await close();
}
process.send?.({ type: "result", result });
