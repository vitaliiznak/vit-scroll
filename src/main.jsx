import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal, flushSync } from "react-dom";
import { Adapter, ENGINES, OVERSCAN, VIEWPORT, inspect } from "./adapters.jsx";
import { LibraryLinks } from "./LibraryLinks.jsx";
import { probeHeightLimit } from "../packages/vit-scroll/core.mjs";
import { percentile, settle } from "./benchmark.js";
import { LITE_FRAMES, LITE_PASSES, measureAdapter } from "./benchmark-lite.js";
import "./style.css";
import { AuditFixture } from "./AuditFixture.jsx";
import { Standalone } from "./Standalone.jsx";
import { SiteHeader, BENCHMARKS_URL } from "./SiteHeader.jsx";
import { readPageHeap } from "./measurements.mjs";
import { heapLabel, heapPressure, peakHeap, previewError, runLitePasses, LITE_DEADLINE_MS } from "./preview-health.mjs";
import { PreviewBoundary } from "./PreviewBoundary.jsx";
import { lockLitePage, settleLite } from "./lite-session.mjs";
import {
  COMPRESSED,
  FULL_HEIGHT,
  reachability,
  tableUrl,
} from "./standalone-config.mjs";

const fmt = (n) => new Intl.NumberFormat("en-US").format(n);
const compact = (n) =>
  n >= 1e9
    ? `${+(n / 1e9).toFixed(2)}B`
    : n >= 1e6
    ? `${+(n / 1e6).toFixed(2)}M`
    : n >= 1000
      ? `${+(n / 1000).toFixed(1)}K`
      : fmt(n);
const probe = probeHeightLimit();
const physicalCap = Math.min(8_000_000, Math.floor(probe.height * 0.75));
const browserName = /Edg\//.test(navigator.userAgent)
  ? "Edge"
  : /Firefox\//.test(navigator.userAgent)
    ? "Firefox"
    : /Chrome\//.test(navigator.userAgent)
      ? "Chromium"
      : /Safari\//.test(navigator.userAgent)
        ? "Safari"
        : "Browser";
const engineById = (id) => ENGINES.find((item) => item.id === id);
const ROW_COUNTS = [10_000, 100_000, 500_000, 1_000_000, 2_000_000, 100_000_000];
// Documented capabilities and integration paths, not test results.
const CAPABILITIES = {
  window: [
    "Application data layer",
    "Height function / dynamic cache",
    "Range callback + app or loader",
  ],
  tanstack: [
    "Application data layer",
    "Estimates + measurement API",
    "App uses the virtual range",
  ],
  scaled: [
    "Application; Table sort callback",
    "CellMeasurer integration",
    "InfiniteLoader helper",
  ],
  ag: [
    "Datasource processes requests",
    "Fixed in this row model",
    "Block loading and cache",
  ],
  virtuoso: [
    "Application data layer",
    "Automatic measurement",
    "Start/end callbacks, append/prepend",
  ],
  virtua: [
    "Application data layer",
    "Automatic measurement",
    "App loads more from scroll callbacks",
  ],
  rc: [
    "Application supplies data array",
    "Measures mounted items",
    "Application scroll/range callbacks",
  ],
  vit: [
    "Needs app data/key integration",
    "Fixed only",
    "Application integration needed",
  ],
};

