import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Adapter, ENGINES, inspect } from "./adapters.jsx";
import { LibraryLinks } from "./LibraryLinks.jsx";
import { WindowAdapter } from "./window-adapters.jsx";
import {
  COMPRESSED,
  FULL_HEIGHT,
  reachability,
  readTableConfig,
  tableUrl,
  WINDOW_SUPPORT,
  WINDOW_LIMITS,
} from "./standalone-config.mjs";
import { readPageHeap } from "./measurements.mjs";
import { heapLabel, heapPressure } from "./preview-health.mjs";
import { PreviewBoundary } from "./PreviewBoundary.jsx";
import { DEMO_URL } from "./SiteHeader.jsx";

const fmt = (value) => new Intl.NumberFormat("en-US").format(value);
const mpx = (px) =>
  px >= 1e9 ? `${+(px / 1e9).toFixed(2)}B px` : `${+(px / 1e6).toFixed(2)}M px`;

// Why a library can or cannot show every row at this size, in this browser.
function reachText({ id, name }, count, rowHeight, reach) {
  const size = `${fmt(count)} rows × ${rowHeight}px = ${mpx(reach.total)}`;
  const limit = `this browser’s ${mpx(reach.limit)} height limit`;
  if (reach.fails)
    return {
      title: "Can’t show all rows",
      body: `${size}, above ${limit}. ${name} ${FULL_HEIGHT[id]}, so the browser cuts it off near row ${fmt(reach.lastRow)}: the last ${fmt(reach.hidden)} rows can’t be reached by scrolling or jumping.`,
    };
  if (reach.total > reach.limit)
    return {
      title: "Shows all rows",
      body: `${size} is above ${limit}, but ${name} ${COMPRESSED[id]}.`,
    };
  return {
    title: "Shows all rows",
    body: `${size} fits under ${limit}.${FULL_HEIGHT[id] ? ` ${name} ${FULL_HEIGHT[id]}, so above ${fmt(Math.floor(reach.limit / rowHeight))} rows it would stop short.` : ""}`,
  };
}

// A library tab with a hover/focus explanation. The popover is portalled with
// fixed positioning so the horizontally scrolling tab strip cannot clip it.
function LibraryTab({ item, href, current, text, fails }) {
  const ref = useRef(null);
  const descId = useId();
  const [pos, setPos] = useState(null);
  const show = () => {
    const rect = ref.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, innerWidth - 328)),
    });
  };
  const hide = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    addEventListener("scroll", hide, true);
    return () => removeEventListener("scroll", hide, true);
  }, [pos]);
  return (
    <>
      <a
        ref={ref}
        href={href}
        className={fails ? "fails" : undefined}
        aria-current={current ? "page" : undefined}
        aria-describedby={descId}
        onPointerEnter={(event) => event.pointerType === "mouse" && show()}
        onPointerLeave={hide}
        onFocus={(event) => event.currentTarget.matches(":focus-visible") && show()}
        onBlur={hide}
      >
        <i style={{ background: item.color }} />
        {item.name}
      </a>
      <span id={descId} hidden>
        {text.title}. {text.body}
      </span>
      {pos &&
        createPortal(
          <div
            className={`tab-tip ${fails ? "fails" : ""}`}
            role="tooltip"
            style={pos}
          >
            <strong>
              {item.name} · {text.title}
            </strong>
            <p>{text.body}</p>
          </div>,
          document.body,
        )}
    </>
  );
}

export function Standalone({ physicalCap, limit }) {
  const config = readTableConfig(location.search);
  if (config.error)
    return (
      <main className="standalone-error">
        <h1>Cannot open this table</h1>
        <p role="alert">{config.error}</p>
        <a href={DEMO_URL}>← Back to the demo</a>
      </main>
    );
  return <TablePage {...config} physicalCap={physicalCap} limit={limit} />;
}

