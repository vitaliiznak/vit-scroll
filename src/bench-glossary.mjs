// Short definitions for every published measurement. Shared by the results
// page tooltips (browser) and scripts/bench-report.mjs (Node), so keep it free
// of React and DOM imports. `what` names the measurement; `how` says how it is
// taken or read.
export const MEASURES = {
  verdict: {
    label: "Result",
    what: "Overall verdict across all passes.",
    how: "Pass: every check passed in every pass. Fail: a check failed in every pass. Flaky: passes disagree. Stopped: a pass hit an error, crash, time limit or memory budget. Unsupported: not run.",
  },
  finished: {
    label: "Passes finished",
    what: "Passes that ran the whole workload.",
    how: "Each pass uses a fresh browser process.",
  },
  jumps: {
    label: "Row jumps",
    what: "Can scroll-to-row reach the first, 25%, 50%, 90% and last rows?",
    how: "A jump passes when the row is visible, with no gaps or overlap, for two frames within 1 s. Jump times are whole frames (two at least), so they are not a speed ranking.",
  },
  aligned: {
    label: "Jump alignment",
    what: "Does each reached jump land where it was asked to: the row at the viewport top, or the list at its end for rows on the last screen?",
    how: "Measured in the DOM. Within 1 px for two frames, with 300 ms to settle after the row appears. The worst miss is shown in px.",
    unit: "px",
  },
  profile: {
    label: "Configuration",
    what: "Which setup of a library was measured. Default: its minimal documented setup. Best effort: its strongest documented setup for this workload, including any integration code.",
    how: "A result describes one adapter, not the library in general. “Default = best effort” means no documented option changes these checks.",
  },
  native: {
    label: "Native end",
    what: "Does dragging the scrollbar to the bottom show the last row?",
    how: "Fails when the browser's maximum element height cuts the list short.",
  },
  mount: {
    label: "Mount → visible",
    what: "Time from mount until row 1 is visible.",
    how: "Median of finished passes. DOM readiness, not first paint. Waits are whole animation frames, so differences under one frame (about 8–17 ms) are noise.",
    unit: "ms",
    better: "lower",
  },
  commit: {
    label: "Synchronous commit",
    what: "Time inside React's synchronous mount.",
    how: "Median of finished passes.",
    unit: "ms",
    better: "lower",
  },
  invalidFrames: {
    label: "Broken frames",
    what: "Frames with blank space, gaps or overlapping rows while the list steps three rows per frame from row 1 to row 178 and back.",
    how: "Any broken frame fails the pass. Frame intervals are not scored: at this workload they only show the display refresh rate.",
    better: "lower",
  },
  peakMounted: {
    label: "DOM rows",
    what: "Most rows mounted at once while scrolling.",
    how: "Reflects each library's overscan.",
    better: "lower",
  },
  wheel: {
    label: "48px wheel",
    what: "How far one 48 px wheel step moves the content.",
    how: "48 is one-to-one; scaled coordinates move further.",
    unit: "px",
  },
  pageDown: {
    label: "Page Down",
    what: "Does Page Down scroll the list from row 101?",
    how: "\"Not focusable\" means the scroller cannot take focus.",
  },
  resize: {
    label: "Resize",
    what: "Is row 101 still visible after narrowing the browser to 640 px?",
    how: "Also checks for gaps and overlap.",
  },
  longTasks: {
    label: "Long tasks",
    what: "Main-thread tasks over 50 ms.",
    how: "Long Tasks API; n/a in Firefox and WebKit.",
    better: "lower",
  },
  rss: {
    label: "Peak RSS",
    what: "Most memory the browser process tree used.",
    how: "Sampled every 200 ms. Includes the browser and runner (about 500 MiB at rest in Chromium), so small differences are noise; it mainly enforces the 2048 MiB budget.",
    unit: "MiB",
    better: "lower",
  },
  heapMounted: {
    label: "Heap after mount",
    what: "JS heap held by the mounted list.",
    how: "After forced GC, minus the pre-mount baseline. Chromium only.",
    unit: "MiB",
    better: "lower",
  },
  heapRetained: {
    label: "Heap retained",
    what: "JS heap still held after scrolling and jumping.",
    how: "After forced GC, minus the pre-mount baseline.",
    unit: "MiB",
    better: "lower",
  },
  heapUnmount: {
    label: "After unmount",
    what: "JS heap left after the list is removed.",
    how: "Near zero means memory was released.",
    unit: "MiB",
    better: "lower",
  },
  heapMax: {
    label: "Observed heap max",
    what: "Largest JS heap sample at any stage.",
    how: "Stage samples, not a continuous peak.",
    unit: "MiB",
    better: "lower",
  },
  backing: {
    label: "Backing storage max",
    what: "Array buffers and external strings, outside the JS heap.",
    how: "Largest stage sample.",
    unit: "MiB",
    better: "lower",
  },
  dynamic: {
    label: "Height changes",
    what: "Does the list stay correct when row heights change?",
    how: "Expand, collapse and resize; each must settle within 2 s and keep the top row. Only in --row-mode dynamic runs.",
  },
  outcome: {
    label: "Outcome",
    what: "Checks passed, the first failed check, or why a pass stopped.",
    how: "Expand the row for each pass.",
  },
  status: {
    label: "Status",
    what: "How the pass ended and the last stage it reached.",
    how: "completed, error, timeout, renderer-crash or resource-budget.",
  },
  elapsed: {
    label: "Elapsed",
    what: "Wall-clock time of the pass, including browser start-up.",
    how: "Not a speed score.",
    unit: "s",
  },
  pass: {
    label: "Pass",
    what: "Which repetition this is.",
    how: "Library order rotates every round.",
  },
};

export const measure = (id) => MEASURES[id] ?? { label: id, what: "", how: "" };

// One string for title attributes and screen-reader descriptions.
export function describe(id) {
  const m = measure(id);
  return [m.what, m.how].filter(Boolean).join(" ");
}
