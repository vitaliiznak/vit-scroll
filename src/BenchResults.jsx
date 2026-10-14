import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { adapterById, adapterLabel, engineOf } from "./engines.mjs";
import { LibraryLinks } from "./LibraryLinks.jsx";
import { pageDownResult, summarizeRun } from "./bench-results.mjs";
import { Term } from "./Tip.jsx";
// Load the shared sheet first so these rules win ties against it.
import "./style.css";
import "./bench-results.css";

// Interactive pieces of the published results page: the reachability matrix
// and the expandable results table.

export const BROWSER_LABELS = {
  chromium: "Chromium",
  firefox: "Firefox",
  webkit: "WebKit",
};
// Categorical slots 1–3 of the validated dataviz palette; color follows the
// browser everywhere, never its rank.
export const BROWSER_COLORS = {
  chromium: "#2a78d6",
  firefox: "#eb6834",
  webkit: "#1baf7a",
};
export const fmt = (n) => new Intl.NumberFormat("en-US").format(n);
export const rows = (n) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : `${+(n / 1e3).toFixed(1)}K`;
export const num = (v, places = 1) =>
  Number.isFinite(v) ? v.toFixed(places) : "—";
// Result IDs are adapters: a library in one configuration profile.
export const engineName = (id) => adapterLabel(id).name;
const engineNote = (id) => {
  const { profile, note } = adapterLabel(id);
  return note ? `${profile} · ${note}` : profile;
};
const browserName = (b) => BROWSER_LABELS[b] ?? b;
const version = (run, id) =>
  run.versions.find((v) => v.id === engineOf(id))?.version;

export const VERDICT = {
  pass: ["good", "✓ Pass", "Every pass finished and every row check passed"],
  fail: [
    "bad",
    "× Fail",
    "Every pass finished and every pass failed a check",
  ],
  flaky: [
    "mixed",
    "~ Flaky",
    "Every pass finished, but some passed and some failed a check",
  ],
  error: [
    "warn",
    "! Stopped",
    "At least one pass stopped early: error, crash, timeout or memory budget",
  ],
  unsupported: [
    "none",
    "— Unsupported",
    "This adapter does not support the selected row-height scenario",
  ],
  none: ["none", "—", "Not measured in this run"],
};

export function Pill({ verdict, title }) {
  const [tone, label, meaning] = VERDICT[verdict];
  return (
    <span className={`pill verdict ${tone}`} title={title ?? meaning}>
      {label}
    </span>
  );
}

function Swatch({ browser }) {
  return (
    <i
      className="swatch"
      style={{ "--c": BROWSER_COLORS[browser] ?? "#7f8fa5" }}
      aria-hidden="true"
    />
  );
}