function App() {
  const [engine, setEngine] = useState("vit");
  const [count, setCount] = useState(1_000_000);
  const [rowHeight, setRowHeight] = useState(48);
  const [stats, setStats] = useState(null);
  const [jump, setJump] = useState("1000000");
  const [finding, setFinding] = useState(null);
  const [checking, setChecking] = useState(false);
  // Benchmark lite: progress while it runs, then its passes and setup.
  const [lite, setLite] = useState(null);
  const [liteRuns, setLiteRuns] = useState([]);
  const [liteSetup, setLiteSetup] = useState(null);
  const [liteMessage, setLiteMessage] = useState("");
  const [mountId, setMountId] = useState(0);
  const [heap, setHeap] = useState(null);
  const [previewFailure, setPreviewFailure] = useState(null);
  const [previewPaused, setPreviewPaused] = useState(false);
  const [liveResults, setLiveResults] = useState({});
  const failureRef = useRef(null);
  const runAbort = useRef(null);
  const apiRef = useRef(null);
  const running = lite !== null;
  const busy = checking || running;
  const previewUnavailable = busy || !!previewFailure || previewPaused;
  const shown = running ? lite.engine : engine;
  const active = engineById(shown ?? lite.id);
  const totalHeight = count * rowHeight;
  const threshold = Math.floor(probe.height / rowHeight);
  const overLimit = totalHeight > probe.height;
  const cutOff = ENGINES.filter(
    (item) => reachability(item.id, count, rowHeight, probe.height).fails,
  );

  useEffect(() => {
    // No dashboard polling or React updates during frame measurements.
    if (running) return;
    const timer = setInterval(() => {
      const sample = readPageHeap();
      setHeap(sample);
      if (!busy && !previewPaused && !failureRef.current) {
        const observed = inspect(apiRef.current, count);
        setStats(observed);
        saveLive({ status: observed?.mounted ? "Preview running" : "Mounting…", error: null, heap: sample });
      }
      if (!running && !previewPaused && !failureRef.current && heapPressure(sample).level === "critical")
        failPreview(previewError(`Preview stopped near the page heap limit: ${heapLabel(sample)}. Reduce the rows or choose another library.`, "resource-budget"));
    }, 160);
    return () => clearInterval(timer);
  }, [engine, count, rowHeight, busy, running, previewPaused]);

  useEffect(() => () => runAbort.current?.abort(previewError("Demo closed.", "stopped")), []);

  function interruptLite(message = "Stopped by you.") {
    runAbort.current?.abort(previewError(message, "stopped"));
  }

  function saveLive(result) {
    const key = `${engine}:${count}:${rowHeight}`;
    setLiveResults((previous) => ({ ...previous, [key]: { ...previous[key], ...result } }));
  }
  function failPreview(error) {
    failureRef.current = error;
    setPreviewFailure(error.message);
    if (!running) saveLive({ status: "Stopped", error: error.message, heap: readPageHeap() });
  }
  function resetPreview() {
    failureRef.current = null;
    setPreviewFailure(null);
    setPreviewPaused(false);
  }

  function configure(nextCount, nextHeight = rowHeight) {
    setCount(nextCount);
    setRowHeight(nextHeight);
    setJump(String(nextCount));
    setFinding(null);
    setStats(null);
    resetPreview();
  }
  function selectLibrary(id) {
    setEngine(id);
    setFinding(null);
    setStats(null);
    resetPreview();
  }
  async function checkEnd() {
    setChecking(true);
    setFinding(null);
    try {
      apiRef.current.bottom();
      await settle(6);
      const native = inspect(apiRef.current, count);
      apiRef.current.jump(count - 1);
      await settle(6);
      const byIndex = inspect(apiRef.current, count);
      setStats(byIndex);
      saveLive({ checked: true, native: !!native?.lastRowVisible, jump: !!byIndex?.lastRowVisible });
      setFinding({
        name: active.name,
        native: !!native?.lastRowVisible,
        jump: !!byIndex?.lastRowVisible,
        count,
      });
    } catch (error) {
      setFinding({ error: error.message });
      failPreview(error);
    } finally {
      setChecking(false);
    }
  }
  async function runLite(scope) {
    if (busy || runAbort.current) return;
    const targets = scope === "all" ? ENGINES : [engineById(engine)];
    const total = targets.length * LITE_PASSES;
    const controller = new AbortController();
    runAbort.current = controller;
    const { signal } = controller;
    setLiteRuns([]);
    setLiteMessage("");
    setLiteSetup({ count, rowHeight, ids: targets.map((item) => item.id) });
    setFinding(null);
    setStats(null);
    resetPreview();
    setLite({ id: targets[0].id, engine: null, round: 1, completed: 0, total });
    const checkContext = () => {
      signal.throwIfAborted();
      if (document.hidden)
        throw previewError("Stopped. Keep this tab visible while it runs.", "stopped");
      const rect = apiRef.current?.element?.getBoundingClientRect();
      const guardTop = document.querySelector(".run-guard")?.getBoundingClientRect().top ?? innerHeight;
      if (rect && (rect.top < 0 || rect.bottom > guardTop))
        throw previewError("Stopped. The window is too small to show the full list and Stop control. Enlarge it and run again.", "stopped");
    };
    try {
      await document.fonts.ready;
      document.getElementById("playground").scrollIntoView({ behavior: "instant", block: "start" });
      await settleLite(2, signal);
      const summary = await runLitePasses({
        targets, repeats: LITE_PASSES,
        onResult: (result) => setLiteRuns((runs) => [...runs, result]),
        runPass: async (item, round, { completed, total }) => {
          const progress = { id: item.id, round: round + 1, completed, total };
          flushSync(() => setLite({ ...progress, engine: null }));
          resetPreview();
          await settleLite(2, signal);
          const start = performance.now();
          let heapPeak = null;
          let partial = {};
          const check = () => {
            const sample = readPageHeap();
            heapPeak = peakHeap(heapPeak, sample);
            checkContext();
            if (failureRef.current) throw failureRef.current;
            if (heapPressure(sample).level === "critical")
              throw previewError(`Stopped near the page heap limit: ${heapLabel(sample)}.`, "resource-budget");
            if (performance.now() - start > LITE_DEADLINE_MS)
              throw previewError("25-second pass deadline reached.", "timeout");
          };
          try {
            check();
            flushSync(() => {
              setLite({ ...progress, engine: item.id });
              setMountId((n) => n + 1);
            });
            await settleLite(4, signal);
            check();
            partial.readyMs = performance.now() - start;
            if (!apiRef.current?.element)
              throw new Error(`${item.name} did not mount a scrolling viewport.`);
            const result = await measureAdapter(apiRef.current, count, rowHeight, check, signal,
              (observations) => { partial = { ...partial, ...observations }; });
            check();
            return { ...partial, ...result, heapPeak };
          } catch (error) {
            heapPeak = peakHeap(heapPeak, readPageHeap());
            error.observations = { ...partial, heapPeak };
            throw error;
          } finally {
            // Unmount on success, stop and failure before another pass starts.
            flushSync(() => setLite({ ...progress, engine: null }));
            apiRef.current = null;
            failureRef.current = null;
            setPreviewFailure(null);
            setHeap(readPageHeap());
            // Let library cleanup tasks finish outside the measured interval.
            // Yielding does not force garbage collection or reset the page heap.
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        },
      });
      const who = targets.length === 1 ? targets[0].name : `${targets.length} libraries`;
      setLiteMessage(summary.stopped
        ? `${summary.stopped} ${summary.completed} of ${total} passes completed. Remaining passes were not run.`
        : summary.failed
          ? `Finished · ${who} · ${summary.completed} of ${total} passes completed · ${summary.failed} libraries failed · ${summary.skipped} repeat passes skipped.`
          : `Complete · ${who} · ${summary.completed} of ${total} passes.`);
    } catch (error) {
      setLiteMessage(error.message);
    } finally {
      // Never immediately allocate a new preview after cleaning up a run.
      flushSync(() => {
        resetPreview();
        setPreviewPaused(true);
        setLite(null);
        setStats(null);
      });
      apiRef.current = null;
      runAbort.current = null;
      setHeap(readPageHeap());
      document.getElementById("benchmark-lite").scrollIntoView({ behavior: "instant", block: "start" });
    }
  }
  async function goToRow(event) {
    event.preventDefault();
    const target = Math.min(
      count - 1,
      Math.max(0, Math.floor(Number(jump) || 1) - 1),
    );
    try {
      apiRef.current?.jump(target);
      await settle(6);
      setStats(inspect(apiRef.current, count));
    } catch (error) {
      failPreview(error);
    }
  }

  return (
    <>
      <SiteHeader page="demo" />
      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">
              REACT SCROLLING · SEVEN IMPLEMENTATIONS
            </div>
            <h1>Compare scrolling. See the limits.</h1>
            <p>
              Switch between eight virtual-scrolling libraries on the same
              rows. Scroll, jump to any row, check whether the last row can be
              reached, or run a quick benchmark lite in this tab.
            </p>
            <a className="hero-link" href={BENCHMARKS_URL}>
              See the published benchmark results →
            </a>
          </div>
          <div className="browser-note">
            <span>THIS BROWSER’S HEIGHT LIMIT</span>
            <strong>
              {compact(probe.height)} <small>px</small>
            </strong>
            <p>{browserName} · measured on page load</p>
          </div>
        </section>

        <section id="demo" className="setup-section">
          <div className="section-line">
            <h2>
              <span>01</span> Pick a library and scroll
            </h2>
            <span className="section-meta">ROWS → LIBRARY → SCROLL</span>
          </div>
          <div className="setup-card">
            <div className="setup-fields">
              <label htmlFor="dataset">
                Number of rows
                <select
                  id="dataset"
                  value={count}
                  disabled={busy}
                  onChange={(e) => configure(Number(e.target.value))}
                >
                  {ROW_COUNTS.includes(count) ? null : (
                    <option value={count}>
                      {fmt(count)} · just beyond limit
                    </option>
                  )}
                  {ROW_COUNTS.map((n) => (
                    <option key={n} value={n}>
                      {fmt(n)}
                    </option>
                  ))}
                </select>
                <small>Every size is available for all eight libraries.</small>
              </label>
              <label htmlFor="row-height">
                Height of each row
                <select
                  id="row-height"
                  value={rowHeight}
                  disabled={busy}
                  onChange={(e) => configure(count, Number(e.target.value))}
                >
                  {[32, 40, 48, 56, 64, 72, 80].map((n) => (
                    <option key={n} value={n}>
                      {n} px
                    </option>
                  ))}
                </select>
                <small>Same fixed height for every library.</small>
              </label>
            </div>
            <div className={`limit-note ${overLimit ? "over" : ""}`}>
              <span>
                {fmt(count)} rows × {rowHeight}px ={" "}
                <b>{compact(totalHeight)} px</b>.{" "}
                {overLimit ? "Above" : "Within"} this browser’s{" "}
                {compact(probe.height)} px native height limit.
                {cutOff.length > 0 && (
                  <>
                    {" "}
                    <b>{cutOff.length} libraries can’t show all rows.</b>
                  </>
                )}
              </span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => configure(Math.min(2e6, threshold + 1000))}
              >
                Try just beyond the limit ↗
              </button>
            </div>
          </div>

          {count >= 10_000_000 && (
            <p className="large-run-note">
              All eight libraries can attempt {fmt(count)} rows. Large internal
              allocations may freeze or crash this tab before it can show a warning.
              For recorded crashes, timeouts and memory stops, use the{" "}
              <a href={`${BENCHMARKS_URL}?rows=${count}`}>isolated benchmark results</a>.
            </p>
          )}
          <div
            id="libraries"
            className="results-scroll library-scroll"
            tabIndex={0}
            role="region"
            aria-label="Libraries"
          >
            <table className="feature-table library-table">
              <thead>
                <tr>
                  <th>
                    Library <small>select one to preview</small>
                  </th>
                  <th>Scroll-height limit <small>row {fmt(count)}</small></th>
                  <th>Live check / page heap</th>
                  <th>Search / filter / sort</th>
                  <th>Changing row heights</th>
                  <th>Loading more rows</th>
                </tr>
              </thead>
              <tbody>
                {ENGINES.map((item) => {
                  const fails = cutOff.includes(item);
                  const selected = item.id === engine;
                  const live = liveResults[`${item.id}:${count}:${rowHeight}`];
                  const pressure = heapPressure(live?.heap);
                  return (
                    <tr
                      key={item.id}
                      className={selected ? "is-selected" : undefined}
                      onClick={(e) => {
                        if (!busy && !e.target.closest("a, label"))
                          selectLibrary(item.id);
                      }}
                    >
                      <th scope="row">
                        <label className="library-choice">
                          <input
                            type="radio"
                            name="library"
                            value={item.id}
                            checked={selected}
                            disabled={busy}
                            onChange={() => selectLibrary(item.id)}
                          />
                          <i style={{ background: item.color }} />
                          {item.name}
                          {item.id === "ag" ? " · Infinite" : ""}
                        </label>
                        <LibraryLinks id={item.id} />
                      </th>
                      <td className={fails ? "reach fails" : "reach"}>
                        <b>
                          {fails
                            ? `× Stops near row ${fmt(threshold)}`
                            : "Height is handled"}
                        </b>
                        <small>
                          {FULL_HEIGHT[item.id] ?? COMPRESSED[item.id]}
                        </small>
                      </td>
                      <td className={`live-result ${pressure.level}`}>
                        <b>{live?.error ? "Stopped" : live?.checked
                          ? live.jump && live.native ? "Last-row checks passed" : "Last-row checks failed"
                          : selected && previewPaused ? "Preview paused"
                          : live?.status === "Preview running" && !selected ? "Preview opened"
                          : live?.status ?? "Not tried at this setup"}</b>
                        <small>{live?.error || (live?.checked
                          ? `Row jump: ${live.jump ? "passed" : "failed"} · Native end: ${live.native ? "passed" : "failed"}`
                          : live ? "Last row not checked" : "Select to try")}</small>
                        {live && <small>{heapLabel(live.heap)} · approximate</small>}
                        {["warning", "critical"].includes(pressure.level) && <strong>Near memory limit</strong>}
                      </td>
                      {CAPABILITIES[item.id].map((cell) => (
                        <td key={cell}>{cell}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="feature-intro">
            Capabilities are documented integration paths, not test results;
            the preview uses fixed row heights. AG Grid has built-in data
            features, but our Infinite Row Model delegates filtering and
            sorting to its datasource. Quick Filter requires a Client-Side Row
            Model.{" "}
            <a
              href="https://www.ag-grid.com/react-data-grid/filter-quick/#server-side-data"
              target="_blank"
              rel="noreferrer"
            >
              Why the row model matters ↗
            </a>
          </p>

          <div
            className={`live-panel ${running ? "is-running" : ""}`}
            id="playground"
          >
            <div className="live-heading">
              <div>
                <span className="eyebrow">
                  {running ? "BENCHMARK LITE RUNNING" : "LIVE PREVIEW"}
                </span>
                <h3>
                  <i style={{ background: active.color }} />
                  {running
                    ? `${shown ? "Running now" : "Switching to"}: ${active.name}`
                    : active.name}
                </h3>
                <LibraryLinks id={active.id} />
              </div>
              <div className="live-state" role="status" aria-live="polite">
                {running ? (
                  <>
                    <strong>
                      Pass {lite.round} of {LITE_PASSES} · {lite.completed}/
                      {lite.total} done
                    </strong>
                    <small>Page controls and scrolling are locked.</small>
                  </>
                ) : (
                  <>
                    <span>
                      {fmt(count)} rows · {rowHeight}px each
                    </span>
                    <small>
                      {checking
                        ? "Checking the last row…"
                        : "Scroll or jump to explore."}
                    </small>
                    <a
                      className="standalone-link"
                      href={tableUrl(engine, count, rowHeight)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open full screen ↗
                    </a>
                  </>
                )}
              </div>
            </div>
            {running && (
              <progress
                aria-label="Benchmark lite progress"
                value={lite.completed}
                max={lite.total}
              />
            )}
            <div className="table-head">
              <span>ROW #</span>
              <span>RESOURCE</span>
              <span className="region">REGION</span>
              <span>USAGE</span>
              <span>STATUS</span>
            </div>
            <div className="viewport-shell" inert={running}>
              {previewFailure || previewPaused ? (
                <div className="preview-error" role="alert">
                  <strong>{previewFailure ? "Preview stopped" : "Preview paused after the run"}</strong>
                  <span>{previewFailure || "The table is unloaded. Results are kept below; resume when you want to scroll again."}</span>
                  {!running && <button onClick={() => { resetPreview(); setMountId((n) => n + 1); }}>{previewFailure ? "Retry preview" : "Resume preview"}</button>}
                </div>
              ) : shown && (
                <PreviewBoundary
                  key={`${shown}-${count}-${rowHeight}-${mountId}`}
                  onError={failPreview}
                >
                <Adapter
                  engine={shown}
                  count={count}
                  rowHeight={rowHeight}
                  apiRef={apiRef}
                  physicalCap={physicalCap}
                />
                </PreviewBoundary>
              )}
            </div>
            <div className="table-footer">
              {running ? (
                <>
                  <span>Automated scrolling in progress</span>
                  <span>Same row content for every library</span>
                </>
              ) : (
                <>
                  <span>
                    Visible rows{" "}
                    <b>
                      {stats?.first != null
                        ? `${fmt(stats.first + 1)}–${fmt(stats.last + 1)}`
                        : "—"}
                    </b>
                  </span>
                  <span>{stats?.mounted ?? "—"} mounted rows</span>
                </>
              )}
            </div>
            {!running && <div className={`heap-status ${heapPressure(heap).level}`} role="status">
              <span><b>Page JS heap · approximate:</b> {heapLabel(heap)}</span>
              {["warning", "critical"].includes(heapPressure(heap).level) &&
                <strong>Near memory limit · warning at 80%, stop at 90%.</strong>}
            </div>}
            <form className="jump-bar" onSubmit={goToRow}>
              <label htmlFor="jump">Jump to row</label>
              <input
                id="jump"
                type="number"
                min="1"
                max={count}
                value={jump}
                disabled={previewUnavailable}
                onChange={(e) => setJump(e.target.value)}
              />
              <button disabled={previewUnavailable}>Go ↗</button>
              <button
                type="button"
                disabled={previewUnavailable}
                onClick={() => {
                  try { apiRef.current?.jump(0); } catch (error) { failPreview(error); }
                }}
              >
                First row
              </button>
              <button type="button" disabled={previewUnavailable} onClick={checkEnd}>
                Check last row
              </button>
              <small>Quick check · not a timed run</small>
            </form>
          </div>
          {finding && (
            <div className="finding" role="status">
              {finding.error ? (
                finding.error
              ) : (
                <>
                  <strong>
                    {finding.name} · row {fmt(finding.count)}
                  </strong>
                  <span>
                    Row jump: <b>{finding.jump ? "passed" : "failed"}</b>
                  </span>
                  <span>
                    Native end: <b>{finding.native ? "passed" : "failed"}</b>
                  </span>
                </>
              )}
            </div>
          )}
        </section>

        <LiteSection
          busy={busy}
          running={running}
          shown={shown}
          count={count}
          rowHeight={rowHeight}
          selected={engineById(engine)}
          runs={liteRuns}
          setup={liteSetup}
          message={liteMessage}
          onRun={runLite}
        />

        <section id="method" className="mechanics">
          <div className="section-line">
            <h2>
              <span>03</span> How the demo works
            </h2>
          </div>
          <details>
            <summary>What the preview renders and checks</summary>
            <p>
              One library is mounted at a time. Every adapter renders the same
              generated row content in a {VIEWPORT}px viewport. Row content is
              created from the row index when it is rendered; no records are
              loaded. <b>Check last row</b> moves to the native scroll end, then
              jumps to the last index, and checks after six frames that the last
              row is visible without overlap. It is a quick check, not a timed
              run.
            </p>
            <p>
              <b>Benchmark lite</b> mounts each library in the live list in
              turn, {LITE_PASSES} passes in rotated order. Each pass jumps to
              the first, middle and last row, checks the native end, then
              requests a three-row scroll on each of {LITE_FRAMES} animation
              frames and counts the mounted rows. Everything runs in this tab,
              so other tabs, extensions and a development build all affect the
              numbers.
              Page controls and scrolling are locked during the run. Hiding the
              tab, leaving the window or resizing stops it. Each pass unmounts
              its table and releases its API reference before the next pass;
              the browser decides when to reclaim memory.
            </p>
            <p>
              react-window, TanStack Virtual and VitScroll request {OVERSCAN}{" "}
              overscan rows. React Virtuoso uses fixedItemHeight and a viewport
              buffer of {OVERSCAN} row heights above and below. virtua
              measures every row, with the row height as its size hint and a
              buffer of {OVERSCAN} row heights.
              react-virtualized and AG Grid use their own buffering semantics
              with a setting of {OVERSCAN}. rc-virtual-list has a built-in
              buffer with no equivalent configurable overscan. Mounted row
              counts therefore differ.
            </p>
            <p>
              rc-virtual-list {engineById("rc").version} is the original
              unscoped package. It requires an array of numeric row IDs. Its
              custom scrollbar is not exercised by the native-end check. React
              Virtuoso uses totalCount and virtua a length-only data object,
              so neither allocates data records.
            </p>
            <p>
              react-virtualized scales coordinates. AG Grid Community stretches
              coordinates and uses a synchronous infinite-row datasource with
              100-row blocks and at most four cached blocks. VitScroll maps a
              bounded spacer and preserves logical-pixel wheel movement. Native
              scrollbar movement can become coarse with compression.
            </p>
          </details>
          <div className="sources">
            <span>PRIMARY SOURCES</span>
            <a
              href="https://mui.com/x/react-data-grid/virtualization/"
              target="_blank"
              rel="noreferrer"
            >
              Browser limits ↗
            </a>
            <a href="https://virtuoso.dev/" target="_blank" rel="noreferrer">
              React Virtuoso ↗
            </a>
            <a
              href="https://github.com/react-component/virtual-list/tree/v3.19.2"
              target="_blank"
              rel="noreferrer"
            >
              rc-virtual-list ↗
            </a>
            <a
              href="https://www.ag-grid.com/javascript-data-grid/massive-row-count/"
              target="_blank"
              rel="noreferrer"
            >
              AG Grid stretching ↗
            </a>
          </div>
        </section>
        <footer>
          <span className="brand">↕ scrollbench</span>
          <span>Fixed-height React lists. Live demo and benchmark lite; published results on the Benchmarks page.</span>
        </footer>
      </main>
      {running && <LiteRunGuard lite={lite} name={active.name} onInterrupt={interruptLite} />}
    </>
  );
}

function LiteRunGuard({ lite, name, onInterrupt }) {
  const stop = useRef(null);
  const interrupt = useRef(onInterrupt);
  interrupt.current = onInterrupt;
  useLayoutEffect(() => lockLitePage(
    document.getElementById("root"), stop.current,
    (message) => interrupt.current(message),
  ), []);
  return createPortal(
    <div className="run-guard" role="dialog" aria-modal="true" aria-labelledby="run-guard-title" aria-describedby="run-guard-help">
      <div>
        <strong id="run-guard-title">Benchmark running · page locked</strong>
        <p id="run-guard-help">Keep this tab visible and focused. Don’t resize the window.</p>
        <span role="status">{name} · pass {lite.round}/{LITE_PASSES} · {lite.completed}/{lite.total} complete</span>
      </div>
      <button ref={stop} className="stop-button" onClick={() => onInterrupt()}>Stop</button>
    </div>, document.body,
  );
}
function LiteSection({ busy, running, shown, count, rowHeight, selected, runs, setup, message, onRun }) {
  return (
    <section id="benchmark-lite" className="lite-section">
      <div className="section-line">
        <h2>
          <span>02</span> Benchmark lite
        </h2>
        <span className="section-meta">QUICK · IN THIS TAB · NOT PUBLISHED</span>
      </div>
      <div className="lite-card">
        <p>
          A quick in-tab comparison on the live list above, with your rows and
          row height. It is not the benchmark. The{" "}
          <a href={BENCHMARKS_URL}>published benchmark results</a> come from{" "}
          <code>npm run bench</code>, which runs every pass in a fresh browser
          process with time and memory budgets, in Chromium, Firefox and WebKit.
        </p>
        <div className="lite-actions">
          <button className="primary" disabled={busy} onClick={() => onRun("all")}>
            {`Run all ${ENGINES.length} libraries`} <span>→</span>
          </button>
          <button className="secondary" disabled={busy} onClick={() => onRun("selected")}>
            {`Run ${selected.name} only`}
          </button>
          <small>
            {fmt(count)} rows × {rowHeight}px · {LITE_PASSES} passes per library.
            The page locks while running. Keep this tab visible and focused;
            don’t resize the window. Stop stays available.
          </small>
        </div>
      </div>
      {message && (
        <div className="run-message" role="status">
          {message}
        </div>
      )}
      {setup && (
        <>
          {(setup.count !== count || setup.rowHeight !== rowHeight) && !running && (
            <p className="setup-warning">
              These results use {fmt(setup.count)} rows × {setup.rowHeight}px.
              Run again to measure the current setup.
            </p>
          )}
          {!import.meta.env.PROD && (
            <p className="setup-warning">
              Development build. Use <code>npm run build</code> and{" "}
              <code>npm run preview</code> for comparable timings.
            </p>
          )}
          <div
            className="results-scroll"
            tabIndex={0}
            role="region"
            aria-label="Benchmark lite results"
          >
            <table className="results-table">
              <thead>
                <tr>
                  <th>Library</th>
                  <th>Row jumps</th>
                  <th>Native end</th>
                  <th>
                    Ready <small>median ms ↓</small>
                  </th>
                  <th>
                    DOM rows <small>max</small>
                  </th>
                  <th>Passes</th>
                  <th>Page heap <small>largest sample · approximate</small></th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {ENGINES.filter((item) => setup.ids.includes(item.id)).map((item) => {
                  const attempts = runs.filter((r) => r.engine === item.id);
                  const done = attempts.filter((r) => r.status === "completed");
                  const ended = attempts.find((r) => r.status !== "completed");
                  const observedHeap = attempts.reduce((peak, run) => peakHeap(peak, run.heapPeak), null);
                  const pressure = heapPressure(observedHeap);
                  const seeks = attempts.flatMap((run) => run.seeks ?? []);
                  const nativeChecks = attempts.filter((run) => typeof run.nativeEnd === "boolean");
                  const now = running && shown === item.id;
                  const status = now
                    ? "Running now"
                    : ended
                      ? "Incomplete"
                      : done.length === LITE_PASSES
                        ? item.note
                        : running ? "Waiting" : "Not completed";
                  return (
                    <tr key={item.id} className={now ? "active-result" : ""}>
                      <th scope="row">
                        <span className="result-engine">
                          <i style={{ background: item.color }} />
                          <span>
                            {item.name}
                            <small>
                              v{item.version} · {status}
                            </small>
                          </span>
                        </span>
                      </th>
                      <td>
                        {seeks.length ? <>
                          {ended && seeks.every((seek) => seek.reached)
                            ? <span>Incomplete</span>
                            : <ResultBadge passed={seeks.every((seek) => seek.reached)} />}
                          <small className="check-count">{seeks.filter((seek) => seek.reached).length}/{seeks.length} observed{ended ? " · partial" : ""}</small>
                        </> : "—"}
                      </td>
                      <td>
                        {nativeChecks.length ? <ResultBadge passed={nativeChecks.every((r) => r.nativeEnd)} /> : "—"}
                      </td>
                      <td>
                        {done.length
                          ? percentile(done.map((r) => r.readyMs), 0.5).toFixed(0)
                          : "—"}
                      </td>
                      <td>
                        {done.length ? Math.max(...done.map((r) => r.mountedAfterScroll)) : "—"}
                      </td>
                      <td>
                        <span className="passes">
                          {done.length}/{LITE_PASSES}
                        </span>
                      </td>
                      <td className={`heap-result ${pressure.level}`}>
                        <span>{attempts.length ? heapLabel(observedHeap) : "Not measured"}</span>
                        {["warning", "critical"].includes(pressure.level) && <strong>Near memory limit</strong>}
                      </td>
                      <td className="lite-outcome">
                        {ended ? <><b>{({ "resource-budget": "Memory stop", timeout: "Time limit", stopped: "Stopped", error: "Runtime error" })[ended.status] ?? "Error"}</b><small>{ended.error}</small></>
                          : done.length === LITE_PASSES
                            ? seeks.some((seek) => !seek.reached) || nativeChecks.some((run) => !run.nativeEnd)
                              ? <><b>Checks failed</b><small>{seeks.some((seek) => !seek.reached) ? `Could not reach row ${fmt(seeks.find((seek) => !seek.reached).target + 1)}. ` : ""}{nativeChecks.some((run) => !run.nativeEnd) ? "Native end did not reach the last row." : ""}</small></>
                              : "Checks passed"
                            : now ? "Running" : running ? "Waiting" : attempts.length ? "Incomplete" : "Not run"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="results-note">
        <b>Row jumps</b>: first, middle and last row visible without overlap
        after six frames. <b>Native end</b>: the last row is visible at the
        container’s maximum scroll. <b>Ready</b>: mount to four frames later.{" "}
        <b>DOM rows</b>: mounted rows after scrolling, not memory. <b>Page heap</b>: approximate total shared by
        this page, including earlier libraries awaiting garbage collection;
        not a per-library measurement. Warn at 80% of the reported limit and
        stop at 90%. Missing memory stays unavailable. Each pass has a 25-second
        cooperative deadline; a blocked or crashed renderer cannot report back.
        Runtime failures skip that library’s remaining repeats and continue with
        the others. Memory pressure stops the whole run. Each pass unloads its
        table and releases its API reference. The preview stays unloaded after
        the run until you resume it. Garbage collection is controlled by the
        browser: cleanup does not guarantee a fresh heap between passes. Results
        stay in this tab.
      </p>
    </section>
  );
}
function ResultBadge({ passed }) {
  return (
    <span className={`pill ${passed ? "good" : "bad"}`}>
      {passed ? "✓ Passed" : "× Failed"}
    </span>
  );
}
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")).render(
  params.has("audit") ? (
    <AuditFixture physicalCap={physicalCap} />
  ) : params.has("table") ? (
    <Standalone physicalCap={physicalCap} limit={probe.height} />
  ) : (
    <App />
  ),
);
