import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import { List as ScaledList } from "react-virtualized";
import { AgGridReact } from "ag-grid-react";
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
} from "ag-grid-community";
import { useVirtualizer } from "@tanstack/react-virtual";
import { List } from "react-window";
import { Virtuoso } from "react-virtuoso";
import { VList } from "virtua";
import RcVirtualList from "rc-virtual-list";
import { VitScroll } from "../packages/vit-scroll/react.jsx";

export const VIEWPORT = 360;
export const OVERSCAN = 6;
ModuleRegistry.registerModules([AllCommunityModule]);
export const gridTheme = themeQuartz.withParams({
  backgroundColor: "#ffffff",
  foregroundColor: "#202a35",
  borderColor: "#e1e5e9",
  wrapperBorder: false,
  browserColorScheme: "light",
});
export { ENGINES } from "./engines.mjs";
const regions = [
  "Zürich",
  "Lisbon",
  "Copenhagen",
  "Amsterdam",
  "Berlin",
  "Stockholm",
];
const types = ["Compute", "Storage", "Network", "Database"];
const number = new Intl.NumberFormat("en-US");

export const DataRow = memo(function DataRow({ index, style, ariaAttributes }) {
  const value = ((index * 7919 + 43) % 99900) / 100;
  return (
    <div
      className="data-row"
      data-row-index={index}
      style={style}
      {...(ariaAttributes || { role: "listitem" })}
    >
      <span className="row-id">
        {number.format(index + 1).padStart(7, "0")}
      </span>
      <span className="resource">
        <i className={`resource-icon icon-${index % 4}`}>
          {["◈", "▤", "⌁", "▥"][index % 4]}
        </i>
        {types[index % 4]}
        <small>res_{(index + 8192).toString(16)}</small>
      </span>
      <span className="region">{regions[index % 6]}</span>
      <span className="row-value">{value.toFixed(2)}</span>
      <span className={`status ${index % 13 === 0 ? "idle" : ""}`}>
        <i />
        {index % 13 === 0 ? "Idle" : "Active"}
      </span>
    </div>
  );
});

