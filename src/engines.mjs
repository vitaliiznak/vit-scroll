export const ENGINES = [
  {
    id: "window",
    name: "react-window",
    version: "2.3.4",
    repository: "https://github.com/bvaughn/react-window",
    package: "react-window",
    note: "Full-height sizing element",
    color: "#7f8fa5",
  },
  {
    id: "tanstack",
    name: "TanStack Virtual",
    version: "3.14.18",
    repository: "https://github.com/TanStack/virtual",
    package: "@tanstack/react-virtual",
    note: "Standard full-height spacer",
    color: "#c37751",
  },
  {
    id: "scaled",
    name: "react-virtualized",
    version: "9.22.6",
    repository: "https://github.com/bvaughn/react-virtualized",
    package: "react-virtualized",
    note: "Scaled coordinates",
    color: "#78927b",
  },
  {
    id: "ag",
    name: "AG Grid",
    version: "36.2.0",
    repository: "https://github.com/ag-grid/ag-grid",
    package: "ag-grid-community",
    note: "Stretching + cached blocks",
    color: "#9c83a4",
  },
  {
    id: "virtuoso",
    name: "React Virtuoso",
    version: "4.18.19",
    repository: "https://github.com/petyosi/react-virtuoso",
    package: "react-virtuoso",
    note: "Fixed-height mode · viewport buffer",
    color: "#397f88",
  },
  {
    id: "virtua",
    name: "virtua",
    version: "0.53.5",
    repository: "https://github.com/inokawa/virtua",
    package: "virtua",
    note: "Measured items · viewport buffer",
    color: "#a0606f",
  },
  {
    id: "rc",
    name: "rc-virtual-list",
    version: "3.19.2",
    repository: "https://github.com/react-component/virtual-list",
    package: "rc-virtual-list",
    note: "Built-in buffer · custom scrollbar",
    color: "#b48938",
  },
  {
    id: "vit",
    name: "VitScroll",
    version: "0.1.0",
    note: "Bounded coordinates · prototype",
    color: "#245bc3",
  },
];

// A benchmark result belongs to an adapter: one library plus the exact options
// and integration code in src/adapters.jsx, never to the library alone.
// default: the minimal documented setup. best-effort: the strongest documented
// setup for this workload. Where no option changes the checks, the default
// adapter is also the library's best effort, and `bestEffort` says why.
export const PROFILES = ["default", "best-effort"];
export const ADAPTERS = [
  {
    id: "window",
    engine: "window",
    profiles: ["default", "best-effort"],
    config: "List · fixed rowHeight · overscanCount 6 · scrollToRow align start",
    dynamicConfig: "useDynamicRowHeight · 62px default height",
    bestEffort:
      "No option bounds the List's full-height sizing element; it owns its scroll container.",
  },
  {
    id: "tanstack",
    engine: "tanstack",
    profiles: ["default"],
    config:
      "useVirtualizer · estimateSize = row height · overscan 6 · full-height spacer · scrollToIndex align start",
    dynamicConfig: "measureElement · 62px estimate",
  },
  {
    id: "tanstack-scaled",
    engine: "tanstack",
    profiles: ["best-effort"],
    note: "Scaled coordinates · app integration",
    config:
      "Default options plus observeElementOffset and scrollToFn reporting logical offsets. The app caps the spacer at 8M px and maps the scrollbar, wheel, keys and row jumps to logical pixels.",
    dynamicConfig: null,
    bestEffort:
      "Headless: the application owns the scroll element, so it can keep logical offsets over a bounded spacer. This integration assumes fixed heights.",
  },
  {
    id: "scaled",
    engine: "scaled",
    profiles: ["default", "best-effort"],
    config:
      "List · scrollToAlignment start · overscanRowCount 6 · built-in coordinate scaling",
    dynamicConfig: "CellMeasurer · cache cleared on resize",
    bestEffort: "Scales its coordinates by default.",
  },
  {
    id: "ag",
    engine: "ag",
    profiles: ["default", "best-effort"],
    config:
      "Infinite Row Model · 100-row blocks, 4 cached · rowBuffer 6 · ensureIndexVisible top",
    dynamicConfig: "Client-Side Row Model · autoHeight · 32px minimum",
    bestEffort: "Stretches its coordinates past the height limit by default.",
  },
  {
    id: "virtuoso",
    engine: "virtuoso",
    profiles: ["default", "best-effort"],
    config:
      "fixedItemHeight · increaseViewportBy 6 rows · scrollToIndex align start",
    dynamicConfig: "Measured items · 62px default height",
    bestEffort: "No option bounds its full-height list.",
  },
  {
    id: "virtua",
    engine: "virtua",
    profiles: ["default", "best-effort"],
    config:
      "VList · itemSize hint = row height · bufferSize 6 rows · length-only data · scrollToIndex align start",
    dynamicConfig: "Measured items · 62px itemSize hint",
    bestEffort:
      "Reads the native scroll offset and sizes one container to the full list; no option bounds it.",
  },
  {
    id: "rc",
    engine: "rc",
    profiles: ["default", "best-effort"],
    config:
      "itemHeight · numeric data array · scrollTo index align top · end check through the native holder",
    dynamicConfig: "Measured children · 32px itemHeight",
    bestEffort:
      "Keeps a logical offset, but its filler and custom scrollbar span the full height; no option bounds them.",
  },
  {
    id: "vit",
    engine: "vit",
    profiles: ["default", "best-effort"],
    config: "Bounded 8M px spacer · logical wheel and keys · overscan 6",
    dynamicConfig: null,
    bestEffort: "Bounded coordinates by default.",
  },
];

export const adapterById = (id) => ADAPTERS.find((a) => a.id === id);
// Results recorded before adapters existed carry library IDs, which are the
// IDs of the default adapters.
export const engineOf = (id) => adapterById(id)?.engine ?? id;

export function profileLabel(id) {
  const profiles = adapterById(id)?.profiles ?? ["default"];
  if (profiles.length > 1) return "Default = best effort";
  return profiles[0] === "default" ? "Default" : "Best effort";
}

export function adapterLabel(id) {
  const engine = ENGINES.find((e) => e.id === engineOf(id));
  return {
    name: engine?.name ?? id,
    profile: profileLabel(id),
    note: adapterById(id)?.note ?? engine?.note ?? "",
  };
}

// Library IDs expand to that library's adapters in the chosen profiles;
// adapter-only IDs (such as tanstack-scaled) select exactly that adapter.
export function selectAdapters(ids, profiles = PROFILES) {
  const isLibrary = (id) => ENGINES.some((e) => e.id === id);
  return ADAPTERS.filter(
    (a) =>
      (ids.includes(a.engine) &&
        a.profiles.some((p) => profiles.includes(p))) ||
      (ids.includes(a.id) && !isLibrary(a.id)),
  ).map((a) => a.id);
}
