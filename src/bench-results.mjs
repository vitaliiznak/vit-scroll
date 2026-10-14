import { adapterById, engineOf } from "./engines.mjs";
import { caseOutcome, explainError, firstLine } from "./measurements.mjs";

// Shared by scripts/bench-publish.mjs (Node) and the results page (browser).
// Keep it free of React and DOM imports.
export const BENCH_SCHEMA = "vit-scroll-bench/1";
export const BENCH_DIR = "bench";

export const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * p) - 1)
  ] ?? null;
export const median = (values) => {
  const measured = values.filter(Number.isFinite);
  return measured.length ? percentile(measured, 0.5) : null;
};
const round = (value, places = 2) =>
  Number.isFinite(value) ? Number(value.toFixed(places)) : null;

// Raw audit cases carry RSS histories, every geometry sample and environment
// copies. The page needs the measurements, not those diagnostics.
export function slimCase(c) {
  const used = (sample) => sample?.usedSize ?? null;
  // Older raw runs called the local scroll check `pacing`.
  const scroll = c.scroll ?? c.pacing;
  const heapPeak = (c.heapSamples ?? [])
    .filter((s) => s.stage !== "baseline" && s.stage !== "after-unmount-gc")
    .map((s) => s.usedSize)
    .filter(Number.isFinite);
  return {
    // Adapter ID: a library in one configuration profile.
    engine: c.engine,
    library: c.library ?? engineOf(c.engine),
    suite: c.suite ?? null,
    rowMode: c.rowMode ?? "fixed",
    reason: c.reason ?? null,
    dynamicChecks: (c.dynamicChecks ?? []).map(({ name, passed, settledMs, heightChecks, anchorVisible, anchorDriftPx }) => ({ name, passed, settledMs: round(settledMs), heightChecks, anchorVisible, anchorDriftPx: round(anchorDriftPx) })),
    browser: c.browser,
    browserVersion: c.browserVersion ?? null,
    count: c.count,
    round: c.round,
    status: c.status,
    lastStage: c.lastStage ?? null,
    elapsedMs: round(c.elapsedMs, 0),
    outcome: caseOutcome(c),
    error: firstLine(c.error),
    pageErrors: [...new Set((c.errors ?? []).map(explainError))].slice(0, 3),
    mount: c.mount
      ? {
          visibleMs: round(c.mount.visibleMs),
          commitMs: round(c.mount.synchronousCommitMs),
          // Where the adapter rests row 0; jump alignment is measured from it.
          originPx: round(c.mount.originPx, 1),
        }
      : null,
    scroll: scroll
      ? {
          invalidFrames: scroll.invalidFrames?.length ?? 0,
          peakMounted: scroll.peakMounted ?? null,
        }
      : null,
    seeks: (c.seeks ?? []).map((s) => ({
      index: s.index ?? s.target,
      reached: !!s.reached,
      visibleMs: round(s.visibleMs),
      // null: recorded before alignment was measured, or not reached.
      aligned: s.aligned ?? null,
      alignErrorPx: round(s.alignErrorPx, 1),
      first: s.observation?.first ?? null,
      last: s.observation?.last ?? null,
    })),
    jumpPassed: c.jumpPassed ?? null,
    alignPassed: c.alignPassed ?? null,
    nativePassed: c.nativePassed ?? null,
    nativeEnd: c.nativeEnd
      ? {
          lastRowVisible: !!c.nativeEnd.lastRowVisible,
          first: c.nativeEnd.first ?? null,
          last: c.nativeEnd.last ?? null,
        }
      : null,
    wheel: c.wheel ? { logicalPixels: round(c.wheel.logicalPixels) } : null,
    keyboard: c.keyboard
      ? {
          focused: !!c.keyboard.focused,
          pageDownFirst: c.keyboard.afterPageDown?.first ?? null,
        }
      : null,
    resize: c.resize
      ? {
          keepsRow101:
            !!c.resize.visible?.includes(100) &&
            !c.resize.overlap &&
            !c.resize.gaps,
        }
      : null,
    longTasks: Array.isArray(c.longTasks)
      ? {
          count: c.longTasks.length,
          totalMs: round(
            c.longTasks.reduce((sum, t) => sum + t.duration, 0),
            1,
          ),
        }
      : null,
    heap: {
      before: used(c.heapBefore),
      mountedGC: used(c.heapMountedGC),
      afterWork: used(c.heapAfterWork),
      afterUnmountGC: used(c.heapAfterUnmountGC),
      sampledPeak: heapPeak.length ? Math.max(...heapPeak) : null,
    },
    peakProcessRssMiB: round(c.peakProcessRssMiB, 0),
    stop: c.stop ?? null,
  };
}

