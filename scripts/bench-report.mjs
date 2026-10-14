import { ADAPTERS, adapterLabel, engineOf } from "../src/engines.mjs";
import { executionLabel, executionDetails, machineLines, githubRunUrl } from "../src/run-environment.mjs";
import {
  pageDownResult,
  slimCase,
  summarizeGroup,
} from "../src/bench-results.mjs";
import { MEASURES, measure } from "../src/bench-glossary.mjs";

// Self-contained HTML report written next to the raw JSON by `npm run bench`.
// Results can be grouped by browser or by library; every row expands to show
// each pass and check; every measurement has a "?" tooltip whose text is the
// glossary at the end of the page (shared with the results page).

const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (x, places = 1) => (Number.isFinite(x) ? x.toFixed(places) : "—");
const fmt = (n) => Number(n).toLocaleString("en-US");
const BROWSERS = { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" };
const COLORS = { chromium: "#2a78d6", firefox: "#eb6834", webkit: "#1baf7a" };
const browserName = (b) => BROWSERS[b] ?? b;
// IDs are adapters: a library in one configuration profile.
const engineName = (id) => adapterLabel(id).name;
const engineNote = (id) => {
  const { profile, note } = adapterLabel(id);
  return note ? `${profile} · ${note}` : profile;
};
const VERDICT = {
  pass: ["good", "✓ Pass"],
  fail: ["bad", "× Fail"],
  flaky: ["mixed", "~ Flaky"],
  error: ["warn", "! Stopped"],
  unsupported: ["none", "Unsupported"],
  none: ["none", "Not measured"],
};

const tip = (id) =>
  `<button type="button" class="tip" aria-label="What is ${esc(measure(id).label)}?" aria-describedby="m-${id}" aria-expanded="false">?</button>`;
const term = (id, text) =>
  `<span class="term">${esc(text ?? measure(id).label)}${tip(id)}</span>`;
const pill = (verdict) =>
  `<span class="pill ${VERDICT[verdict][0]}">${VERDICT[verdict][1]}</span>`;
const ratio = (r) =>
  r?.checked
    ? `<span class="ratio ${r.passed === r.checked ? "good" : "bad"}">${r.passed}/${r.checked}</span>`
    : `<span class="ratio none">—</span>`;
const swatch = (b) =>
  `<i class="swatch" style="--c:${COLORS[b] ?? "#7f8fa5"}" aria-hidden="true"></i>`;
const mark = (ok, label, extra = "") =>
  `<span class="mark ${ok == null ? "none" : ok ? "good" : "bad"}" title="${esc(label)}"><span aria-hidden="true">${ok == null ? "–" : ok ? "✓" : "×"}</span><span class="sr">${esc(label)}</span>${extra}</span>`;
const metric = (id, value, note) =>
  `<div class="metric"><dt>${term(id)}</dt><dd>${value}${note ? `<small>${esc(note)}</small>` : ""}</dd></div>`;
const perPass = (cases, pick, places = 1) => {
  const values = cases.map(pick);
  return values.some(Number.isFinite)
    ? `passes: ${values.map((v) => num(v, places)).join(" · ")}`
    : null;
};
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

// Largest stage sample of one heap field, in MiB.
function heapMax(raw, key) {
  const values = raw
    .flatMap((c) => c.heapSamples ?? [])
    .filter((x) => x.stage !== "baseline" && x.stage !== "after-unmount-gc")
    .map((x) => x[key])
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) / 1048576 : null;
}

function columns({ memory, dynamic }) {
  return [
    ["verdict", null, (s) => pill(s.verdict)],
    [
      "finished",
      "finished / run",
      (s) =>
        s.verdict === "unsupported"
          ? "Not run"
          : `${s.completed}/${s.passes}${s.statuses.length ? `<small class="stop">${esc(s.statuses.join(", "))}</small>` : ""}`,
    ],
    ["jumps", "passed / checked", (s) => ratio(s.jumps)],
    [
      "aligned",
      "within 1 px / reached",
      (s) =>
        `${ratio(s.alignment)}${Number.isFinite(s.alignment.worstPx) && s.alignment.passed < s.alignment.checked ? `<small>worst ${num(s.alignment.worstPx)} px</small>` : ""}`,
    ],
    !memory && ["native", "passed / checked", (s) => ratio(s.native)],
    dynamic && ["dynamic", "passed / checked", (s) => ratio(s.dynamic)],
    !memory && ["mount", "median ms", (s) => num(s.mountMs)],
    !memory && ["peakMounted", "peak mounted", (s) => s.peakMounted ?? "—"],
    memory && ["heapMounted", "Δ MiB · median", (s) => num(s.heapMountedMiB)],
    memory && ["heapRetained", "Δ MiB · median", (s) => num(s.heapRetainedMiB)],
    memory && ["heapUnmount", "Δ MiB · median", (s) => num(s.heapUnmountMiB)],
    memory && ["heapMax", "MiB", (s, raw) => num(heapMax(raw, "usedSize"))],
    memory && [
      "backing",
      "MiB",
      (s, raw) => num(heapMax(raw, "backingStorageSize")),
    ],
    ["rss", "MiB · sampled max", (s) => num(s.peakRssMiB, 0)],
    [
      "outcome",
      null,
      (s) =>
        s.passes
          ? `<b>${esc(s.outcomes.join(" / "))}</b>${s.details[0] ? `<small class="clamp" title="${esc(s.details.join("\n"))}">${esc(s.details[0])}</small>` : ""}${s.details.length > 1 ? `<small class="more">+${s.details.length - 1} more · expand</small>` : ""}`
          : "—",
    ],
  ].filter(Boolean);
}