export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="bench-filter" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="segmented">
        {options.map(([id, text, sub]) => (
          <button
            key={id}
            aria-pressed={value === id}
            className={value === id ? "is-on" : ""}
            onClick={() => onChange(id)}
          >
            {text}
            {sub && <small>{sub}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Ratio({ r }) {
  if (!r?.checked) return <span className="ratio none">—</span>;
  const tone = r.passed === r.checked ? "good" : "bad";
  return (
    <span className={`ratio ${tone}`}>
      {r.passed}/{r.checked}
    </span>
  );
}

const rowId = (key) => `result-${key.replace(/[^a-z0-9]+/gi, "-")}`;

/* 01 · Reachability matrix ------------------------------------------------ */

export function ReachMatrix({ run, onPick }) {
  const browsers = run.browsers.filter((b) => b.cases > 0);
  const counts = run.options.counts;
  const grid = new Map(
    browsers.flatMap((b) =>
      counts.map((n) => [
        `${b.name}:${n}`,
        new Map(summarizeRun(run, b.name, n).map((s) => [s.engine, s])),
      ]),
    ),
  );
  return (
    <section className="bench-section" aria-labelledby="matrix-title">
      <div className="section-line">
        <h2 id="matrix-title">
          <span>01</span> Can every row be reached?
        </h2>
        <span className="section-meta">
          {run.options.repetitions} PASSES EACH
        </span>
      </div>
      <div className="matrix-legend">
        <span>
          <Pill verdict="pass" /> every check passed
        </span>
        <span>
          <Pill verdict="fail" /> a check failed in every pass
        </span>
        <span>
          <Pill verdict="flaky" /> passes disagree
        </span>
        <span>
          <Pill verdict="error" /> a pass stopped early
        </span>
        <span>
          <Pill verdict="unsupported" /> not run
        </span>
      </div>
      <div
        className="results-scroll"
        role="region"
        aria-label="Correctness by browser and size"
        tabIndex={0}
      >
        <table className="audit-table bench-matrix">
          <thead>
            <tr>
              <th rowSpan={2}>Library</th>
              {browsers.map((b) => (
                <th key={b.name} colSpan={counts.length} className="group">
                  <Swatch browser={b.name} /> {browserName(b.name)}{" "}
                  <small>{b.version}</small>
                  {!b.complete && <small className="audit-stop">partial</small>}
                </th>
              ))}
            </tr>
            <tr>
              {browsers.flatMap((b) =>
                counts.map((n, i) => (
                  <th
                    key={`${b.name}-${n}`}
                    className={i ? "sub" : "sub group-start"}
                  >
                    {rows(n)} rows
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {run.options.engines.map((id) => (
              <tr key={id}>
                <td>
                  <b>{engineName(id)}</b>
                  <small className="profile-tag">{adapterLabel(id).profile}</small>
                  <LibraryLinks
                    id={engineOf(id)}
                    version={version(run, id) ?? null}
                  />
                </td>
                {browsers.flatMap((b) =>
                  counts.map((n, i) => {
                    const s = grid.get(`${b.name}:${n}`).get(id);
                    const counts =
                      s.passes > 0 && s.verdict !== "unsupported"
                        ? `${s.jumps.passed}/${s.jumps.checked} jumps${s.alignment.checked ? ` · ${s.alignment.passed}/${s.alignment.checked} aligned` : ""}${run.suite !== "memory" ? ` · ${s.native.passed}/${s.native.checked} end` : ""}`
                        : null;
                    return (
                      <td
                        key={`${b.name}-${n}`}
                        className={i ? undefined : "group-start"}
                      >
                        <button
                          type="button"
                          className="matrix-cell"
                          title={`${engineName(id)} (${adapterLabel(id).profile}) · ${browserName(b.name)} · ${fmt(n)} rows: jumps ${s.jumps.passed}/${s.jumps.checked}, aligned ${s.alignment.passed}/${s.alignment.checked}, native end ${s.native.passed}/${s.native.checked}, ${s.completed}/${s.passes} passes finished. Click for details.`}
                          aria-label={`${engineName(id)} ${adapterLabel(id).profile}, ${browserName(b.name)}, ${fmt(n)} rows: ${VERDICT[s.verdict][1]}${counts ? `, ${counts}` : ""}. Show details`}
                          onClick={() => onPick(b.name, n, id)}
                        >
                          <Pill verdict={s.verdict} title="" />
                          {counts && <small>{counts}</small>}
                        </button>
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="results-note">
        Counts are checks passed / run, over all passes. Click a cell for
        details.
      </p>
    </section>
  );
}

/* 02 · Results table ------------------------------------------------------- */

// One browser at a time: timings are only comparable within a browser, and
// the matrix above already compares verdicts across browsers.
export function ResultsExplorer({ run, browser, count, onBrowser, onCount, reveal }) {
  const measured = run.browsers.filter((b) => b.cases > 0);
  const shown = measured.find((b) => b.name === browser) ?? measured[0];
  const items = useMemo(() => {
    if (!shown) return [];
    const summaries = new Map(
      summarizeRun(run, shown.name, count).map((s) => [s.engine, s]),
    );
    return run.options.engines.map((engine) => ({
      key: `${shown.name}:${engine}`,
      browser: shown.name,
      engine,
      summary: summaries.get(engine),
    }));
  }, [run, shown, count]);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    if (!reveal) return;
    setExpanded((s) => new Set(s).add(reveal.key));
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(rowId(reveal.key));
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.querySelector("button")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);

  const toggle = (key) =>
    setExpanded((set) => {
      const next = new Set(set);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <section className="bench-section" aria-labelledby="slice-title">
      <div className="section-line">
        <h2 id="slice-title">
          <span>02</span> Results in {browserName(shown?.name)}
        </h2>
        <span className="section-meta">CLICK A LIBRARY FOR EACH PASS</span>
      </div>
      <div className="bench-filters">
        <Segmented
          label="Rows"
          value={count}
          onChange={onCount}
          options={run.options.counts.map((n) => [n, fmt(n)])}
        />
        {measured.length > 1 && (
          <Segmented
            label="Browser"
            value={shown.name}
            onChange={onBrowser}
            options={measured.map((b) => [b.name, browserName(b.name), b.version])}
          />
        )}
      </div>
      <ResultsTable
        run={run}
        count={count}
        items={items}
        expanded={expanded}
        onRow={toggle}
      />
      <p className="results-note">
        — means not measured. Timings use finished passes only; compare them
        within one browser.
      </p>
    </section>
  );
}

function columnsFor(run) {
  const memory = run.suite === "memory";
  const dynamic = run.config.rowMode === "dynamic";
  return [
    { id: "verdict", cell: (s) => <Pill verdict={s.verdict} /> },
    { id: "jumps", cell: (s) => <Ratio r={s.jumps} /> },
    {
      id: "aligned",
      cell: (s) => (
        <>
          <Ratio r={s.alignment} />
          {s.alignment.passed < s.alignment.checked &&
            Number.isFinite(s.alignment.worstPx) && (
              <small>worst {num(s.alignment.worstPx)} px</small>
            )}
        </>
      ),
    },
    !memory && { id: "native", cell: (s) => <Ratio r={s.native} /> },
    dynamic && { id: "dynamic", cell: (s) => <Ratio r={s.dynamic} /> },
    !memory && { id: "mount", sub: "ms", cell: (s) => num(s.mountMs) },
    memory && {
      id: "heapMounted",
      sub: "Δ MiB · median",
      cell: (s) => num(s.heapMountedMiB, 2),
    },
    memory && {
      id: "heapRetained",
      sub: "Δ MiB · median",
      cell: (s) => num(s.heapRetainedMiB, 2),
    },
    memory && {
      id: "heapUnmount",
      sub: "Δ MiB · median",
      cell: (s) => num(s.heapUnmountMiB, 2),
    },
    { id: "rss", sub: "MiB", cell: (s) => num(s.peakRssMiB, 0) },
    {
      id: "outcome",
      wide: true,
      cell: (s) =>
        s.passes ? (
          <>
            <b>{s.outcomes.join(" / ")}</b>
            {s.details[0] && <small className="clamp">{s.details[0]}</small>}
            {s.details.length > 1 && (
              <small className="more">+{s.details.length - 1} more · expand</small>
            )}
          </>
        ) : (
          "—"
        ),
    },
  ].filter(Boolean);
}

function ResultsTable({ run, count, items, expanded, onRow }) {
  const cols = columnsFor(run);
  const span = cols.length + 1;
  // Expanded panels take the visible scroller width (not the table's), so
  // they never widen the table and stay readable while it scrolls sideways.
  const scroller = useRef(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const sync = () =>
      el.style.setProperty("--scroller-w", `${el.clientWidth}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={scroller}
      className="results-scroll"
      role="region"
      aria-label="Benchmark results"
      tabIndex={0}
    >
      <table className="audit-table res-table">
        <thead>
          <tr>
            <th scope="col">Library</th>
            {cols.map((c) => (
              <th key={c.id} scope="col" className={c.wide ? "wide" : undefined}>
                <Term id={c.id} />
                {c.sub && <small>{c.sub}</small>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isOpen = expanded.has(item.key);
            const detailId = `${rowId(item.key)}-detail`;
            return (
              <Fragment key={item.key}>
                <tr
                  id={rowId(item.key)}
                  className={`res-row${isOpen ? " is-open" : ""}`}
                  onClick={(e) => {
                    if (!e.target.closest("button, a")) onRow(item.key);
                  }}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="res-toggle"
                      aria-expanded={isOpen}
                      aria-controls={detailId}
                      onClick={() => onRow(item.key)}
                    >
                      <i className="chev" aria-hidden="true" />
                      <span className="item-title">
                        <span>
                          <b>{engineName(item.engine)}</b>
                          <small>{engineNote(item.engine)}</small>
                        </span>
                      </span>
                    </button>
                  </th>
                  {cols.map((c) => (
                    <td
                      key={c.id}
                      className={c.wide ? "outcome-cell" : undefined}
                    >
                      {c.cell(item.summary)}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr className="res-detail" id={detailId}>
                    <td colSpan={span}>
                      <RowDetails run={run} count={count} item={item} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* Expanded row ------------------------------------------------------------- */

const targetName = (index, count) =>
  index === 0
    ? "first"
    : index === count - 1
      ? "last"
      : index === Math.floor(count / 2)
        ? "50%"
        : index === Math.floor(count / 4)
          ? "25%"
          : index === Math.floor(count * 0.9)
            ? "90%"
            : "";

function Mark({ ok, label, children }) {
  const [cls, sym] =
    ok == null ? ["none", "–"] : ok ? ["good", "✓"] : ["bad", "×"];
  return (
    <span className={`mark ${cls}`} title={label}>
      <span aria-hidden="true">{sym}</span>
      <span className="sr-only">{label}</span>
      {children}
    </span>
  );
}

function Metric({ id, children }) {
  return (
    <div className="metric">
      <dt>
        <Term id={id} />
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function RowDetails({ run, count, item }) {
  const s = item.summary;
  const cases = run.cases
    .filter(
      (c) =>
        c.engine === item.engine &&
        c.browser === item.browser &&
        c.count === count,
    )
    .sort((a, b) => a.round - b.round);
  const memory = run.suite === "memory";
  const title = `${engineName(item.engine)} (${adapterLabel(item.engine).profile}) in ${browserName(item.browser)} at ${fmt(count)} rows`;

  if (s.verdict === "unsupported")
    return (
      <div className="res-panel">
        <p className="res-unsupported">
          <b>Not run.</b> {s.details[0] ?? VERDICT.unsupported[2]}
        </p>
      </div>
    );

  const targets = [
    ...new Set(cases.flatMap((c) => c.seeks.map((x) => x.index))),
  ].sort((a, b) => a - b);
  const dynamicNames = [
    ...new Set(cases.flatMap((c) => (c.dynamicChecks ?? []).map((d) => d.name))),
  ];
  const errors = [...new Set(cases.flatMap((c) => c.pageErrors))];

  return (
    <div className="res-panel" aria-label={title}>
      <div className="res-cards">
        {targets.length > 0 && (
          <section className="res-card">
            <h4>Row jumps</h4>
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Target row</th>
                  {cases.map((c) => (
                    <th key={c.round} scope="col">
                      Pass {c.round + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t}>
                    <th scope="row">
                      {fmt(t + 1)} <small>{targetName(t, count)}</small>
                    </th>
                    {cases.map((c) => {
                      const seek = c.seeks.find((x) => x.index === t);
                      const off = seek?.aligned === false;
                      return (
                        <td key={c.round}>
                          <Mark
                            ok={seek ? seek.reached && !off : null}
                            label={
                              !seek
                                ? "not attempted"
                                : seek.reached
                                  ? `reached in ${num(seek.visibleMs)} ms${off ? `, ${num(seek.alignErrorPx)} px from the requested position` : ""}`
                                  : `not reached${Number.isFinite(seek.last) ? `; rows ${fmt(seek.first + 1)}–${fmt(seek.last + 1)} visible` : ""}`
                            }
                          >
                            {seek?.reached && (
                              <small>{num(seek.visibleMs)} ms</small>
                            )}
                            {off && <small>{num(seek.alignErrorPx)} px</small>}
                          </Mark>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {!memory && (
          <section className="res-card">
            <h4>Other checks</h4>
            <dl className="metrics">
              <Metric id="native">
                <span className="marks">
                  {cases.map((c) => (
                    <Mark
                      key={c.round}
                      ok={c.nativeEnd ? c.nativeEnd.lastRowVisible : null}
                      label={`Pass ${c.round + 1}: ${!c.nativeEnd ? "not reached" : c.nativeEnd.lastRowVisible ? "last row visible" : `stopped at row ${fmt((c.nativeEnd.last ?? 0) + 1)}`}`}
                    />
                  ))}
                </span>
                {Number.isFinite(s.nativeStoppedAt) && (
                  <small>stopped at row {fmt(s.nativeStoppedAt + 1)} of {fmt(count)}</small>
                )}
              </Metric>
              <Metric id="pageDown">
                <span className="marks">
                  {cases.map((c) => {
                    const r = pageDownResult(c);
                    return (
                      <Mark
                        key={c.round}
                        ok={r === "moved" ? true : r === "stuck" ? false : null}
                        label={`Pass ${c.round + 1}: ${r === "not-focusable" ? "not focusable" : r ?? "not reached"}`}
                      />
                    );
                  })}
                </span>
                {s.pageDown.notFocusable > 0 && <small>not focusable</small>}
              </Metric>
              <Metric id="resize">
                <span className="marks">
                  {cases.map((c) => (
                    <Mark
                      key={c.round}
                      ok={c.resize ? c.resize.keepsRow101 : null}
                      label={`Pass ${c.round + 1}: ${!c.resize ? "not reached" : c.resize.keepsRow101 ? "row 101 kept" : "row 101 lost"}`}
                    />
                  ))}
                </span>
              </Metric>
            </dl>
          </section>
        )}

        {dynamicNames.length > 0 && (
          <section className="res-card">
            <h4>Height changes</h4>
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Change</th>
                  {cases.map((c) => (
                    <th key={c.round} scope="col">
                      Pass {c.round + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dynamicNames.map((name) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    {cases.map((c) => {
                      const d = c.dynamicChecks?.find((x) => x.name === name);
                      return (
                        <td key={c.round}>
                          <Mark
                            ok={d ? d.passed : null}
                            label={
                              d
                                ? `${d.passed ? "passed" : "failed"} · geometry ${d.heightChecks ? "valid" : "invalid"} · anchor ${d.anchorVisible ? "visible" : "lost"} · ${num(d.settledMs)} ms`
                                : "not reached"
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <table className="mini-table res-passes">
        <caption>Each pass</caption>
        <thead>
          <tr>
            <th scope="col">Pass</th>
            {!memory && (
              <th scope="col">
                Mount <small>ms</small>
              </th>
            )}
            <th scope="col">Row jumps</th>
            <th scope="col">
              Peak RSS <small>MiB</small>
            </th>
            <th scope="col">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.round}>
              <td>{c.round + 1}</td>
              {!memory && <td>{num(c.mount?.visibleMs)}</td>}
              <td>
                <Ratio
                  r={{
                    passed: c.seeks.filter((x) => x.reached).length,
                    checked: c.seeks.length,
                  }}
                />
              </td>
              <td>{num(c.peakProcessRssMiB, 0)}</td>
              <td className="outcome-cell">
                <b>{c.outcome.label}</b>
                {c.outcome.detail && <small>{c.outcome.detail}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {errors.length > 0 && (
        <div className="res-errors">
          <h4>Page errors</h4>
          <ul>
            {errors.map((e) => (
              <li key={e}>
                <code>{e}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* 03 · Configurations ------------------------------------------------------ */

// What exactly was measured. Runs published before adapters were recorded
// fall back to the current registry for the same IDs.
export function Configurations({ run }) {
  const dynamic = run.config.rowMode === "dynamic";
  const adapters = run.options.engines.map(
    (id) =>
      run.adapters?.find((a) => a.id === id) ?? { ...adapterById(id), id },
  );
  return (
    <section className="bench-section" aria-labelledby="configs-title">
      <div className="section-line">
        <h2 id="configs-title">
          <span>03</span> What was configured
        </h2>
        <span className="section-meta">ONE ROW PER SETUP</span>
      </div>
      <p className="results-note">
        A result describes one setup of a library, not the library in general.{" "}
        <b>Default</b> is its minimal documented setup. <b>Best effort</b> is
        its strongest documented setup for this workload, including integration
        code. Compare best-effort rows for what a library can do, default rows
        for what it does out of the box.
      </p>
      <div
        className="results-scroll"
        role="region"
        aria-label="Configurations measured"
        tabIndex={0}
      >
        <table className="audit-table config-table">
          <thead>
            <tr>
              <th scope="col">Library</th>
              <th scope="col">
                <Term id="profile" />
              </th>
              <th scope="col">Options</th>
              <th scope="col">Best effort</th>
            </tr>
          </thead>
          <tbody>
            {adapters.map((a) => (
              <tr key={a.id}>
                <th scope="row">
                  <b>{engineName(a.id)}</b>
                  <small>{a.id}</small>
                </th>
                <td>{adapterLabel(a.id).profile}</td>
                <td>
                  {(dynamic ? a.dynamicConfig : a.config) ??
                    (dynamic ? "Not run with measured heights" : "Not recorded")}
                </td>
                <td>{a.bestEffort ?? "Best effort is a separate setup."}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