// One published run = one `npm run bench` invocation (one suite, 1+ browsers).
export function buildPublishedRun({ id, meta = {}, reports }) {
  const first = reports[0] ?? {};
  const browsers = [...new Set(reports.map((r) => r.browser))].map((name) => {
    const matching = reports.filter((r) => r.browser === name);
    const r = { ...matching[0], cases: matching.flatMap((r) => r.cases) };
    const env = r.cases.find((c) => c.environment)?.environment;
    return {
      name: r.browser,
      version: r.cases.find((c) => c.browserVersion)?.browserVersion ?? null,
      complete: matching.every((r) => !!r.completedAt),
      cases: r.cases.length,
      userAgent: env?.userAgent ?? null,
      hardwareConcurrency: env?.hardwareConcurrency ?? null,
    };
  });
  const expected = meta.options
    ? (meta.plan?.length ?? meta.options.browsers.length) *
      meta.options.engines.length *
      meta.options.counts.length *
      meta.options.repetitions
    : null;
  const cases = reports.flatMap((r) =>
    r.cases.map((c) =>
      slimCase({
        ...c,
        suite: c.suite ?? r.config?.suite,
        browser: c.browser ?? r.browser,
      }),
    ),
  );
  return {
    schema: BENCH_SCHEMA,
    id,
    suite: meta.options?.suite ?? first.config?.suite ?? "performance",
    startedAt: meta.startedAt ?? first.startedAt ?? null,
    completedAt: reports.every((r) => r.completedAt)
      ? reports
          .map((r) => r.completedAt)
          .sort()
          .at(-1)
      : null,
    complete:
      reports.length > 0 &&
      reports.every((r) => r.completedAt) &&
      (expected == null || cases.length === expected),
    expectedCases: expected,
    options: meta.options ?? {
      browsers: reports.map((r) => r.browser),
      counts: first.config?.counts ?? [],
      engines: [...new Set(cases.map((c) => c.engine))],
      repetitions: first.config?.repetitions ?? null,
    },
    execution: meta.execution ?? first.execution ?? { kind: "unknown", provider: null },
    host: meta.host ?? first.host ?? null,
    config: {
      rowHeight: first.config?.rowHeight ?? 48,
      rowMode: first.config?.rowMode ?? "fixed",
      rowScenario: first.config?.rowScenario ?? null,
      viewport: first.config?.viewport ?? null,
      containerHeight: 360,
      listWidth: 900,
      caseDeadlineMs: first.config?.caseDeadlineMs ?? null,
      processRssBudgetMiB: first.config?.processRssBudgetMiB ?? null,
      heapLimitMiB: first.config?.heapLimitMiB ?? null,
      scope: first.config?.scope ?? "container",
    },
    configs: Object.fromEntries(
      reports.map((r) => [r.config?.suite, r.config]),
    ),
    versions: first.versions ?? [],
    // Exact setup per adapter ID. Older runs fall back to the current registry.
    adapters: (
      meta.options?.engines ?? [...new Set(cases.map((c) => c.engine))]
    ).map(
      (id) =>
        first.adapters?.find((a) => a.id === id) ?? {
          ...adapterById(id),
          id,
          engine: engineOf(id),
        },
    ),
    browsers,
    cases,
  };
}

export function manifestEntry(run) {
  return {
    id: run.id,
    file: `runs/${run.id}.json`,
    suite: run.suite,
    rowMode: run.config.rowMode ?? "fixed",
    profile: run.options.profile ?? "default",
    execution: run.execution ?? { kind: "unknown", provider: null },
    startedAt: run.startedAt,
    complete: run.complete,
    browsers: run.browsers.map((b) => b.name),
    counts: run.options.counts,
    engines: run.options.engines,
    repetitions: run.options.repetitions,
    cases: run.cases.length,
  };
}

// Newest first; re-publishing a run replaces its entry.
export function updateManifest(manifest, run, keep = 20) {
  const runs = [
    manifestEntry(run),
    ...(manifest?.runs ?? []).filter((r) => r.id !== run.id),
  ].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return {
    schema: BENCH_SCHEMA,
    updatedAt: new Date().toISOString(),
    runs: runs.slice(0, keep),
    dropped: runs.slice(keep).map((r) => r.file),
  };
}

// Missing heap is unavailable, never zero.
const deltaMiB = (after, before) =>
  Number.isFinite(after) && Number.isFinite(before)
    ? (after - before) / 1048576
    : null;

const maxAbs = (values) => {
  const measured = values.filter(Number.isFinite).map(Math.abs);
  return measured.length ? Math.max(...measured) : null;
};

const sumOrNull = (cases, pick) => {
  const values = cases.map(pick).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};