function TablePage({ engine, mode, count, rowHeight, physicalCap, limit }) {
  const library = ENGINES.find((item) => item.id === engine);
  // Native page scroll where the library supports it; otherwise its own
  // scroll container, sized to fill the screen below the bar.
  const pageScroll = mode === "window" && !!WINDOW_SUPPORT[engine];
  const apiRef = useRef(null);
  const bar = useRef(null);
  const tabs = useRef(null);
  const [topInset, setTopInset] = useState(120);
  const [screenHeight, setScreenHeight] = useState(innerHeight);
  const [jump, setJump] = useState(String(count));
  const [stats, setStats] = useState(null);
  const [heap, setHeap] = useState(null);
  const [failure, setFailure] = useState(null);
  const [draftCount, setDraftCount] = useState(count);
  const [draftHeight, setDraftHeight] = useState(rowHeight);
  // Keep container mode only when chosen; libraries without page scroll get it anyway.
  const tabMode = WINDOW_SUPPORT[engine] && !pageScroll ? "container" : undefined;
  // Page scroll spends the content above the list toward the height limit too.
  const reachOf = (id, page) =>
    reachability(id, count, rowHeight, limit, page ? topInset : 0);
  const reach = reachOf(engine, pageScroll);

  useLayoutEffect(() => {
    const update = () => {
      setTopInset(bar.current.getBoundingClientRect().height);
      setScreenHeight(innerHeight);
    };
    const observer = new ResizeObserver(update);
    observer.observe(bar.current);
    addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      removeEventListener("resize", update);
    };
  }, []);
  useLayoutEffect(() => {
    // On narrow screens the tab strip scrolls; keep the open library in view.
    const strip = tabs.current;
    const current = strip.querySelector("[aria-current]");
    strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
  }, []);
  useEffect(() => {
    document.title = `${library.name} · ${pageScroll ? "Page scroll" : "Container"} · ScrollBench`;
    const timer = setInterval(() => {
      setStats(inspect(apiRef.current, count));
      const sample = readPageHeap();
      setHeap(sample);
      if (heapPressure(sample).level === "critical")
        setFailure(`Preview stopped near the page heap limit: ${heapLabel(sample)}. Reduce the rows or choose another library.`);
    }, 200);
    return () => clearInterval(timer);
  }, [library.name, pageScroll, count]);

  const act = (action) => {
    if (failure || !apiRef.current) return;
    try { action(apiRef.current); } catch (error) { setFailure(error.message); }
  };

  return (
    <div className="standalone" style={{ paddingTop: topInset }}>
      <div className="standalone-bar" ref={bar}>
        <div className="standalone-top">
          <a className="standalone-back" href={DEMO_URL}>
            ← Demo
          </a>
          <nav className="library-tabs" aria-label="Libraries" ref={tabs}>
            {ENGINES.map((item) => {
              const tabReach = reachOf(
                item.id,
                !!WINDOW_SUPPORT[item.id] && tabMode !== "container",
              );
              return (
                <LibraryTab
                  key={item.id}
                  item={item}
                  href={tableUrl(item.id, count, rowHeight, tabMode)}
                  current={item.id === engine}
                  fails={tabReach.fails}
                  text={reachText(item, count, rowHeight, tabReach)}
                />
              );
            })}
          </nav>
          <span className="standalone-visible" role="status" aria-live="polite">
            {stats?.first != null ? (
              <>
                Rows {fmt(stats.first + 1)}–{fmt(stats.last + 1)}
                <span className="of"> of {fmt(count)}</span>
              </>
            ) : (
              `${fmt(count)} rows`
            )}
          </span>
        </div>
        <div className="standalone-tools">
          <LibraryLinks id={engine} />
          <div className="scroll-mode" role="group" aria-label="Scroll with">
            {WINDOW_SUPPORT[engine] ? (
              <a
                href={tableUrl(engine, count, rowHeight, "window")}
                aria-current={pageScroll ? "true" : undefined}
                title={WINDOW_SUPPORT[engine]}
              >
                Page scroll
              </a>
            ) : (
              <span aria-disabled="true" title={WINDOW_LIMITS[engine]}>
                Page scroll
              </span>
            )}
            <a
              href={tableUrl(engine, count, rowHeight, "container")}
              aria-current={pageScroll ? undefined : "true"}
            >
              Container
            </a>
          </div>
          <form
            className="standalone-config"
            onSubmit={(event) => {
              event.preventDefault();
              location.href = tableUrl(engine, draftCount, draftHeight, tabMode);
            }}
          >
            <label>
              Rows
              <input
                type="number"
                min="1"
                max={100_000_000}
                step="1"
                required
                value={draftCount}
                onChange={(event) => setDraftCount(event.target.valueAsNumber)}
              />
            </label>
            <label>
              Row height
              <input
                className="narrow"
                type="number"
                min="24"
                max="120"
                step="1"
                required
                value={draftHeight}
                onChange={(event) => setDraftHeight(event.target.valueAsNumber)}
              />
            </label>
            <button type="submit">Apply</button>
          </form>
          <div className="standalone-actions">
            <button disabled={!!failure} onClick={() => act((api) => api.jump(0))}>First row</button>
            <button disabled={!!failure} onClick={() => act((api) => api.jump(Math.floor(count / 2)))}>
              Middle row
            </button>
            <button disabled={!!failure} onClick={() => act((api) => api.bottom())}>
              Native scroll end
            </button>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                act((api) => api.jump(
                  Math.min(count - 1, Math.max(0, Number(jump) - 1)),
                ));
              }}
            >
              <input
                aria-label="Jump to row number"
                type="number"
                min="1"
                max={count}
                step="1"
                required
                value={jump}
                onChange={(event) => setJump(event.target.value)}
              />
              <button disabled={!!failure}>Jump</button>
            </form>
          </div>
          <span className="page-memory" title="Approximate page total, including the app. Isolated memory is on the Benchmarks page.">
            Page heap · approximate: {heapLabel(heap)}
          </span>
        </div>
        {["warning", "critical"].includes(heapPressure(heap).level) && (
          <p className="heap-status warning" role="status">
            Near memory limit · warning at 80%, stop at 90% of the reported page heap limit.
          </p>
        )}
        {reach.fails && (
          <p className="mode-note fails" role="note">
            <b>Can’t show all rows.</b>{" "}
            {reachText(library, count, rowHeight, reach).body}
          </p>
        )}
        {!WINDOW_SUPPORT[engine] && (
          <p className="mode-note">
            <b>No page scroll.</b> {WINDOW_LIMITS[engine]} It fills the
            screen in its own scroll container instead.
          </p>
        )}
        <div className="table-head">
          <span>ROW #</span>
          <span>RESOURCE</span>
          <span className="region">REGION</span>
          <span>USAGE</span>
          <span>STATUS</span>
        </div>
      </div>
      <main
        className="standalone-table"
        aria-label={`${library.name} table`}
      >
        {failure ? <div className="preview-error" role="alert">
          <strong>Preview stopped</strong><span>{failure}</span>
          <span>Choose another library or reduce the number of rows above.</span>
        </div> : <PreviewBoundary onError={(error) => setFailure(error.message)}>
        {pageScroll ? (
          <WindowAdapter
            engine={engine}
            count={count}
            rowHeight={rowHeight}
            apiRef={apiRef}
            physicalCap={physicalCap}
            topInset={topInset}
          />
        ) : (
          <div
            className="viewport-shell"
            style={{ height: Math.max(240, screenHeight - topInset) }}
          >
            <Adapter
              engine={engine}
              count={count}
              rowHeight={rowHeight}
              apiRef={apiRef}
              physicalCap={physicalCap}
              height={Math.max(240, screenHeight - topInset)}
            />
          </div>
        )}
        </PreviewBoundary>}
      </main>
    </div>
  );
}
