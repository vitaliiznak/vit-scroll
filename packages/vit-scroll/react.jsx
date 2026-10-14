import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createGeometry } from "./core.mjs";

/** Fixed-height virtual list. Row receives index, style, and ariaAttributes. */
export function VitScroll({
  count,
  rowHeight,
  apiRef,
  physicalCap = 8_000_000,
  height = 360,
  overscan = 6,
  rowComponent: Row,
  className,
  ariaLabel = "Virtual rows",
}) {
  const element = useRef(null);
  const logical = useRef(0);
  const expectedPhysical = useRef(null);
  const [position, setPosition] = useState({ logical: 0, physical: 0 });
  const g = useMemo(
    () =>
      createGeometry({
        count,
        rowHeight,
        viewportHeight: height,
        maxPhysicalHeight: physicalCap,
      }),
    [count, rowHeight, physicalCap, height],
  );
  const move = useCallback(
    (top) => {
      const el = element.current;
      if (!el) return;
      logical.current = g.clamp(top);
      el.scrollTop = g.toPhysical(logical.current);
      // Keep exact logical pixels even when the browser rounds physical scrollTop.
      expectedPhysical.current = el.scrollTop;
      setPosition({ logical: logical.current, physical: el.scrollTop });
    },
    [g],
  );
  useLayoutEffect(() => {
    move(0);
    apiRef.current = {
      element: element.current,
      jump: (index) => move(index * rowHeight),
      offset: move,
      bottom: () => {
        element.current.scrollTop = element.current.scrollHeight;
      },
      get logicalTop() {
        return logical.current;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, move, rowHeight, g]);
  useEffect(() => {
    const el = element.current;
    const wheel = (event) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        return;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? rowHeight
          : event.deltaMode === 2
            ? height
            : 1);
      const next = g.clamp(logical.current + delta);
      if (next === logical.current) return;
      event.preventDefault();
      move(next);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [g, move, rowHeight, height]);
  const onScroll = () => {
    const physical = element.current.scrollTop;
    if (
      expectedPhysical.current !== null &&
      Math.abs(physical - expectedPhysical.current) < 0.5
    )
      return;
    expectedPhysical.current = null;
    logical.current = g.toLogical(physical);
    setPosition({ logical: logical.current, physical });
  };
  const onKeyDown = (event) => {
    if (event.target !== event.currentTarget) return;
    const targets = {
      Home: 0,
      End: g.logicalRange,
      ArrowDown: logical.current + rowHeight,
      ArrowUp: logical.current - rowHeight,
      PageDown: logical.current + height,
      PageUp: logical.current - height,
      " ": logical.current + (event.shiftKey ? -height : height),
    };
    if (Object.hasOwn(targets, event.key)) {
      event.preventDefault();
      move(targets[event.key]);
    }
  };
  const range = g.range(position.logical, overscan);
  return (
    <div
      className={className}
      ref={element}
      role="list"
      aria-label={ariaLabel}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      style={{
        height,
        overflow: "auto",
        position: "relative",
        overflowAnchor: "none",
      }}
    >
      <div
        style={{
          height: g.physical,
          width: "100%",
          position: "relative",
          overflow: "clip",
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
    </div>
  );
}