// Page Down starts at row 101; "moved" means the first visible row advanced.
export function pageDownResult(c) {
  if (!c.keyboard) return null;
  if (!c.keyboard.focused) return "not-focusable";
  return c.keyboard.pageDownFirst > 100 ? "moved" : "stuck";
}

// Aggregate passes for one library in one browser at one row count.
export function summarizeGroup(cases) {
  const done = cases.filter((c) => c.status === "completed");
  const seeks = cases.flatMap((c) => c.seeks);
  const native = cases.filter((c) => c.nativeEnd);
  const failedChecks = done.filter(
    (c) =>
      c.seeks.some((s) => !s.reached || s.aligned === false) ||
      (c.nativeEnd && !c.nativeEnd.lastRowVisible) ||
      c.scroll?.invalidFrames > 0 ||
      c.dynamicChecks?.some((check) => !check.passed) ||
      c.pageErrors.length > 0,
  );
  // Flaky: every pass finished, but they disagree. One pass failing a 1 px
  // alignment check is not the same finding as every pass failing it.
  const verdict = !cases.length
    ? "none"
    : cases.every((c) => c.status === "unsupported")
      ? "unsupported"
    : done.length < cases.length
      ? "error"
      : !failedChecks.length
        ? "pass"
        : failedChecks.length < done.length
          ? "flaky"
          : "fail";
  return {
    passes: cases.length,
    completed: done.length,
    verdict,
    dynamic: {
      passed: cases.flatMap((c) => c.dynamicChecks ?? []).filter((c) => c.passed).length,
      checked: cases.flatMap((c) => c.dynamicChecks ?? []).length,
    },
    statuses: [
      ...new Set(
        cases.filter((c) => c.status !== "completed").map((c) => c.status),
      ),
    ],
    mountMs: median(
      done.filter((c) => c.suite !== "memory").map((c) => c.mount?.visibleMs),
    ),
    mountSamples: done.map((c) => c.mount?.visibleMs).filter(Number.isFinite),
    failedPasses: failedChecks.length,
    jumps: {
      passed: seeks.filter((s) => s.reached).length,
      checked: seeks.length,
    },
    // Reached jumps that also landed at the requested position.
    alignment: {
      passed: seeks.filter((s) => s.aligned === true).length,
      checked: seeks.filter((s) => s.aligned != null).length,
      worstPx: maxAbs(seeks.map((s) => s.alignErrorPx)),
    },
    native: {
      passed: native.filter((c) => c.nativeEnd.lastRowVisible).length,
      checked: native.length,
    },
    nativeStoppedAt:
      native.find((c) => !c.nativeEnd.lastRowVisible)?.nativeEnd.last ?? null,
    firstFailedJump: seeks.find((s) => !s.reached)?.index ?? null,
    peakMounted:
      Math.max(0, ...done.map((c) => c.scroll?.peakMounted ?? 0)) || null,
    commitMs: median(done.map((c) => c.mount?.commitMs)),
    invalidFrames: sumOrNull(done, (c) => c.scroll?.invalidFrames),
    wheelPx: median(cases.map((c) => c.wheel?.logicalPixels)),
    pageDown: {
      passed: cases.filter((c) => pageDownResult(c) === "moved").length,
      checked: cases.filter((c) => c.keyboard?.focused).length,
      notFocusable: cases.filter((c) => pageDownResult(c) === "not-focusable")
        .length,
    },
    resize: {
      passed: cases.filter((c) => c.resize?.keepsRow101).length,
      checked: cases.filter((c) => c.resize).length,
    },
    longTasks: cases.some((c) => c.longTasks)
      ? cases.reduce((sum, c) => sum + (c.longTasks?.count ?? 0), 0)
      : null,
    longTaskMs: sumOrNull(cases, (c) => c.longTasks?.totalMs),
    peakRssMiB:
      Math.max(0, ...cases.map((c) => c.peakProcessRssMiB ?? 0)) || null,
    heapMountedMiB: median(
      cases.map((c) => deltaMiB(c.heap.mountedGC, c.heap.before)),
    ),
    heapRetainedMiB: median(
      cases.map((c) => deltaMiB(c.heap.afterWork, c.heap.before)),
    ),
    heapUnmountMiB: median(
      cases.map((c) => deltaMiB(c.heap.afterUnmountGC, c.heap.before)),
    ),
    outcomes: [...new Set(cases.map((c) => c.outcome.label))],
    details: [
      ...new Set(
        cases
          .flatMap((c) => [c.outcome.detail, ...c.pageErrors])
          .filter(Boolean),
      ),
    ],
  };
}

export function summarizeRun(run, browser, count) {
  return run.options.engines.map((engine) => ({
    engine,
    ...summarizeGroup(
      run.cases.filter(
        (c) =>
          c.engine === engine && c.browser === browser && c.count === count,
      ),
    ),
  }));
}
