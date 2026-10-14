import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createGeometry } from "./core.mjs";

/** The document prefix and viewport can both resize independently of the list. */
export function useWindowLayout(host, topInset = 0) {
  const [layout, setLayout] = useState({
    top: 0,
    origin: 0,
    width: 1,
    height: Math.max(1, innerHeight - topInset),
    ready: false,
  });
  useLayoutEffect(() => {
    const measure = () => {
      if (!host.current) return;
      const rect = host.current.getBoundingClientRect();
      const next = {
        top: rect.top + scrollY,
        origin: rect.top + scrollY - topInset,
        width: rect.width,
        height: Math.max(1, innerHeight - topInset),
        ready: true,
      };
      setLayout((old) =>
        Object.keys(next).every((key) => Math.abs(next[key] - old[key]) < 0.1)
          ? old
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host.current);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [host, topInset]);
  return layout;
}

/** A fixed-height list whose only scrolling element is the document. */
export function VitWindowScroll({
  count,
  rowHeight,
  apiRef,
  physicalCap = 8_000_000,
  overscan = 6,
  topInset = 0,
  rowComponent: Row,
}) {
  const host = useRef(null);
  const layout = useWindowLayout(host, topInset);
  const logical = useRef(0);
  const expected = useRef(null);
  const previousLayout = useRef(null);
  const [position, setPosition] = useState({ logical: 0, physical: 0 });
  const g = useMemo(
    () =>
      createGeometry({
        count,
        rowHeight,
        viewportHeight: layout.height,
        maxPhysicalHeight: physicalCap,
      }),
    [count, rowHeight, layout.height, physicalCap],
  );
  const move = useCallback(
    (top) => {
      logical.current = g.clamp(top);
      window.scrollTo({
        top: layout.origin + g.toPhysical(logical.current),
        behavior: "instant",
      });
      expected.current = scrollY;
      setPosition({
        logical: logical.current,
        physical: Math.max(0, scrollY - layout.origin),
      });
    },
    [g, layout.origin],
  );

  useLayoutEffect(() => {
    const old = previousLayout.current;
    if (old?.ready && scrollY >= old.origin - 1 && layout.ready)
      move(logical.current);
    previousLayout.current = layout;
  }, [layout, move]);

  useLayoutEffect(() => {
    apiRef.current = {
      element: document.scrollingElement,
      rowsRoot: host.current,
      scrollMode: "window",
      viewportRect: () => ({ top: topInset, bottom: innerHeight }),
      jump: (index) => move(index * rowHeight),
      offset: move,
      bottom: () =>
        window.scrollTo({
          top: document.scrollingElement.scrollHeight,
          behavior: "instant",
        }),
      get logicalTop() {
        return logical.current;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, move, rowHeight, topInset]);

  useEffect(() => {
    const onScroll = () => {
      if (
        expected.current !== null &&
        Math.abs(scrollY - expected.current) < 0.5
      )
        return;
      expected.current = null;
      const physical = Math.max(0, scrollY - layout.origin);
      // Document scrollHeight is rounded while the prefix may be fractional.
      // A subpixel gap amplified by compression can otherwise hide many rows.
      const atDocumentEnd =
        scrollY >= document.scrollingElement.scrollHeight - innerHeight - 1;
      logical.current = atDocumentEnd ? g.logicalRange : g.toLogical(physical);
      setPosition({ logical: logical.current, physical });
    };
    const wheel = (event) => {
      if (
        scrollY < layout.origin - 1 ||
        event.ctrlKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? rowHeight
          : event.deltaMode === 2
            ? layout.height
            : 1);
      const next = g.clamp(logical.current + delta);
      if (next === logical.current) return;
      event.preventDefault();
      move(next);
    };
    const key = (event) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        scrollY < layout.origin - 1 ||
        ![document.body, host.current].includes(event.target)
      )
        return;
      const targets = {
        ArrowDown: logical.current + rowHeight,
        ArrowUp: logical.current - rowHeight,
        PageDown: logical.current + layout.height,
        PageUp: logical.current - layout.height,
        " ":
          logical.current + (event.shiftKey ? -layout.height : layout.height),
      };
      if (
        !Object.hasOwn(targets, event.key) ||
        g.clamp(targets[event.key]) === logical.current
      )
        return;
      event.preventDefault();
      move(targets[event.key]);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [g, layout, move, rowHeight]);

  const range = g.range(position.logical, overscan);
  return (
    <div
      ref={host}
      className="window-list"
      role="list"
      aria-label="VitScroll page rows"
      tabIndex={0}
      style={{
        height: g.physical,
        position: "relative",
        overflow: "clip",
        overflowAnchor: "none",
      }}
    >
      {Array.from({ length: range.end - range.first }, (_, offset) => {
        const index = range.first + offset;
        return (
          <Row
            key={index}
            index={index}
            ariaAttributes={{
              role: "listitem",
              "aria-posinset": index + 1,
              "aria-setsize": count,
            }}
            style={{
              position: "absolute",
              top: 0,
              width: "100%",
              height: rowHeight,
              transform: `translateY(${g.rowTop(index, position.logical, position.physical)}px)`,
            }}
          />
        );
      })}
    </div>
  );
}
