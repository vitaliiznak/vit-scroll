import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { describe, measure } from "./bench-glossary.mjs";

// A small "?" button that explains one measurement. The popover is portalled
// to <body> with fixed positioning so table scrollers cannot clip it. Mouse
// hover and keyboard focus show it; a tap toggles it; Escape closes it.
// Screen readers get the same text through aria-describedby.
export function Tip({ id, children }) {
  const m = measure(id);
  const descId = useId();
  const button = useRef(null);
  const pop = useRef(null);
  const pointer = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      const p = pop.current?.getBoundingClientRect();
      if (!r || !p) return;
      const gap = 8;
      const below = r.bottom + gap + p.height <= innerHeight;
      setPos({
        top: below ? r.bottom + gap : Math.max(gap, r.top - gap - p.height),
        left: Math.min(
          Math.max(gap, r.left + r.width / 2 - p.width / 2),
          innerWidth - p.width - gap,
        ),
      });
    };
    place();
    addEventListener("scroll", place, true);
    addEventListener("resize", place);
    return () => {
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!button.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={button}
        className="tip-btn"
        aria-label={`What is ${m.label}?`}
        aria-describedby={descId}
        aria-expanded={open}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
        onFocus={(e) =>
          e.currentTarget.matches(":focus-visible") && setOpen(true)
        }
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Clicks inside sortable/expandable headers must not bubble.
          e.stopPropagation();
          if (pointer.current !== "mouse") setOpen((o) => !o);
          pointer.current = null;
        }}
      >
        ?
      </button>
      <span id={descId} className="sr-only">
        {describe(id)}
      </span>
      {open &&
        createPortal(
          <div
            ref={pop}
            className="tip-pop"
            aria-hidden="true"
            style={
              pos
                ? { top: pos.top, left: pos.left }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
            <strong>
              {m.label}
              {m.unit && <small> · {m.unit}</small>}
              {m.better && <small> · {m.better} is better</small>}
            </strong>
            <p>{m.what}</p>
            <p>{m.how}</p>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

// A label followed by its explanation button, kept on one line.
export function Term({ id, children }) {
  return (
    <span className="term">
      {children ?? measure(id).label}
      <Tip id={id} />
    </span>
  );
}
