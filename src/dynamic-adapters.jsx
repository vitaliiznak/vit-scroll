import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { List, useDynamicRowHeight } from "react-window";
import { useVirtualizer } from "@tanstack/react-virtual";
import { List as ScaledList, CellMeasurer, CellMeasurerCache } from "react-virtualized";
import { Virtuoso } from "react-virtuoso";
import { VList } from "virtua";
import RcVirtualList from "rc-virtual-list";
import { DataRow, OVERSCAN, VIEWPORT, gridTheme } from "./adapters.jsx";
import { rowSize, DYNAMIC_ESTIMATE, DYNAMIC_HEIGHTS } from "./row-scenario.mjs";

// Height is known to the fixture's content, but not supplied to the virtualizers.
// Each library must measure the DOM and react when it changes after mount.
function Content({ index, expanded }) {
  return <div className="audit-dynamic-content" style={{ "--audit-row-height": `${rowSize(index, { expanded })}px` }}>
    <DataRow index={index} style={{ height: "100%" }} />
  </div>;
}

function WindowRow({ index, style, ariaAttributes, expanded }) {
  return <div style={style} {...ariaAttributes}><Content index={index} expanded={expanded} /></div>;
}

function useApi(apiRef, element, jump) {
  useLayoutEffect(() => {
    apiRef.current = {
      get element() { return element(); },
      jump,
      bottom() { this.element.scrollTop = this.element.scrollHeight; },
    };
    return () => { apiRef.current = null; };
  });
}

function DynamicWindow({ count, apiRef, expanded }) {
  const list = useRef(null);
  const heights = useDynamicRowHeight({ defaultRowHeight: DYNAMIC_ESTIMATE });
  useApi(apiRef, () => list.current?.element, (index) => list.current.scrollToRow({ index, align: "start", behavior: "instant" }));
  return <List className="viewport" tabIndex={0} listRef={list} rowCount={count}
    rowHeight={heights} rowComponent={WindowRow} rowProps={{ expanded }}
    overscanCount={OVERSCAN} defaultHeight={VIEWPORT} style={{ height: VIEWPORT }} />;
}

function DynamicTanStack({ count, apiRef, expanded }) {
  const host = useRef(null);
  const virtual = useVirtualizer({ count, getScrollElement: () => host.current,
    estimateSize: () => DYNAMIC_ESTIMATE, overscan: OVERSCAN });
  useApi(apiRef, () => host.current, (index) => virtual.scrollToIndex(index, { align: "start", behavior: "auto" }));
  return <div className="viewport" ref={host} tabIndex={0} style={{ height: VIEWPORT }}>
    <div style={{ height: virtual.getTotalSize(), position: "relative", width: "100%" }}>
      {virtual.getVirtualItems().map((item) => <div key={item.key} data-index={item.index}
        ref={virtual.measureElement} style={{ position: "absolute", top: 0, width: "100%", transform: `translateY(${item.start}px)` }}>
        <Content index={item.index} expanded={expanded} />
      </div>)}
    </div>
  </div>;
}

function DynamicVirtuoso({ count, apiRef, expanded }) {
  const list = useRef(null), host = useRef(null);
  const scrollerRef = useCallback((node) => { host.current = node; }, []);
  useApi(apiRef, () => host.current, (index) => list.current.scrollToIndex({ index, align: "start", behavior: "auto" }));
  return <Virtuoso ref={list} scrollerRef={scrollerRef} className="viewport" tabIndex={0}
    totalCount={count} defaultItemHeight={DYNAMIC_ESTIMATE} style={{ height: VIEWPORT }}
    increaseViewportBy={OVERSCAN * DYNAMIC_ESTIMATE}
    itemContent={(index) => <Content index={index} expanded={expanded} />} />;
}

function DynamicVirtua({ count, apiRef, expanded }) {
  const list = useRef(null), host = useRef(null);
  const rows = useMemo(() => ({ length: count }), [count]);
  useApi(apiRef, () => host.current?.firstElementChild, (index) => list.current.scrollToIndex(index, { align: "start" }));
  return <div ref={host}><VList ref={list} className="viewport" tabIndex={0} style={{ height: VIEWPORT }}
    data={rows} itemSize={DYNAMIC_ESTIMATE} bufferSize={OVERSCAN * DYNAMIC_ESTIMATE}>
    {(_, index) => <Content index={index} expanded={expanded} />}
  </VList></div>;
}

