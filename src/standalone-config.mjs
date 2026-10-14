import { ENGINES } from "./engines.mjs";

export const WINDOW_SUPPORT = {
  vit: "Bounded document spacer with logical wheel and keyboard movement.",
  tanstack: "useWindowVirtualizer with the list's document offset.",
  virtuoso: "Virtuoso useWindowScroll.",
  virtua: "WindowVirtualizer with the page as scroller.",
  scaled: "WindowScroller with an autoHeight List.",
};
export const WINDOW_LIMITS = {
  window:
    "This react-window List adapter owns its scroll container; it has no built-in window-scrolling mode.",
  rc: "rc-virtual-list owns its holder and scrollbar; this adapter cannot virtualize the browser window.",
  ag: "AG Grid autoHeight renders every row and is unsuitable for this large-data virtualized comparison. This Infinite Row Model adapter uses a container.",
};

export function tableUrl(engine, count, rowHeight, scrollMode) {
  return `?${new URLSearchParams({
    table: engine,
    scroll: scrollMode ?? (WINDOW_SUPPORT[engine] ? "window" : "container"),
    count: String(count),
    rowHeight: String(rowHeight),
  })}`;
}

export function readTableConfig(search) {
  const params = new URLSearchParams(search);
  const engine = params.get("table");
  if (!ENGINES.some((item) => item.id === engine))
    return {
      error: "Unknown library. Return to the demo and choose a table.",
    };
  const mode =
    params.get("scroll") ?? (WINDOW_SUPPORT[engine] ? "window" : "container");
  if (!["window", "container"].includes(mode))
    return { error: "Scroll mode must be window or container." };
  const count = Number(params.get("count") ?? 100_000);
  const rowHeight = Number(params.get("rowHeight") ?? 48);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000_000)
    return {
      error: "Use 1–100,000,000 rows for any library.",
    };
  if (!Number.isSafeInteger(rowHeight) || rowHeight < 24 || rowHeight > 120)
    return {
      error: "Row height must be an integer between 24 and 120 pixels.",
    };
  return { engine, mode, count, rowHeight };
}

// Browsers cap an element's height (about 33.5M px in Chromium). Measured on
// 13 Oct 2026 at 1M–100M rows: these libraries size one element to the whole
// list, so rows past the cap can't be scrolled or jumped to, in page or
// container mode. The others compress coordinates and reach the last row.
export const FULL_HEIGHT = {
  window: "sizes one element to the full list height",
  tanstack: "sizes one spacer to the full list height",
  virtuoso: "sizes its list to the full height",
  virtua: "sizes its container to the full list height",
  rc: "sizes its holder to the full list height",
};
export const COMPRESSED = {
  scaled: "scales its coordinates to stay under the limit",
  ag: "stretches its coordinates to stay under the limit",
  vit: "maps rows onto a bounded spacer under the limit",
};

// limit: the browser's measured maximum element height in px. inset: page
// content above the list in page-scroll mode, which also counts toward it.
export function reachability(engine, count, rowHeight, limit, inset = 0) {
  const total = count * rowHeight;
  if (!FULL_HEIGHT[engine] || total + inset <= limit)
    return { fails: false, total, limit };
  const lastRow = Math.max(0, Math.floor((limit - inset) / rowHeight));
  return { fails: true, total, limit, lastRow, hidden: count - lastRow };
}
