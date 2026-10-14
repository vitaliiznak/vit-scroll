import React, { useEffect, useMemo, useState } from "react";
import { BENCH_DIR } from "./bench-results.mjs";
import { DEMO_URL, SiteHeader } from "./SiteHeader.jsx";
import { executionLabel, executionDetails, machineLines, githubRunUrl } from "./run-environment.mjs";
import {
  BROWSER_LABELS,
  Configurations,
  ReachMatrix,
  ResultsExplorer,
  Segmented,
  rows,
} from "./BenchResults.jsx";

const base = `${import.meta.env.BASE_URL}${BENCH_DIR}/`;
const SUITE_LABELS = {
  all: "All measurements",
  performance: "Checks & timing",
  memory: "Memory",
};
const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

async function getJson(path) {
  const response = await fetch(base + path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

function readParams() {
  const p = new URLSearchParams(location.search);
  return {
    run: p.get("run"),
    browser: p.get("browser"),
    rows: Number(p.get("rows")) || null,
  };
}

export function BenchmarkPage() {
  const initial = useMemo(readParams, []);
  const [manifest, setManifest] = useState(null);
  const [runId, setRunId] = useState(initial.run);
  const [loadedRun, setRun] = useState(null);
  const [phase, setPhase] = useState("performance");
  const run = useMemo(() => {
    if (!loadedRun || loadedRun.suite !== "all") return loadedRun;
    const cases = loadedRun.cases.filter((c) => c.suite === phase);
    return {
      ...loadedRun,
      config: { ...loadedRun.config, ...loadedRun.configs?.[phase] },
      suite: phase,
      cases,
      expectedCases: null,
      browsers: loadedRun.browsers.filter((b) =>
        cases.some((c) => c.browser === b.name),
      ),
    };
  }, [loadedRun, phase]);
  const [browser, setBrowser] = useState(initial.browser);
  const [count, setCount] = useState(initial.rows);
  const [reveal, setReveal] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.title = "ScrollBench — React virtual-scrolling benchmarks";
    getJson("index.json")
      .then((m) => {
        setManifest(m);
        // Default to the newest timing run; the picker lists memory runs too.
        if (!m.runs?.some((r) => r.id === initial.run))
          setRunId(
            (m.runs?.find((r) => ["all", "performance"].includes(r.suite)) ?? m.runs?.[0])
              ?.id ?? null,
          );
      })
      .catch(() => setManifest({ runs: [] }));
  }, [initial.run]);

  useEffect(() => {
    const entry = manifest?.runs.find((r) => r.id === runId);
    if (!entry) return;
    let current = true;
    setError(null);
    getJson(entry.file)
      .then((r) => {
        if (!current) return;
        setRun(r);
        setPhase("performance");
        const measured = r.browsers
          .filter((b) => b.cases > 0)
          .map((b) => b.name);
        setBrowser((b) => (measured.includes(b) ? b : measured[0]));
        setCount((n) =>
          r.options.counts.includes(n) ? n : Math.max(...r.options.counts),
        );
      })
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [manifest, runId]);

  useEffect(() => {
    if (!run || !browser || !count) return;
    const p = new URLSearchParams({
      run: run.id,
      browser,
      rows: String(count),
    });
    history.replaceState(null, "", `?${p}`);
  }, [run, browser, count]);

  // A matrix cell opens the same library × browser × size in the table.
  const pick = (name, n, engine) => {
    setCount(n);
    setBrowser(name);
    setReveal({ key: `${name}:${engine}`, at: Date.now() });
  };

  const phaseControl = loadedRun?.suite === "all" && (
    <Segmented
      label="Measurements"
      value={phase}
      onChange={(value) => setPhase(value)}
      options={[
        ["performance", "Checks & timing"],
        ...(loadedRun.options.browsers.includes("chromium")
          ? [["memory", "Heap memory"]]
          : []),
      ]}
    />
  );

  return (
    <>
      <SiteHeader page="benchmarks" />
      <main className="bench-page">
        <section className="hero bench-hero">
          <div>
            <div className="eyebrow">BENCHMARK RESULTS</div>
            <h1>How each library held up</h1>
            <p>
              Eight React virtual-scrolling libraries on the same rows, each in
              its default setup and its best-effort setup. Each pass mounts one
              setup in a fresh headless browser and runs the same scroll
              workload. Published by <code>npm run bench</code>.
            </p>
            <a className="hero-link" href={DEMO_URL}>
              Try the libraries in the live demo →
            </a>
          </div>
          {run && (
            <RunCard
              run={run}
              manifest={manifest}
              runId={runId}
              onRun={setRunId}
            />
          )}
        </section>

        {!manifest && (
          <p className="bench-status">Loading published results…</p>
        )}
        {manifest && !manifest.runs.length && <EmptyState />}
        {error && (
          <p className="bench-status" role="alert">
            Could not load this run ({error}). Re-publish it with{" "}
            <code>npm run bench:publish -- output/bench/&lt;timestamp&gt;</code>
            .
          </p>
        )}
        {run && (
          <>
            {phaseControl && (
              <div className="bench-scope">
                <div className="bench-filters">{phaseControl}</div>
              </div>
            )}
            <ReachMatrix run={run} onPick={pick} />
            <ResultsExplorer
              run={run}
              browser={browser}
              count={count}
              onBrowser={setBrowser}
              onCount={setCount}
              reveal={reveal}
            />
            <Configurations run={run} />
            <Method run={run} />
          </>
        )}
        <footer>
          <span className="brand">↕ scrollbench</span>
          <span>React lists. Reproducible measurements.</span>
        </footer>
      </main>
    </>
  );
}

function RunCard({ run, manifest, runId, onRun }) {
  const runUrl = githubRunUrl(run.execution);
  return (
    <div className="browser-note bench-run-card">
      <span>RECORDED RUN</span>
      {manifest.runs.length > 1 ? (
        <label>
          <span className="sr-only">Published run</span>
          <select value={runId} onChange={(e) => onRun(e.target.value)}>
            {manifest.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {when(r.startedAt)} · {executionLabel(r.execution)} · {r.rowMode ?? "fixed"} heights · {SUITE_LABELS[r.suite] ?? r.suite} ·{" "}
                {r.browsers.length > 1
                  ? `${r.browsers.length} browsers`
                  : BROWSER_LABELS[r.browsers[0]] ?? r.browsers[0]}
                {r.complete ? "" : " · partial"}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <strong className="bench-run-date">{when(run.startedAt)}</strong>
      )}
      <p>
        {run.options.repetitions} passes × {run.options.engines.length}{" "}
        libraries × {run.options.counts.map(rows).join(" / ")} rows
        {!run.complete && (
          <b className="bench-partial">
            <br />
            Partial run: {run.cases.length}
            {run.expectedCases ? ` of ${run.expectedCases}` : ""} cases
          </b>
        )}
      </p>
      <a
        className="bench-download"
        href={base + `runs/${run.id}.json`}
        download
      >
        Download JSON ↓
      </a>
      <div className="bench-environment" aria-label="Run environment">
        <b className="bench-origin">{executionLabel(run.execution)}</b>
        {machineLines(run.host).map((line) => <div key={line}>{line}</div>)}
        {executionDetails(run.execution).map((line) => <div key={line}>{line}</div>)}
        {runUrl && <a href={runUrl} target="_blank" rel="noreferrer">View GitHub workflow run ↗</a>}
        <small>Recorded at execution time. Compare timings on the same hardware and browser.</small>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="bench-empty">
      <h2>No benchmark has been published yet</h2>
      <p>
        Run the benchmark once; it publishes its results to this page
        automatically.
      </p>
      <pre>
        <code>{`npm run bench:install   # once: Playwright browsers
npm run bench -- --browser chromium,firefox,webkit
npm run build && npm run preview   # then reopen this page`}</code>
      </pre>
    </section>
  );
}

function Method({ run }) {
  const c = run.config;
  return (
    <section
      className="bench-section bench-method"
      aria-labelledby="method-title"
    >
      <div className="section-line">
        <h2 id="method-title">
          <span>04</span> Method
        </h2>
      </div>
      <div className="bench-method-grid">
        <p>
          Fresh headless{" "}
          {run.browsers.map((b) => BROWSER_LABELS[b.name]).join(", ")} per pass,{" "}
          {c.rowMode === "dynamic"
            ? "measured 32–96px rows that grow, shrink and reflow"
            : `fixed ${c.rowHeight}px rows`}
          , a {c.listWidth}×{c.containerHeight}px list. Library order rotates
          each round. Each pass stops at {c.caseDeadlineMs / 1000}s or{" "}
          {c.processRssBudgetMiB} MiB. One machine; compare timings within one
          browser.
        </p>
        <p>
          Related:{" "}
          <a
            href="https://github.com/TanStack/virtual/tree/main/benchmarks"
            target="_blank"
            rel="noreferrer"
          >
            TanStack Virtual's benchmark suite ↗
          </a>{" "}
          times TanStack, virtua, React Virtuoso and react-window up to 100K
          rows, below the browser height limit. This page covers larger lists,
          landing precision, more libraries and their best-effort setups.
        </p>
        <pre>
          <code>{`npm ci && npm run bench:install
npm run bench -- --browser ${run.options.browsers.join(",")} --suite ${run.suite} --row-mode ${c.rowMode ?? "fixed"} --rows ${run.options.counts.join(",")} --library ${run.options.engines.join(",")} --profile ${run.options.profile ?? "default"} --repeats ${run.options.repetitions}`}</code>
        </pre>
      </div>
    </section>
  );
}