function details(raw, s, { memory, count }) {
  const cases = raw.map(slimCase).sort((a, b) => a.round - b.round);
  if (s.verdict === "unsupported")
    return `<p class="unsupported"><b>Not run.</b> ${esc(s.details[0] ?? "This adapter does not support the scenario.")}</p>`;
  const passHead = cases.map((c) => `<th scope="col">Pass ${c.round + 1}</th>`).join("");
  const targets = [...new Set(cases.flatMap((c) => c.seeks.map((x) => x.index)))].sort((a, b) => a - b);
  const jumps = targets.length
    ? `<table class="mini"><caption>${term("jumps")}</caption><thead><tr><th scope="col">Target row</th>${passHead}</tr></thead><tbody>${targets
        .map(
          (t) =>
            `<tr><th scope="row">${fmt(t + 1)} <small>${targetName(t, count)}</small></th>${cases
              .map((c) => {
                const seek = c.seeks.find((x) => x.index === t);
                const off = seek?.aligned === false;
                return `<td>${mark(
                  seek ? seek.reached && !off : null,
                  !seek ? "not attempted" : !seek.reached ? "not reached" : `reached in ${num(seek.visibleMs)} ms${off ? `, ${num(seek.alignErrorPx)} px from the requested position` : ""}`,
                  seek?.reached ? `<small>${num(seek.visibleMs)} ms</small>${off ? `<small>${num(seek.alignErrorPx)} px</small>` : ""}` : "",
                )}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table>`
    : "";
  const marks = (pick) => `<span class="marks">${cases.map((c, i) => pick(c, i)).join("")}</span>`;
  const checks = memory
    ? ""
    : [
        metric(
          "native",
          marks((c) =>
            mark(
              c.nativeEnd ? c.nativeEnd.lastRowVisible : null,
              `Pass ${c.round + 1}: ${!c.nativeEnd ? "not reached" : c.nativeEnd.lastRowVisible ? "last row visible" : `stopped at row ${fmt((c.nativeEnd.last ?? 0) + 1)}`}`,
            ),
          ),
          Number.isFinite(s.nativeStoppedAt) ? `stopped at row ${fmt(s.nativeStoppedAt + 1)} of ${fmt(count)}` : null,
        ),
        metric(
          "pageDown",
          marks((c) => {
            const r = pageDownResult(c);
            return mark(r === "moved" ? true : r === "stuck" ? false : null, `Pass ${c.round + 1}: ${r === "not-focusable" ? "not focusable" : r ?? "not reached"}`);
          }),
          s.pageDown.notFocusable ? "not focusable" : null,
        ),
        metric(
          "resize",
          marks((c) => mark(c.resize ? c.resize.keepsRow101 : null, `Pass ${c.round + 1}: ${!c.resize ? "not reached" : c.resize.keepsRow101 ? "row 101 kept" : "row 101 lost"}`)),
        ),
        metric("invalidFrames", s.invalidFrames ?? "—"),
      ].join("");
  const dynamicNames = [...new Set(cases.flatMap((c) => c.dynamicChecks.map((d) => d.name)))];
  const dynamic = dynamicNames.length
    ? `<table class="mini"><caption>${term("dynamic")}</caption><thead><tr><th scope="col">Change</th>${passHead}</tr></thead><tbody>${dynamicNames
        .map(
          (name) =>
            `<tr><th scope="row">${esc(name)}</th>${cases
              .map((c) => {
                const d = c.dynamicChecks.find((x) => x.name === name);
                return `<td>${mark(
                  d ? d.passed : null,
                  d ? `${d.passed ? "passed" : "failed"} · geometry ${d.heightChecks ? "valid" : "invalid"} · anchor ${d.anchorVisible ? "visible" : "lost"} · ${num(d.settledMs)} ms` : "not reached",
                  d && Number.isFinite(d.anchorDriftPx) ? `<small>${num(d.anchorDriftPx)} px drift</small>` : "",
                )}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table>`
    : "";
  const timingCard = memory
    ? ""
    : `<section class="card"><h4>Timing and input</h4><dl>${[
        metric("mount", `${num(s.mountMs)} ms`, perPass(cases, (c) => c.mount?.visibleMs)),
        metric("commit", `${num(s.commitMs)} ms`),
        metric("peakMounted", s.peakMounted ?? "—"),
        metric("wheel", Number.isFinite(s.wheelPx) ? `${num(s.wheelPx, 0)} px` : "—"),
        metric("longTasks", s.longTasks ?? "n/a", Number.isFinite(s.longTaskMs) ? `${num(s.longTaskMs)} ms in total` : null),
      ].join("")}</dl></section>`;
  const memoryCard = `<section class="card"><h4>Memory</h4><dl>${[
    memory ? metric("heapMounted", `${num(s.heapMountedMiB, 2)} MiB`) : "",
    memory ? metric("heapRetained", `${num(s.heapRetainedMiB, 2)} MiB`) : "",
    memory ? metric("heapUnmount", `${num(s.heapUnmountMiB, 2)} MiB`) : "",
    memory ? metric("heapMax", `${num(heapMax(raw, "usedSize"))} MiB`) : "",
    memory ? metric("backing", `${num(heapMax(raw, "backingStorageSize"))} MiB`) : "",
    metric("rss", `${num(s.peakRssMiB, 0)} MiB`, perPass(cases, (c) => c.peakProcessRssMiB, 0)),
  ].join("")}</dl></section>`;
  const passes = `<table class="mini passes"><caption>Every pass</caption><thead><tr><th scope="col">${term("pass")}</th><th scope="col">${term("status")}</th>${memory ? "" : `<th scope="col">${term("mount")} <small>ms</small></th>`}<th scope="col">${term("jumps")}</th><th scope="col">${term("elapsed")} <small>s</small></th><th scope="col">${term("rss")} <small>MiB</small></th><th scope="col">${term("outcome")}</th></tr></thead><tbody>${cases
    .map(
      (c) =>
        `<tr><td>${c.round + 1}</td><td>${esc(c.status)}<small>${esc(c.lastStage)}</small></td>${memory ? "" : `<td>${num(c.mount?.visibleMs)}</td>`}<td>${ratio({ passed: c.seeks.filter((x) => x.reached).length, checked: c.seeks.length })}</td><td>${num(c.elapsedMs / 1000)}</td><td>${num(c.peakProcessRssMiB, 0)}</td><td class="outcome"><b>${esc(c.outcome.label)}</b>${c.outcome.detail ? `<small>${esc(c.outcome.detail)}</small>` : ""}</td></tr>`,
    )
    .join("")}</tbody></table>`;
  const errors = [...new Set(cases.flatMap((c) => c.pageErrors))];
  return `<div class="cards"><section class="card"><h4>Checks</h4>${jumps}${checks ? `<dl>${checks}</dl>` : ""}${dynamic}</section>${timingCard}${memoryCard}</div>${passes}${errors.length ? `<div class="errors"><h4>Page errors</h4><ul>${errors.map((e) => `<li><code>${esc(e)}</code></li>`).join("")}</ul></div>` : ""}`;
}

function tally(summaries) {
  const counts = { pass: 0, fail: 0, flaky: 0, error: 0, unsupported: 0 };
  summaries.forEach((s) => s.verdict in counts && counts[s.verdict]++);
  return Object.entries({ pass: "pass", fail: "fail", flaky: "flaky", error: "stopped", unsupported: "unsupported" })
    .filter(([k]) => counts[k])
    .map(([k, word]) => `<span class="tally ${VERDICT[k][0]}">${counts[k]} ${word}</span>`)
    .join("");
}

// One table for one row count, grouped by browser or by library.
function resultTable(cases, ctx, view, count) {
  const browsers = ctx.browsers.filter((b) => cases.some((c) => c.browser === b));
  const engines = ctx.engines.filter((e) => cases.some((c) => c.engine === e));
  const cols = columns(ctx);
  const span = cols.length + 1;
  const cell = (b, e) => {
    const raw = cases.filter((c) => c.browser === b && c.engine === e);
    return { raw, s: summarizeGroup(raw.map(slimCase)) };
  };
  const row = (b, e, label) => {
    const { raw, s } = cell(b, e);
    if (!raw.length) return "";
    const id = `${view}-${ctx.part}-${count}-${b}-${e}`;
    return `<tr class="row"><th scope="row"><button type="button" class="toggle" aria-expanded="false" aria-controls="${id}"><i class="chev" aria-hidden="true"></i>${label}</button></th>${cols.map(([cid, , render]) => `<td${cid === "outcome" ? ' class="outcome"' : ""}>${render(s, raw)}</td>`).join("")}</tr><tr class="detail" id="${id}" hidden><td colspan="${span}"><div class="panel">${details(raw, s, { ...ctx, count })}</div></td></tr>`;
  };
  const libLabel = (e) => `<span class="name"><b>${esc(engineName(e))}</b><small>${esc(engineNote(e))}</small></span>`;
  const browserLabel = (b) => `${swatch(b)}<span class="name"><b>${browserName(b)}</b><small>${esc(ctx.versions[b] ?? "")}</small></span>`;
  const group = (title, summaries, rows) =>
    `<tbody class="grp"><tr class="grp-row"><th colspan="${span}" scope="rowgroup"><button type="button" class="grp-toggle" aria-expanded="true"><i class="chev" aria-hidden="true"></i>${title}<span class="tallies">${tally(summaries)}</span></button></th></tr>${rows}</tbody>`;
  let body;
  if (browsers.length === 1) {
    body = `<tbody>${engines.map((e) => row(browsers[0], e, libLabel(e))).join("")}</tbody>`;
  } else if (view === "library") {
    body = engines
      .map((e) =>
        group(
          `<span class="name"><b>${esc(engineName(e))}</b><small>${esc(engineNote(e))}</small></span>`,
          browsers.map((b) => cell(b, e).s),
          browsers.map((b) => row(b, e, browserLabel(b))).join(""),
        ),
      )
      .join("");
  } else {
    body = browsers
      .map((b) =>
        group(
          browserLabel(b),
          engines.map((e) => cell(b, e).s),
          engines.map((e) => row(b, e, libLabel(e))).join(""),
        ),
      )
      .join("");
  }
  const first = browsers.length > 1 && view === "library" ? "Browser" : "Library";
  return `<div class="scroll"><table class="results"><thead><tr><th scope="col">${first}</th>${cols.map(([id, sub]) => `<th scope="col">${term(id)}${sub ? `<small>${esc(sub)}</small>` : ""}</th>`).join("")}</tr></thead>${body}</table></div>`;
}

// At-a-glance verdicts: libraries × browser × row count.
function overview(cases, ctx) {
  const browsers = ctx.browsers.filter((b) => cases.some((c) => c.browser === b));
  const counts = [...new Set(cases.map((c) => c.count))].sort((a, b) => a - b);
  const engines = ctx.engines.filter((e) => cases.some((c) => c.engine === e));
  const head = `<tr><th rowspan="2" scope="col">Library</th>${browsers.map((b) => `<th colspan="${counts.length}" scope="colgroup" class="bstart">${swatch(b)} ${browserName(b)} <small>${esc(ctx.versions[b] ?? "")}</small></th>`).join("")}</tr><tr>${browsers.map((b) => counts.map((n, i) => `<th scope="col"${i ? "" : ' class="bstart"'}>${fmt(n)}</th>`).join("")).join("")}</tr>`;
  const rows = engines
    .map(
      (e) =>
        `<tr><th scope="row"><span class="name"><b>${esc(engineName(e))}</b><small>${esc(adapterLabel(e).profile)}</small></span></th>${browsers
          .map((b) =>
            counts
              .map((n, i) => {
                const s = summarizeGroup(cases.filter((c) => c.browser === b && c.engine === e && c.count === n).map(slimCase));
                const sub = s.passes && s.verdict !== "unsupported" ? `<small>${s.jumps.passed}/${s.jumps.checked} jumps${s.alignment.checked ? ` · ${s.alignment.passed}/${s.alignment.checked} aligned` : ""}${ctx.memory ? "" : ` · ${s.native.passed}/${s.native.checked} end`}</small>` : "";
                return `<td${i ? "" : ' class="bstart"'}>${pill(s.verdict)}${sub}</td>`;
              })
              .join(""),
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="scroll"><table class="overview"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

function partSection(cases, ctx) {
  const counts = [...new Set(cases.map((c) => c.count))].sort((a, b) => a - b);
  const views = ["browser", "library"]
    .map(
      (view) =>
        `<div class="view view-${view}">${counts.map((n) => `<h3>${fmt(n)} rows</h3>${resultTable(cases.filter((c) => c.count === n), ctx, view, n)}`).join("")}</div>`,
    )
    .join("");
  return `<h3 class="sub">At a glance</h3>${overview(cases, ctx)}${views}`;
}

// What exactly was measured: every adapter's options and why its best-effort
// setup is, or is not, the default one.
function configurations(adapters, engines, dynamic) {
  const rows = engines
    .map((id) => adapters.find((a) => a.id === id) ?? { id })
    .map((a) => {
      const label = adapterLabel(a.id);
      const config = dynamic ? (a.dynamicConfig ?? "Not run with measured heights") : a.config;
      return `<tr><th scope="row"><span class="name"><b>${esc(label.name)}</b><small>${esc(a.id)}</small></span></th><td>${esc(label.profile)}</td><td>${esc(config ?? "Not recorded")}</td><td>${esc(a.bestEffort ?? "Best effort is a separate adapter.")}</td></tr>`;
    })
    .join("");
  return `<section><h2>Configurations measured</h2><p>Results depend on how each library is set up. <b>Default</b> is the minimal documented setup; <b>best effort</b> is the strongest documented setup for this workload, including integration code. Compare best-effort rows to see what a library can do; compare default rows to see what it does out of the box.</p><div class="scroll"><table class="raw configs"><thead><tr><th>Library · adapter</th><th>${term("profile")}</th><th>Options</th><th>Best effort</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function reportHtml(reports, suite, metadata = reports[0] ?? {}) {
  const environment = [
    ...machineLines(metadata.host),
    ...executionDetails(metadata.execution),
  ].map(esc).join("<br>");
  const runUrl = githubRunUrl(metadata.execution);
  const all = reports.flatMap((r) =>
    r.cases.map((c) => ({
      ...c,
      suite: c.suite ?? r.config.suite,
      browser: c.browser ?? r.browser,
    })),
  );
  const names = [...new Set(all.map((c) => c.browser))];
  const versions = Object.fromEntries(
    names.map((b) => [b, all.find((c) => c.browser === b && c.browserVersion)?.browserVersion ?? ""]),
  );
  const rowMode = reports[0]?.config?.rowMode ?? "fixed";
  const dynamic = rowMode === "dynamic";
  const engines = [
    ...ADAPTERS.map((a) => a.id).filter((id) => all.some((c) => c.engine === id)),
    ...new Set(all.map((c) => c.engine).filter((id) => !ADAPTERS.some((a) => a.id === id))),
  ];
  const libraries = new Set(engines.map(engineOf)).size;
  const base = { browsers: names, versions, engines, dynamic };
  const timingCases = all.filter((c) => c.suite !== "memory");
  const memoryCases = all.filter((c) => c.suite === "memory");
  const withoutHeap = names.filter((b) => !memoryCases.some((c) => c.browser === b));
  const heapNotes = withoutHeap
    .map((b) =>
      b !== "chromium"
        ? `${browserName(b)}: JS heap and backing storage are unavailable through this runner in this browser. Process RSS is not heap memory.`
        : suite === "all"
          ? "Chromium: heap pass pending; this report is updated after each phase."
          : "Chromium: heap was not requested. Use the default all suite to include separate heap passes.",
    )
    .map((t) => `<p class="note">${esc(t)}</p>`)
    .join("");
  const sections = [
    timingCases.length &&
      `<section><h2>Checks &amp; timing <small>${new Set(timingCases.map((c) => c.browser)).size} browser${new Set(timingCases.map((c) => c.browser)).size === 1 ? "" : "s"}</small></h2><p>Row jumps, jump alignment, native end, broken frames while scrolling, wheel, resize, basic keyboard input, mount time and supported long-task observations. Compare timings within one browser and size.</p>${partSection(timingCases, { ...base, part: "perf", memory: false })}</section>`,
    (memoryCases.length || heapNotes) &&
      `<section><h2>Heap memory · separate passes <small>Chromium CDP</small></h2><p>Baseline-subtracted medians after forced GC. Negative deltas can reflect reclaimed baseline allocations; residual heap alone does not establish a leak.</p>${heapNotes}${memoryCases.length ? partSection(memoryCases, { ...base, part: "mem", memory: true }) : ""}</section>`,
    configurations(
      reports[0]?.adapters ??
        engines.map((id) => ({ ...ADAPTERS.find((a) => a.id === id), id })),
      engines,
      dynamic,
    ),
  ]
    .filter(Boolean)
    .join("");
  const rawRows = all.map((c) => [
    esc(c.browser),
    esc(c.suite),
    `${esc(engineName(c.engine))}<small>${esc(c.engine)}</small>`,
    fmt(c.count),
    c.round + 1,
    esc(c.status),
    esc(c.lastStage),
    esc(c.reason ?? c.error ?? c.errors?.join("; ") ?? ""),
    ...(dynamic
      ? [esc((c.dynamicChecks ?? []).map((x) => `${x.name}: ${x.passed ? "passed" : "failed"}; geometry ${x.heightChecks ? "valid" : "invalid"}; anchor ${x.anchorVisible ? "visible" : "lost"}; drift ${num(x.anchorDriftPx)}px`).join(" | "))]
      : []),
    num(c.elapsedMs, 0),
  ]);
  const rawHead = ["Browser", "Suite", "Library · adapter", "Rows", "Pass", "Execution", "Last stage", "Error", ...(dynamic ? ["Height changes"] : []), "Elapsed ms"];
  const glossaryIds = [
    "verdict", "profile", "finished", "jumps", "aligned", "native", "mount", "commit", "invalidFrames", "peakMounted", "wheel", "pageDown", "resize", "longTasks", "rss",
    "heapMounted", "heapRetained", "heapUnmount", "heapMax", "backing", "dynamic", "outcome", "status", "elapsed", "pass",
  ];
  const glossary = glossaryIds
    .map((id) => {
      const m = MEASURES[id];
      return `<div class="gl" id="m-${id}"><dt>${esc(m.label)}${m.unit ? `<small> · ${esc(m.unit)}</small>` : ""}${m.better ? `<small> · ${esc(m.better)} is better</small>` : ""}</dt><dd><p>${esc(m.what)}</p><p>${esc(m.how)}</p></dd></div>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>Scroll benchmark report</title><style>${CSS}</style>
<input type="radio" name="group" id="by-browser" class="sr" checked><input type="radio" name="group" id="by-library" class="sr">
<main>
<div class="badge">${esc(executionLabel(metadata.execution).toUpperCase())} · ${esc(suite.toUpperCase())}</div>
<h1>Scrolling checks, timing &amp; memory</h1>
<p class="lead"><b>Row mode: ${esc(rowMode)}</b>. ${esc(reports[0]?.config?.rowScenario ?? "Fixed 48px rows.")} ${all.length} recorded passes across ${names.length} browser engine${names.length === 1 ? "" : "s"} and ${engines.length} configurations of ${libraries} libraries; each pass runs in a fresh headless browser. A result describes one ${term("profile", "configuration")}, not the library in general. Unsupported configurations are not executed and are not failures. Rows are generated from their index; no full 100M-record dataset is loaded.${dynamic ? "" : ` ${term("dynamic", "Height-change checks")} run only with <code>--row-mode dynamic</code>, so they are not part of this report.`}</p>
<p class="note"><b>${esc(executionLabel(metadata.execution))}</b><br>${environment}${runUrl ? `<br><a href="${esc(runUrl)}">View GitHub workflow run ↗</a>` : ""}<br><small>Recorded at execution time. Compare timings on the same hardware and browser.</small></p>
<nav>${reports.map((r) => `<a href="${esc(r.file)}">${esc(String(r.file).replace(".json", ""))} JSON ↓</a>`).join("")}</nav>
<div class="legend">${pill("pass")} every check passed ${pill("fail")} a check failed in every pass ${pill("flaky")} passes disagree ${pill("error")} a pass stopped early (error, crash, timeout or memory budget) ${pill("unsupported")} not run ${tip("verdict")}<span>— means unavailable, never zero</span></div>
<div class="toolbar" role="group" aria-label="Report view"><span class="label">Group by</span><span class="seg"><label for="by-browser">Browser<small>libraries inside</small></label><label for="by-library">Library<small>browsers inside</small></label></span><span class="spacer"></span><button type="button" data-expand="all">Expand all</button><button type="button" data-expand="none">Collapse all</button></div>
<p class="hint">Click a row for every pass and check. Hover or focus any <span class="tip demo" aria-hidden="true">?</span> for what a measurement means and how it was taken.</p>
${sections}
<section><h2>What each measurement means</h2><dl class="glossary">${glossary}</dl></section>
<details><summary>Individual passes, errors and stopping stages (${all.length})</summary><div class="scroll"><table class="raw"><thead><tr>${rawHead.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rawRows.map((row) => `<tr>${row.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>
<details><summary>How to interpret the measurements</summary><p>Mount latency is DOM visibility, not physical paint, and is measured in whole animation frames. Timing medians use completed passes. Frame intervals are not reported: with a few rows of work per frame they only show the display refresh rate. Partial checks and memory samples survive resource stops. Memory peak means largest observed stage sample, not a continuous peak. Backing storage includes array buffers and external strings and is reported separately.</p><p>RSS sums worker and browser processes, including shared pages more than once. It is not unique memory or JS heap. Every case has a 25-second deadline and 2048 MiB sampled RSS budget; memory passes additionally cap V8 old space at 1024 MiB. Budget stops do not establish intrinsic library limits.</p><p>900px list width, 360px viewport. Buffering and data structures vary by library. Compare within a browser and size. Playwright WebKit is not branded Safari. This workload does not measure application sorting/filtering, network loading, full accessibility, GPU memory, or exact CPU/input latency.</p></details>
</main>
<script>${SCRIPT}</script></html>`;
}

const CSS = `
:root{--ink:#243247;--muted:#5d6b7d;--line:#d9dfe6;--blue:#245bc3;--mono:ui-monospace,SFMono-Regular,Consolas,monospace;color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:#faf9f6;color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Arial,sans-serif}
main{max-width:1320px;margin:auto;padding:36px 24px 60px}h1{font-size:32px;margin:10px 0}h2{font-size:22px;margin:0 0 6px}h2 small{font-size:12px;font-weight:400;color:var(--muted);margin-left:6px}
h3{font-size:15px;margin:26px 0 10px}h3.sub{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted)}small{font-size:11px;font-weight:400;color:var(--muted)}
p{max-width:980px}.lead{line-height:1.65}section{border-top:1px solid #ced5dd;margin-top:34px;padding-top:20px}a{color:var(--blue)}code{background:#eceef1;padding:1px 4px;border-radius:3px;font:12px var(--mono)}
nav{display:flex;gap:16px;flex-wrap:wrap;font-size:13px}.badge{font:11px var(--mono);letter-spacing:1px;color:var(--muted)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.note{padding:10px 14px;background:#eeece7;border-radius:6px;font-size:13px}.hint{font-size:13px;color:var(--muted)}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:18px 0 8px;font-size:12px;color:var(--muted)}.legend>span:last-child{margin-left:8px}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font:11px var(--mono);white-space:nowrap}.pill.good{background:#e4f2ea;color:#216243}.pill.bad{background:#fbe8e3;color:#a4422d}.pill.warn{background:#fbf0d4;color:#7d5300}.pill.mixed{background:#ece6f7;color:#5b3d8f}.pill.none{background:#eef1f4;color:var(--muted)}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;margin:14px -24px 0;padding:10px 24px;background:rgb(250 249 246/.94);backdrop-filter:blur(4px);border-bottom:1px solid var(--line)}
.toolbar .label{font:11px var(--mono);letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}.toolbar .spacer{flex:1}
.seg{display:inline-flex;border:1px solid #c5cedb;border-radius:6px;overflow:hidden;background:#fff}.seg label{padding:6px 14px;font-size:13px;cursor:pointer}.seg label+label{border-left:1px solid #c5cedb}.seg small{display:block;font:10px var(--mono)}
#by-browser:checked~main label[for=by-browser],#by-library:checked~main label[for=by-library]{background:#e8effc;color:#173f8c;box-shadow:inset 0 -2px 0 var(--blue)}
#by-browser:focus-visible~main label[for=by-browser],#by-library:focus-visible~main label[for=by-library]{outline:2px solid var(--blue);outline-offset:-2px}
#by-browser:checked~main .view-library,#by-library:checked~main .view-browser{display:none}
button{font:inherit;font-size:12px;color:inherit;background:#fff;border:1px solid #c5cedb;border-radius:5px;padding:6px 12px;cursor:pointer}button:hover{border-color:var(--blue)}
button:focus-visible,summary:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.scroll{position:relative;overflow:auto;border:1px solid #c8d0db;border-radius:6px;background:#fff}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:10px 8px;text-align:left;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums;vertical-align:top}
thead th{background:#edf0f3;font-weight:500;font-size:11px;vertical-align:bottom;white-space:nowrap}thead th small{display:block;margin-top:2px}
.results{min-width:980px}.results>tbody>tr>td{font-family:var(--mono)}.results>tbody>tr>th{font-weight:400;min-width:175px}
.results td.outcome{font-family:inherit;min-width:200px;max-width:280px;white-space:normal}.outcome small.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.outcome small.more{color:var(--blue)}.outcome b{display:block;font-weight:600}.outcome small{display:block;margin-top:3px;overflow-wrap:anywhere}
.ratio.bad{color:#a4422d;font-weight:700}.ratio.none{color:var(--muted)}small.stop{display:block;color:#a25634}
.toggle,.grp-toggle{display:flex;align-items:flex-start;gap:9px;width:100%;padding:0;border:0;background:none;text-align:left;font-size:12px}
.grp-row th{padding:0;background:#f4f6f9}.grp-toggle{align-items:center;flex-wrap:wrap;padding:10px 12px;gap:8px 12px}.grp-toggle:hover{background:#edf1f6}
.tallies{display:inline-flex;gap:6px;margin-left:auto}.tally{padding:2px 8px;border-radius:999px;font:10px var(--mono)}.tally.good{background:#e4f2ea;color:#216243}.tally.bad{background:#fbe8e3;color:#a4422d}.tally.warn{background:#fbf0d4;color:#7d5300}.tally.mixed{background:#ece6f7;color:#5b3d8f}.tally.none{background:#eef1f4;color:var(--muted)}
.grp.is-collapsed>tr:not(.grp-row){display:none}
.name{display:inline-flex;flex-direction:column}.name b{font-weight:600;font-size:13px}.name small{margin-top:2px}
.swatch{display:inline-block;flex-shrink:0;width:9px;height:9px;margin-top:4px;border-radius:2px;background:var(--c)}
.chev{display:inline-block;flex-shrink:0;width:0;height:0;margin-top:5px;border-block:4px solid transparent;border-left:6px solid #6b7b90;transition:transform .12s}
.grp-toggle .chev{margin-top:0}[aria-expanded=true]>.chev{transform:rotate(90deg)}
.row{cursor:pointer}.row:hover>*{background:#f7f9fc}.row.is-open>*{background:#eef4ff;border-bottom-color:transparent}
.detail>td{padding:0;background:#f8fafc;font-family:inherit}.panel{position:sticky;left:0;width:var(--scroller-w,100%);padding:14px 16px 18px;border-left:3px solid var(--blue)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px;align-items:start;margin-bottom:12px}
.card{padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:6px}.card h4,.errors h4{margin:0 0 8px;font:10px var(--mono);letter-spacing:.5px;text-transform:uppercase;color:var(--muted)}
dl{margin:0}.metric{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 0;border-top:1px solid #edf0f3}.metric:first-child{border-top:0}
.metric dt{font-size:12px}.metric dd{margin:0;font:12px var(--mono);text-align:right}.metric dd small{display:block;font-size:10px}
.marks{display:inline-flex;gap:4px}.mark{display:inline-flex;flex-direction:column;align-items:center;font-weight:700}.marks .mark{min-width:16px;padding:1px 3px;border-radius:4px;background:#f3f5f8}
.mark.good{color:#216243}.mark.bad{color:#a4422d}.mark.none{color:#9aa6b4}.mark small{font:9px var(--mono)}
.mini{margin:2px 0 10px;font-size:11px}.mini caption{text-align:left;padding-bottom:6px;font-size:12px}.mini th,.mini td{padding:5px 6px;border-bottom:1px solid #edf0f3;text-align:center;background:none;font-weight:400}
.mini thead th{font-size:10px;color:var(--muted)}.mini tbody th,.mini thead th:first-child{text-align:left;white-space:nowrap}.mini tbody th small{margin-left:4px}
.passes{background:#fff;border:1px solid var(--line);border-radius:6px}.passes th,.passes td{text-align:left;padding:7px 9px}.passes td{font:11px var(--mono)}.passes td small{display:block;margin-top:2px}.passes td.outcome{font-family:inherit;white-space:normal}
.errors ul{margin:0;padding-left:18px;font-size:11px}.errors code{overflow-wrap:anywhere}.unsupported{margin:0;font-size:13px}
.overview{min-width:640px}.overview td,.overview thead th{text-align:center}.overview tbody th{font-weight:500;white-space:nowrap}.overview td small{display:block;margin-top:4px;font:10px var(--mono)}.overview .bstart{border-left:1px solid var(--line)}
.term{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.tip{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:15px;height:15px;padding:0;border:1px solid #b4bfcd;border-radius:50%;background:#fff;color:#536783;font:700 9px/1 Arial,sans-serif;cursor:help;vertical-align:middle}
.tip:hover,.tip[aria-expanded=true]{border-color:var(--blue);color:var(--blue)}.tip.demo{cursor:default}
.tip-pop{position:fixed;z-index:20;width:max-content;max-width:min(340px,calc(100vw - 16px));padding:11px 13px 12px;background:#1f2b3a;color:#dbe2ea;border-radius:7px;box-shadow:0 10px 28px rgb(16 27 41/24%);font:12px/1.55 system-ui,Arial,sans-serif;pointer-events:none}
.tip-pop dt{color:#fff;font-weight:700;font-size:13px}.tip-pop small{color:#aebbcb}.tip-pop dd{margin:0}.tip-pop p{margin:6px 0 0}.tip-pop b{color:#fff}
.glossary{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}.gl{padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:6px}.gl dt{font-weight:600}.gl dd{margin:0}.gl p{margin:6px 0 0;font-size:13px;line-height:1.55;color:#46556a}
details{margin:22px 0}summary{cursor:pointer;font-weight:600}.raw{min-width:900px}.raw small{display:block}.configs td{white-space:normal;max-width:420px}
@media (max-width:650px){main{padding:24px 16px 40px}.toolbar{margin:14px -16px 0;padding:10px 16px}.tallies{margin-left:0}.cards,.glossary{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.chev{transition:none}}
@media print{.toolbar,.tip{display:none}.detail[hidden]{display:table-row}}
`;

// Tooltips, expandable rows and groups. No dependencies; ~1 KB.
const SCRIPT = `(() => {
  const pop = document.createElement("div");
  pop.className = "tip-pop"; pop.hidden = true; pop.setAttribute("aria-hidden", "true");
  document.body.append(pop);
  let current = null, pointer = null;
  const place = () => {
    if (!current) return;
    const r = current.getBoundingClientRect(), p = pop.getBoundingClientRect(), g = 8;
    const below = r.bottom + g + p.height <= innerHeight;
    pop.style.top = (below ? r.bottom + g : Math.max(g, r.top - g - p.height)) + "px";
    pop.style.left = Math.min(Math.max(g, r.left + r.width / 2 - p.width / 2), innerWidth - p.width - g) + "px";
  };
  const show = (b) => {
    if (current && current !== b) hide();
    const src = document.getElementById(b.getAttribute("aria-describedby"));
    pop.innerHTML = src ? src.innerHTML : "";
    pop.hidden = false; current = b; b.setAttribute("aria-expanded", "true"); place();
  };
  const hide = () => { pop.hidden = true; current?.setAttribute("aria-expanded", "false"); current = null; };
  document.addEventListener("pointerdown", (e) => { pointer = e.pointerType; if (current && !e.target.closest(".tip")) hide(); });
  document.addEventListener("pointerover", (e) => { const b = e.target.closest("button.tip"); if (b && e.pointerType === "mouse") show(b); });
  document.addEventListener("pointerout", (e) => { const b = e.target.closest("button.tip"); if (b && e.pointerType === "mouse" && !b.contains(e.relatedTarget)) hide(); });
  document.addEventListener("focusin", (e) => { const b = e.target.closest("button.tip"); if (b && b.matches(":focus-visible")) show(b); });
  document.addEventListener("focusout", (e) => { if (e.target.closest("button.tip")) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  addEventListener("scroll", place, true); addEventListener("resize", place);
  const setRow = (button, open) => {
    button.setAttribute("aria-expanded", String(open));
    button.closest("tr").classList.toggle("is-open", open);
    document.getElementById(button.getAttribute("aria-controls")).hidden = !open;
  };
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button.tip");
    if (t) { e.stopPropagation(); if (pointer !== "mouse") current === t ? hide() : show(t); pointer = null; return; }
    const all = e.target.closest("[data-expand]");
    if (all) {
      const open = all.dataset.expand === "all";
      document.querySelectorAll(".toggle").forEach((b) => setRow(b, open));
      if (open) document.querySelectorAll(".grp.is-collapsed").forEach((g) => { g.classList.remove("is-collapsed"); g.querySelector(".grp-toggle").setAttribute("aria-expanded", "true"); });
      return;
    }
    const grp = e.target.closest(".grp-toggle");
    if (grp) { const open = grp.getAttribute("aria-expanded") !== "true"; grp.setAttribute("aria-expanded", String(open)); grp.closest("tbody").classList.toggle("is-collapsed", !open); return; }
    const row = e.target.closest("tr.row");
    if (row && !e.target.closest("a")) { const b = row.querySelector(".toggle"); setRow(b, b.getAttribute("aria-expanded") !== "true"); }
  });
  const sync = (el) => el.style.setProperty("--scroller-w", el.clientWidth + "px");
  const ro = new ResizeObserver((entries) => entries.forEach((x) => sync(x.target)));
  document.querySelectorAll(".scroll").forEach((el) => { sync(el); ro.observe(el); });
})();`;