const itemKey = (index) => index;
function DynamicRc({ count, apiRef, expanded }) {
  const list = useRef(null);
  const data = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);
  useApi(apiRef, () => list.current?.nativeElement.querySelector(".rc-virtual-list-holder"),
    (index) => list.current.scrollTo({ index, align: "top" }));
  return <RcVirtualList ref={list} data={data} height={VIEWPORT} itemHeight={32} itemKey={itemKey} tabIndex={0}>
    {(index) => <div><Content index={index} expanded={expanded} /></div>}
  </RcVirtualList>;
}

function MeasuredContent({ index, expanded, measure }) {
  const content = useRef(null);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [measure]);
  return <div ref={content}><Content index={index} expanded={expanded} /></div>;
}

function DynamicScaled({ count, apiRef, expanded }) {
  const host = useRef(null), list = useRef(null);
  const [width, setWidth] = useState(900);
  const cache = useMemo(() => new CellMeasurerCache({ fixedWidth: true, defaultHeight: DYNAMIC_ESTIMATE }), []);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      setWidth(host.current.clientWidth);
      cache.clearAll();
      list.current.recomputeRowHeights();
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [cache]);
  useLayoutEffect(() => {
    cache.clearAll();
    list.current.recomputeRowHeights();
  }, [cache, expanded]);
  useApi(apiRef, () => host.current?.querySelector(".ReactVirtualized__List"), (index) => list.current.scrollToRow(index));
  return <div ref={host}><ScaledList ref={list} className="viewport" width={width} height={VIEWPORT}
    rowCount={count} rowHeight={cache.rowHeight} deferredMeasurementCache={cache}
    estimatedRowSize={DYNAMIC_ESTIMATE} overscanRowCount={OVERSCAN} scrollToAlignment="start"
    rowRenderer={({ index, key, style, parent }) => <CellMeasurer key={key} cache={cache} parent={parent} columnIndex={0} rowIndex={index}>
      {({ measure, registerChild }) => <div ref={registerChild} style={style}>
        <MeasuredContent index={index} expanded={expanded} measure={measure} />
      </div>}
    </CellMeasurer>} /></div>;
}

// AG Grid's Infinite Row Model positions rows at index * rowHeight, so measured heights need
// the Client-Side Row Model with colDef.autoHeight. That model holds one data object and
// RowNode per row; the allocation is charged to this run, as rc-virtual-list's array is.
// autoHeight uses max(content, rowHeight), so rowHeight is the 32px minimum, not an estimate.
const AgExpanded = createContext(false);
function AgCell({ data }) {
  return <Content index={data.id} expanded={useContext(AgExpanded)} />;
}
const agDynamicTheme = gridTheme.withParams({ rowBorder: false, cellHorizontalPadding: 0 });
const agDynamicColumns = [{ field: "id", flex: 1, autoHeight: true, cellRenderer: AgCell, cellClass: "audit-ag-cell" }];
function DynamicAg({ count, apiRef, expanded }) {
  const host = useRef(null), grid = useRef(null);
  const rowData = useMemo(() => Array.from({ length: count }, (_, id) => ({ id })), [count]);
  useApi(apiRef, () => host.current?.querySelector(".ag-grid-viewport"),
    (index) => grid.current?.ensureIndexVisible(index, "top"));
  return <div ref={host} style={{ height: VIEWPORT }}>
    <AgExpanded.Provider value={expanded}>
      <AgGridReact theme={agDynamicTheme} onGridReady={({ api }) => { grid.current = api; }}
        rowData={rowData} columnDefs={agDynamicColumns} rowHeight={DYNAMIC_HEIGHTS[0]}
        rowBuffer={OVERSCAN} headerHeight={0} animateRows={false}
        suppressHorizontalScroll suppressCellFocus />
    </AgExpanded.Provider>
  </div>;
}

export function DynamicAdapter({ engine, ...props }) {
  const Component = { window: DynamicWindow, tanstack: DynamicTanStack, scaled: DynamicScaled, virtuoso: DynamicVirtuoso, virtua: DynamicVirtua, rc: DynamicRc, ag: DynamicAg }[engine];
  if (!Component) throw new Error(`Dynamic heights unsupported in ${engine} adapter`);
  return <Component {...props} />;
}