// Same row content and viewport; buffering APIs differ by library.
function VirtuosoAdapter({ count, rowHeight, apiRef, height }) {
  const list = useRef(null);
  const element = useRef(null);
  const scrollerRef = useCallback((node) => {
    element.current = node;
  }, []);
  useLayoutEffect(() => {
    apiRef.current = {
      get element() {
        return element.current;
      },
      jump: (index) =>
        list.current.scrollToIndex({ index, align: "start", behavior: "auto" }),
      offset: (top) => list.current.scrollTo({ top, behavior: "auto" }),
      bottom: () => {
        element.current.scrollTop = element.current.scrollHeight;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);
  return (
    <Virtuoso
      ref={list}
      scrollerRef={scrollerRef}
      className="viewport"
      aria-label="React Virtuoso rows"
      tabIndex={0}
      style={{ height }}
      totalCount={count}
      fixedItemHeight={rowHeight}
      increaseViewportBy={{
        top: OVERSCAN * rowHeight,
        bottom: OVERSCAN * rowHeight,
      }}
      itemContent={(index) => (
        <DataRow index={index} style={{ height: rowHeight }} />
      )}
    />
  );
}

// virtua measures every item; itemSize is its documented size hint. A
// length-only ArrayLike satisfies `data` without allocating row records.
function VirtuaAdapter({ count, rowHeight, apiRef, height }) {
  const host = useRef(null);
  const list = useRef(null);
  const rows = useMemo(() => ({ length: count }), [count]);
  useLayoutEffect(() => {
    apiRef.current = {
      get element() {
        return host.current?.firstElementChild;
      },
      jump: (index) => list.current.scrollToIndex(index, { align: "start" }),
      offset: (top) => list.current.scrollTo(top),
      bottom() {
        this.element.scrollTop = this.element.scrollHeight;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);
  return (
    <div ref={host}>
      <VList
        ref={list}
        className="viewport"
        role="list"
        aria-label="virtua rows"
        tabIndex={0}
        style={{ height }}
        data={rows}
        itemSize={rowHeight}
        bufferSize={OVERSCAN * rowHeight}
      >
        {(_, index) => <DataRow index={index} style={{ height: rowHeight }} />}
      </VList>
    </div>
  );
}

const indexKey = (index) => index;
function RcAdapter({ count, rowHeight, apiRef, height }) {
  const list = useRef(null);
  // This library requires an array. Allocate only numeric IDs, not row records.
  // Allocation is deliberately included in mount/readiness timing.
  const data = useMemo(
    () => Array.from({ length: count }, (_, index) => index),
    [count],
  );
  useLayoutEffect(() => {
    apiRef.current = {
      get element() {
        return list.current?.nativeElement.querySelector(
          ".rc-virtual-list-holder",
        );
      },
      jump: (index) => list.current.scrollTo({ index, align: "top" }),
      offset: (top) => list.current.scrollTo(top),
      // Test the native holder separately from the library's custom scrollbar/API.
      bottom() {
        this.element.scrollTop = this.element.scrollHeight;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);
  return (
    <RcVirtualList
      ref={list}
      data={data}
      height={height}
      itemHeight={rowHeight}
      itemKey={indexKey}
      aria-label="rc-virtual-list rows"
      tabIndex={0}
    >
      {(index) => (
        <div style={{ height: rowHeight }}>
          <DataRow index={index} style={{ height: rowHeight }} />
        </div>
      )}
    </RcVirtualList>
  );
}

function TanStackAdapter({ count, rowHeight, apiRef, height }) {
  const element = useRef(null);
  const estimateSize = useCallback(() => rowHeight, [rowHeight]);
  const virtual = useVirtualizer({
    count,
    getScrollElement: () => element.current,
    estimateSize,
    overscan: OVERSCAN,
  });
  useLayoutEffect(() => {
    apiRef.current = {
      element: element.current,
      jump: (index) =>
        virtual.scrollToIndex(index, { align: "start", behavior: "auto" }),
      offset: (top) => virtual.scrollToOffset(top, { behavior: "auto" }),
      bottom: () => {
        element.current.scrollTop = element.current.scrollHeight;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, virtual]);
  return (
    <div
      className="viewport"
      ref={element}
      tabIndex={0}
      role="list"
      aria-label="TanStack Virtual rows"
      style={{ height }}
    >
      <div
        style={{
          height: virtual.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtual.getVirtualItems().map((item) => (
          <DataRow
            key={item.key}
            index={item.index}
            style={{
              position: "absolute",
              top: 0,
              width: "100%",
              height: item.size,
              transform: `translateY(${item.start}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Logical ↔ physical pixels for a spacer capped below the browser's element
// height limit. Written as the application would for TanStack, independent of
// the VitScroll prototype.
function scaleAxis(total, viewport, cap) {
  const physical = Math.max(viewport, Math.min(total, cap));
  const logicalRange = Math.max(0, total - viewport);
  const physicalRange = Math.max(0, physical - viewport);
  const clamp = (n) => Math.max(0, Math.min(logicalRange, n));
  return {
    physical,
    clamp,
    toPhysical: (logical) =>
      logicalRange ? (clamp(logical) / logicalRange) * physicalRange : 0,
    toLogical: (top) =>
      physicalRange ? clamp((top / physicalRange) * logicalRange) : 0,
  };
}

// Best-effort profile. The browser caps element height (about 33.5M px in
// Chromium), and TanStack is headless, so the application owns scrolling: the
// spacer is capped and the documented observeElementOffset / scrollToFn
// options exchange logical offsets with the virtualizer, which still computes
// the range and every item's start. scrollToIndex clamps to the element's
// physical scrollHeight, so jumps scroll to the virtualizer's item start.
function ScaledTanStackAdapter({
  count,
  rowHeight,
  apiRef,
  height,
  physicalCap = 8_000_000,
}) {
  const element = useRef(null);
  const axis = useRef(null);
  const notify = useRef(null);
  const position = useRef({ logical: 0, physical: 0, written: null });
  const estimateSize = useCallback(() => rowHeight, [rowHeight]);
  const moveTo = useCallback((top) => {
    const el = element.current;
    const p = position.current;
    if (!el || !axis.current) return;
    p.logical = axis.current.clamp(top);
    el.scrollTop = axis.current.toPhysical(p.logical);
    // Keep exact logical pixels; ignore the scroll event echoing this write.
    p.physical = p.written = el.scrollTop;
    notify.current?.(p.logical, false);
  }, []);
  const observeElementOffset = useCallback((instance, report) => {
    const el = instance.scrollElement;
    const p = position.current;
    notify.current = report;
    const onScroll = () => {
      if (p.written !== null && Math.abs(el.scrollTop - p.written) < 0.5)
        return;
      p.written = null;
      p.physical = el.scrollTop;
      p.logical = axis.current.toLogical(p.physical);
      report(p.logical, false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    report(p.logical, false);
    return () => {
      el.removeEventListener("scroll", onScroll);
      notify.current = null;
    };
  }, []);
  const scrollToFn = useCallback(
    (offset, { adjustments = 0 }) => moveTo(offset + adjustments),
    [moveTo],
  );
  const virtual = useVirtualizer({
    count,
    getScrollElement: () => element.current,
    estimateSize,
    overscan: OVERSCAN,
    observeElementOffset,
    scrollToFn,
  });
  axis.current = scaleAxis(virtual.getTotalSize(), height, physicalCap);
  useLayoutEffect(() => {
    apiRef.current = {
      element: element.current,
      jump: (index) =>
        moveTo(virtual.measurementsCache[index]?.start ?? index * rowHeight),
      offset: moveTo,
      bottom: () => {
        element.current.scrollTop = element.current.scrollHeight;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, virtual, moveTo, rowHeight]);
  // Native wheel and keys would move physical pixels, magnified by the scale.
  useEffect(() => {
    const el = element.current;
    const wheel = (event) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        return;
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? rowHeight : event.deltaMode === 2 ? height : 1);
      const top = position.current.logical;
      if (axis.current.clamp(top + delta) === top) return;
      event.preventDefault();
      moveTo(top + delta);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [moveTo, rowHeight, height]);
  const onKeyDown = (event) => {
    if (event.target !== event.currentTarget) return;
    const top = position.current.logical;
    const targets = {
      Home: 0,
      End: Infinity,
      ArrowDown: top + rowHeight,
      ArrowUp: top - rowHeight,
      PageDown: top + height,
      PageUp: top - height,
      " ": top + (event.shiftKey ? -height : height),
    };
    if (Object.hasOwn(targets, event.key)) {
      event.preventDefault();
      moveTo(targets[event.key]);
    }
  };
  const { logical, physical } = position.current;
  return (
    <div
      className="viewport"
      ref={element}
      tabIndex={0}
      role="list"
      aria-label="TanStack Virtual rows, scaled coordinates"
      onKeyDown={onKeyDown}
      style={{ height }}
    >
      <div
        style={{
          height: axis.current.physical,
          position: "relative",
          width: "100%",
          overflow: "clip",
        }}
      >
        {virtual.getVirtualItems().map((item) => (
          <DataRow
            key={item.key}
            index={item.index}
            style={{
              position: "absolute",
              top: 0,
              width: "100%",
              height: item.size,
              transform: `translateY(${item.start - logical + physical}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function WindowAdapter({ count, rowHeight, apiRef, height }) {
  const list = useRef(null);
  useLayoutEffect(() => {
    apiRef.current = {
      get element() {
        return list.current?.element;
      },
      jump: (index) =>
        list.current?.scrollToRow({
          index,
          align: "start",
          behavior: "instant",
        }),
      offset: (top) => {
        list.current.element.scrollTop = top;
      },
      bottom: () => {
        list.current.element.scrollTop = list.current.element.scrollHeight;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);
  return (
    <List
      className="viewport"
      aria-label="react-window rows"
      tabIndex={0}
      listRef={list}
      rowComponent={DataRow}
      rowCount={count}
      rowHeight={rowHeight}
      overscanCount={OVERSCAN}
      rowProps={{}}
      defaultHeight={height}
      style={{ height }}
    />
  );
}

function ScaledAdapter({ count, rowHeight, apiRef, height }) {
  const host = useRef(null);
  const list = useRef(null);
  const [width, setWidth] = useState(700);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() =>
      setWidth(host.current.clientWidth),
    );
    setWidth(host.current.clientWidth);
    observer.observe(host.current);
    apiRef.current = {
      get element() {
        return host.current?.querySelector(".ReactVirtualized__List");
      },
      jump: (index) => list.current.scrollToRow(index),
      // Use logical index navigation; scrollToPosition expects physical pixels when scaled.
      offset: (top) => list.current.scrollToRow(Math.floor(top / rowHeight)),
      bottom() {
        this.element.scrollTop = this.element.scrollHeight;
      },
    };
    return () => {
      observer.disconnect();
      apiRef.current = null;
    };
  }, [apiRef, rowHeight]);
  return (
    <div ref={host}>
      <ScaledList
        ref={list}
        className="viewport"
        width={width}
        height={height}
        rowCount={count}
        rowHeight={rowHeight}
        estimatedRowSize={rowHeight}
        overscanRowCount={OVERSCAN}
        scrollToAlignment="start"
        rowRenderer={({ index, key, style }) => (
          <DataRow key={key} index={index} style={style} />
        )}
      />
    </div>
  );
}

function GridRow({ node }) {
  return (
    <DataRow index={node.rowIndex} style={{ height: "100%", width: "100%" }} />
  );
}
function GridAdapter({ count, rowHeight, apiRef, height }) {
  const host = useRef(null);
  const gridApi = useRef(null);
  const datasource = useMemo(
    () => ({
      rowCount: count,
      getRows(params) {
        const end = Math.min(count, params.endRow);
        params.successCallback(
          Array.from({ length: end - params.startRow }, (_, i) => ({
            id: params.startRow + i,
          })),
          count,
        );
      },
    }),
    [count],
  );
  useLayoutEffect(() => {
    apiRef.current = {
      get element() {
        return host.current?.querySelector(".ag-grid-viewport");
      },
      get rowsRoot() {
        return host.current;
      },
      jump: (index) => gridApi.current?.ensureIndexVisible(index, "top"),
      offset: (top) =>
        gridApi.current?.ensureIndexVisible(Math.floor(top / rowHeight), "top"),
      bottom() {
        this.element.scrollTop = this.element.scrollHeight;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, rowHeight]);
  return (
    <div ref={host} style={{ height }}>
      <AgGridReact
        theme={gridTheme}
        onGridReady={({ api }) => {
          gridApi.current = api;
        }}
        rowModelType="infinite"
        datasource={datasource}
        infiniteInitialRowCount={count}
        cacheBlockSize={100}
        maxBlocksInCache={4}
        rowHeight={rowHeight}
        rowBuffer={OVERSCAN}
        headerHeight={0}
        columnDefs={[{ field: "id" }]}
        isFullWidthRow={() => true}
        fullWidthCellRenderer={GridRow}
        animateRows={false}
        suppressHorizontalScroll
        suppressCellFocus
        suppressColumnMoveAnimation
      />
    </div>
  );
}

// height: viewport height in px; the demo uses VIEWPORT, separate pages fill the screen.
export function Adapter({ engine, height = VIEWPORT, ...rest }) {
  const props = { ...rest, height };
  if (engine === "virtuoso") return <VirtuosoAdapter {...props} />;
  if (engine === "virtua") return <VirtuaAdapter {...props} />;
  if (engine === "rc") return <RcAdapter {...props} />;
  if (engine === "scaled") return <ScaledAdapter {...props} />;
  if (engine === "ag") return <GridAdapter {...props} />;
  if (engine === "tanstack") return <TanStackAdapter {...props} />;
  if (engine === "tanstack-scaled")
    return <ScaledTanStackAdapter {...props} />;
  if (engine === "window") return <WindowAdapter {...props} />;
  return (
    <VitScroll
      {...props}
      overscan={OVERSCAN}
      rowComponent={DataRow}
      className="viewport"
      ariaLabel="VitScroll rows"
    />
  );
}

/** Inspect visible row geometry, not just a library's reported indices. */
export function inspect(api, count) {
  const el = api?.element;
  if (!el) return null;
  const rect = api.viewportRect?.() ?? el.getBoundingClientRect();
  const mounted = [
    ...(api.rowsRoot || el).querySelectorAll("[data-row-index]"),
  ];
  const visible = mounted.filter((row) => {
    const r = row.getBoundingClientRect();
    return r.bottom > rect.top + 1 && r.top < rect.bottom - 1;
  });
  const indices = visible.map((row) => Number(row.dataset.rowIndex));
  const boxes = visible
    .map((row) => row.getBoundingClientRect())
    .sort((a, b) => a.top - b.top);
  const overlap = boxes.some(
    (box, i) => i > 0 && box.top < boxes[i - 1].bottom - 1,
  );
  return {
    first: indices.length ? Math.min(...indices) : null,
    last: indices.length ? Math.max(...indices) : null,
    visible: indices,
    mounted: mounted.length,
    scrollHeight: el.scrollHeight,
    scrollTop: el.scrollTop,
    overlap,
    gaps: boxes.some((box, i) => i > 0 && box.top > boxes[i - 1].bottom + 1),
    firstTop: boxes.length ? boxes[0].top - rect.top : null,
    viewportHeight: rect.height,
    lastRowVisible: indices.includes(count - 1) && !overlap,
  };
}
