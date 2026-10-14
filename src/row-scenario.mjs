export const DYNAMIC_HEIGHTS = [32, 48, 72, 96];
export const DYNAMIC_ESTIMATE = 62;
export function rowSize(index, { expanded = false, narrow = false } = {}) {
  return DYNAMIC_HEIGHTS[index % 4] + (expanded && index % 10 === 0 ? 64 : 0) + (narrow ? 24 : 0);
}

// Used only by the observer to measure logical wheel distance, never by a library.
export function rowOffset(index, { expanded = false, narrow = false } = {}) {
  const cycles = Math.floor(index / 4);
  return cycles * 248 + DYNAMIC_HEIGHTS.slice(0, index % 4).reduce((a, b) => a + b, 0)
    + (expanded ? Math.ceil(index / 10) * 64 : 0) + (narrow ? index * 24 : 0);
}

// A start-aligned jump puts the row where the list rests row 0 at scroll top
// (origin: 0, or e.g. AG Grid's 1px leading border), except in the last
// viewport of the list, where the list rests at its end instead.
export const ALIGN_TOLERANCE_PX = 1;
export function expectedStartTop({ index, count, viewportHeight, rowHeight = 48, rowMode = "fixed", origin = 0 }) {
  const offset = (i) => rowMode === "dynamic" ? rowOffset(i) : i * rowHeight;
  const maxScroll = Math.max(0, origin + offset(count) - viewportHeight);
  return Math.max(origin, origin + offset(index) - maxScroll);
}

export function unsupportedReason(engine, rowMode) {
  if (rowMode !== "dynamic") return null;
  if (engine === "vit") return "This VitScroll prototype implements fixed-height coordinates only.";
  if (engine === "tanstack-scaled") return "This best-effort TanStack integration maps fixed-height coordinates only; the default TanStack adapter covers measured heights.";
  return null;
}

export const DYNAMIC_METHOD = "DOM-measured 32/48/72/96px rows (62px initial estimate; rc-virtual-list and AG Grid use the 32px minimum; AG Grid uses its Client-Side Row Model with autoHeight because its Infinite Row Model supports fixed heights only). Expand every tenth row by 64px after mount, collapse it, then add 24px to every row at viewport widths below 700px. Check geometry, actual heights and anchor visibility after each change, with a two-frame confirmation and 2s deadline. No remount or corrective seek during these checks; pixel anchor drift is an observation. Generated index data, not 100M materialized records.";
