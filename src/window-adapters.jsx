import React, { useLayoutEffect, useMemo, useRef } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Virtuoso } from "react-virtuoso";
import { WindowVirtualizer } from "virtua";
import { List, WindowScroller } from "react-virtualized";
import {
  VitWindowScroll,
  useWindowLayout,
} from "../packages/vit-scroll/window.jsx";
import { DataRow, OVERSCAN } from "./adapters.jsx";

function pageApi(host, topInset) {
  return {
    element: document.scrollingElement,
    rowsRoot: host.current,
    scrollMode: "window",
    viewportRect: () => ({ top: topInset, bottom: innerHeight }),
    offset: (top) =>
      window.scrollTo({
        top:
          host.current.getBoundingClientRect().top + scrollY - topInset + top,
        behavior: "instant",
      }),
    bottom: () =>
      window.scrollTo({
        top: document.scrollingElement.scrollHeight,
        behavior: "instant",
      }),
  };
}

function TanStackWindow({ count, rowHeight, apiRef, topInset }) {
  const host = useRef(null);
  const layout = useWindowLayout(host, topInset);
  const virtual = useWindowVirtualizer({
    count,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    scrollMargin: layout.top,
    scrollPaddingStart: topInset,
  });
  useLayoutEffect(() => {
    apiRef.current = {
      ...pageApi(host, topInset),
      jump: (index) =>
        virtual.scrollToIndex(index, { align: "start", behavior: "auto" }),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, virtual, topInset]);
  return (
    <div
      ref={host}
      className="window-list"
      role="list"
      aria-label="TanStack Virtual page rows"
      style={{ height: virtual.getTotalSize(), position: "relative" }}
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
            transform: `translateY(${item.start - layout.top}px)`,
          }}
        />
      ))}
    </div>
  );
}

function VirtuosoWindow({ count, rowHeight, apiRef, topInset }) {
  const host = useRef(null);
  const list = useRef(null);
  useLayoutEffect(() => {
    apiRef.current = {
      ...pageApi(host, topInset),
      jump: (index) =>
        list.current.scrollToIndex({
          index,
          align: "start",
          offset: -topInset,
          behavior: "auto",
        }),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, topInset]);
  return (
    <div ref={host} className="window-list">
      <Virtuoso
        ref={list}
        useWindowScroll
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
    </div>
  );
}

function VirtuaWindow({ count, rowHeight, apiRef, topInset }) {
  const host = useRef(null);
  const list = useRef(null);
  const rows = useMemo(() => ({ length: count }), [count]);
  useLayoutEffect(() => {
    apiRef.current = {
      ...pageApi(host, topInset),
      jump: (index) =>
        list.current.scrollToIndex(index, { align: "start", offset: -topInset }),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, topInset]);
  return (
    <div
      ref={host}
      className="window-list"
      role="list"
      aria-label="virtua page rows"
    >
      <WindowVirtualizer
        ref={list}
        data={rows}
        itemSize={rowHeight}
        bufferSize={OVERSCAN * rowHeight}
      >
        {(_, index) => <DataRow index={index} style={{ height: rowHeight }} />}
      </WindowVirtualizer>
    </div>
  );
}

function ScaledWindow({ count, rowHeight, apiRef, topInset }) {
  const host = useRef(null);
  const list = useRef(null);
  const scroller = useRef(null);
  const layout = useWindowLayout(host, topInset);
  useLayoutEffect(() => {
    scroller.current?.updatePosition();
  }, [layout.top, layout.width, layout.height]);
  useLayoutEffect(() => {
    const jump = (index) => {
      const bufferedIndex = Math.max(
        0,
        index - Math.ceil(topInset / rowHeight),
      );
      const offset = list.current.getOffsetForRow({
        alignment: "start",
        index: bufferedIndex,
      });
      // getOffsetForRow returns this library's scaled physical coordinate.
      // Reserve visible rows below the fixed toolbar in logical coordinates,
      // before the library scales them into physical document pixels.
      window.scrollTo({
        top: layout.top + offset - (bufferedIndex === 0 ? topInset : 0),
        behavior: "instant",
      });
    };
    apiRef.current = {
      ...pageApi(host, topInset),
      jump,
      offset: (top) => jump(Math.floor(top / rowHeight)),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, layout.top, rowHeight, topInset]);
  return (
    <WindowScroller ref={scroller}>
      {({ height, isScrolling, onChildScroll, scrollTop, registerChild }) => (
        <div
          ref={(node) => {
            host.current = node;
            registerChild(node);
          }}
          className="window-list"
        >
          <List
            ref={list}
            autoHeight
            width={layout.width}
            height={Math.max(1, height)}
            rowCount={count}
            rowHeight={rowHeight}
            estimatedRowSize={rowHeight}
            overscanRowCount={OVERSCAN}
            isScrolling={isScrolling}
            onScroll={onChildScroll}
            scrollTop={scrollTop}
            scrollToAlignment="start"
            rowRenderer={({ index, key, style }) => (
              <DataRow key={key} index={index} style={style} />
            )}
          />
        </div>
      )}
    </WindowScroller>
  );
}

export function WindowAdapter({ engine, ...props }) {
  if (engine === "tanstack") return <TanStackWindow {...props} />;
  if (engine === "virtuoso") return <VirtuosoWindow {...props} />;
  if (engine === "virtua") return <VirtuaWindow {...props} />;
  if (engine === "scaled") return <ScaledWindow {...props} />;
  if (engine === "vit")
    return (
      <VitWindowScroll {...props} rowComponent={DataRow} overscan={OVERSCAN} />
    );
  return null;
}
