# ScrollBench

Benchmarks React virtual-scrolling libraries in real browsers, with the actual installed packages: **react-window 2.3.4**, **TanStack Virtual 3.14.18**, **react-virtualized 9.22.6**, **AG Grid Community 36.2.0**, **React Virtuoso 4.18.19**, **virtua 0.53.5**, **rc-virtual-list 3.19.2**, and **VitScroll**, this repository's fixed-height prototype.

**What it answers:** can each library reach and land on every row of a very long list? Browsers cap element height (about 33.5M px in Chromium), so a library that sizes one element to the full list height cannot show the end of 1M × 48px rows. At 100K rows every library passes; the differences appear at 1M and 100M. It is a correctness benchmark first. Its timings are coarse and only meaningful for large gaps.

## Run

```sh
npm ci
npm run bench:install                    # Playwright Chromium, Firefox, WebKit (once)
npm run bench                            # Chromium, all libraries, 100K + 1M rows, 3 passes
npm run bench -- --browser chromium,firefox,webkit --rows 100000,1000000,100000000
npm run bench -- --library vit --rows 100000 --repeats 1 --no-publish --open   # smoke run
```

`npm run bench` builds a private production copy, serves it on a free local port, runs every case in a fresh browser process, writes JSON and `report.html` to `output/bench/<timestamp>/`, publishes the run to the results page and shuts everything down. `npm run bench -- --help` lists the options:

| Option | Values | Default |
| --- | --- | --- |
| `--browser` | `chromium`, `firefox`, `webkit`, comma-separated | `chromium` |
| `--suite` | `all`, `performance` (checks and timing), `memory` (Chromium heap) | `all` = performance in every browser + memory in Chromium |
| `--library` | `all` or `window,tanstack,scaled,ag,virtuoso,virtua,rc,vit`, or adapter IDs such as `tanstack-scaled` | `all` |
| `--profile` | `all`, `default`, `best-effort` | `all` |
| `--rows` | comma-separated, 1,000–100,000,000 | `100000,1000000` |
| `--row-mode` | `fixed` (48px), `dynamic` (measured heights) | `fixed` |
| `--repeats` | 1–20, library order rotates each round | `3` |

Each case has a 25-second deadline and a 2048 MiB budget for the sampled browser process tree (memory runs also cap V8 old space at 1024 MiB). A stop is reported as *incomplete under this budget*, not as a library limit. The supervisor reads memory with `ps`, so it runs on macOS and Linux.

## What a pass does

In a 900 × 360px list with the same generated row content for every library:

1. **Mount** until row 1 is visible.
2. **Scroll check:** 120 frames stepping three rows per frame from row 1 to row 178 and back. Every frame must cover the viewport with no blank space, gaps or overlapping rows.
3. **Input:** one 48px mouse-wheel step, Page Down where the list can take focus, and a resize to 640px wide (row 101 must stay visible).
4. **Row jumps** to the first, 25%, 50%, 90% and last rows through the library's scroll-to-row API. A jump is *reached* when the row is visible with no gaps or overlap for two frames within 1s, and *aligned* when it sits within 1px of the requested position (or the list rests at its end for rows on the last screen) for two frames, with 300ms to settle.
5. **Native end:** set the scroll container to its maximum `scrollTop` and check that the last row is visible.

All checks read the DOM geometry rather than the library's own state. **Verdicts** per library × browser × row count: **Pass** (every check in every pass), **Fail** (every pass failed a check), **Flaky** (all passes finished but disagree), **Stopped** (a pass hit an error, crash, timeout or memory budget), **Unsupported** (not run). When a library throws while rendering, the outcome names the page error first, for example *React #185: maximum update depth exceeded*.

**How to read the numbers.** Mount time and jump time are counted in whole animation frames, so differences under one frame (8–17ms) are noise. Frame intervals are not reported: with a few rows of work per frame they only show the display refresh rate. Peak RSS includes the browser and runner (about 500 MiB at rest in Chromium) and mainly enforces the budget. For heap, use `--suite memory`: Chromium CDP with forced GC at baseline, after mount, after the workload and after unmount. Compare timings only within one browser on one machine. Playwright WebKit is not Safari.

## Library setups

A result describes one **adapter**: a library plus the exact options and integration code in `src/adapters.jsx`. Every library runs in two profiles: **default** (the minimal documented setup) and **best effort** (the strongest documented setup for this workload, including integration code an app would write). Where no option changes the outcome, one adapter serves both. Reasons live in `src/engines.mjs` and appear in every report.

| Library | Best-effort setup |
| --- | --- |
| TanStack Virtual | Separate adapter `tanstack-scaled`: spacer capped at 8M px, logical offsets through the documented `observeElementOffset` and `scrollToFn` options. Fixed heights only. |
| react-window, React Virtuoso, virtua | Same as default: no option bounds their full-height scroll element. |
| rc-virtual-list | Same as default: it keeps a logical offset, but its filler and custom scrollbar span the full height. |
| react-virtualized, AG Grid, VitScroll | Same as default: they already scale or stretch coordinates past the browser limit. |

Overscan is six rows where the API allows it; buffering is not identical across libraries. rc-virtual-list needs an array, so its adapter allocates numeric IDs (counted in its mount time). AG Grid uses the Infinite Row Model with 100-row blocks, four cached.

### Dynamic row heights (`--row-mode dynamic`)

Rows are 32, 48, 72 and 96px, measured from the DOM. Libraries get a 62px estimate (rc-virtual-list and AG Grid use 32px as their minimum height); no library gets an exact height per index. After mount, every tenth row grows by 64px and shrinks back, then the window narrows to 640px (+24px per row) and is restored to 1100px. Each change must settle within 2s with valid heights, no gaps or overlap, and the previous top row still visible. Anchor drift in pixels is recorded but does not fail the check.

| Adapter | Integration |
| --- | --- |
| react-window | `useDynamicRowHeight` |
| TanStack Virtual | `measureElement` |
| react-virtualized | `CellMeasurer`, cache cleared on resize and expansion |
| React Virtuoso, virtua, rc-virtual-list | Built-in measurement |
| AG Grid | Client-Side Row Model with `autoHeight` (the Infinite Row Model supports fixed heights only); one row object per row, counted in its mount time |
| VitScroll, TanStack best effort | **Unsupported**: fixed-height coordinate math |

## Results page and publishing

Every `npm run bench` publishes slim JSON to `public/bench/runs/` and lists it in `public/bench/index.json` (the newest 20 runs). The home page **`/`** shows a pass/fail matrix, a results table with expandable passes, the exact configurations, and a **?** definition for every column (`src/bench-glossary.mjs`). `npm run dev` shows new runs immediately; the production preview needs `npm run build` again. Use `--no-publish` for smoke runs, and `npm run bench:publish -- output/bench/<timestamp>` to publish an earlier run.

Each run records whether it ran locally or in CI, plus CPU, cores, RAM, OS, Node and browser versions. Only allowlisted metadata is saved: no usernames, hostnames or paths.

## CI

`.github/workflows/benchmark.yml` runs on pull requests and pushes to `main`/`master`: two Ubuntu jobs (fixed and dynamic heights), Chromium, all libraries, 100K rows, one pass, after the unit tests. **Run workflow** defaults to 100K, 1M and 100M rows, all suites and three passes. Each job writes a results table to the job summary and uploads `report.html` plus raw JSON. A green job means the benchmark ran, **not** that every library passed. When that workflow finishes on `master` or `main` (a push or a manual run), it commits `public/bench/` and deploys GitHub Pages. Pull requests keep their reports as workflow artifacts. `npm run dev` shows the committed runs after a pull.

## Demo

`npm run demo` builds and opens **`/demo.html`**: a library table (documented capabilities, plus whether the last row is reachable at the chosen size) that picks the library in a live preview, and **Benchmark lite**, a quick in-tab run (first/middle/last jumps, native end, ready time, DOM rows). Lite shares one tab and one heap with the page and is not published; use `npm run bench` for real results.

**Open this table separately ↗** opens one library on its own page, for example `/demo.html?table=vit&scroll=window&count=1000000&rowHeight=48`. With **Scroll with → Browser page**, VitScroll, TanStack Virtual, React Virtuoso, virtua and react-virtualized scroll the document itself; react-window, rc-virtual-list and AG Grid stay in a container. Page scrolling does not remove a library's height limit.

## Tests

```sh
npm test                                  # unit tests
npm run build && npm run preview          # then, in another terminal:
npm run test:browser                      # headless Google Chrome
```

The browser suite needs Chrome installed (or `npx playwright install chromium` and `PLAYWRIGHT_CHANNEL=chromium`). Set `SCROLL_TEST_URL` if the preview uses another port. Output goes to the ignored `output/playwright/`.

## VitScroll prototype

`packages/vit-scroll/` holds the source, browsable at `/source.html`. `core.mjs` is framework-free coordinate math, O(1) in row count; `react.jsx` renders only the visible rows plus overscan; `window.jsx` scrolls the document. These are source modules, not a published package.

```jsx
import { VitScroll } from "./packages/vit-scroll/react.jsx";

const Row = ({ index, style, ariaAttributes }) => (
  <div style={style} {...ariaAttributes}>Row {index + 1}</div>
);

<VitScroll count={1_000_000} rowHeight={48} height={360} rowComponent={Row} apiRef={api} />;
// api.current.jump(index), .offset(logicalPx), .bottom(), .element, .logicalTop
```

The physical spacer is capped at 8M px and scrollbar progress maps onto logical position. Wheel and keyboard input move exact logical pixels; dragging the scrollbar and touch use compressed coordinates, so they are coarse on very large lists. Mapping coordinates this way is established prior art, not new.

## Related

[TanStack Virtual's benchmarks](https://github.com/TanStack/virtual/tree/main/benchmarks) time TanStack, virtua, Virtuoso and react-window up to 100K × 30px rows, below the height limit, with one setup per library, maintained by one of the compared projects. Use them for small-list timings. Where both suites measure the same thing, the results should agree in shape. Future functional scenarios (filter, sort, append, keyboard) are designed in [docs/benchmark-scenarios.md](docs/benchmark-scenarios.md) and are not implemented.
