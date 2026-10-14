import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readRun } from "./bench-publish.mjs";
import { summarizeGroup } from "../src/bench-results.mjs";
import { adapterLabel } from "../src/engines.mjs";
import { executionLabel, executionDetails, machineLines, githubRunUrl } from "../src/run-environment.mjs";

const cell = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll("|", "&#124;").replace(/[\r\n]+/g, " ")
  .replace(/([\\`*_\[\]])/g, "\\$1");
const verdicts = { pass: "Passed", fail: "Checks failed", flaky: "Flaky", error: "Stopped / error", unsupported: "Unsupported (not run)", none: "Not recorded" };

export function summaryMarkdown(run) {
  const runUrl = githubRunUrl(run.execution);
  const lines = [
    `## ${cell(executionLabel(run.execution))} · ${cell(run.config.rowMode)} heights`, "",
    ...machineLines(run.host).map((line) => `${cell(line)}  `),
    ...executionDetails(run.execution).map((line) => `${cell(line)}  `), "",
    run.browsers.map((browser) => `${cell(browser.name)} ${cell(browser.version ?? "version not recorded")}`).join(" · "), "",
    ...(runUrl ? [`[View GitHub workflow run](${runUrl})`, ""] : []),
    `Recorded ${run.cases.length}${run.expectedCases ? ` / ${run.expectedCases}` : ""} cases. ${run.complete ? "Matrix complete." : "Partial matrix."}`, "",
    "A successful workflow means the benchmark completed, not that every library passed. See individual outcomes below; resource stops are not intrinsic library limits.", "",
    "| Browser | Rows | Library | Configuration | Result | Finished | Detail |",
    "| --- | ---: | --- | --- | --- | ---: | --- |",
  ];
  for (const browser of run.options.browsers)
    for (const count of run.options.counts)
      for (const engine of run.options.engines) {
        // Keep performance and forced-GC memory passes separate.
        const matching = run.cases.filter((c) => c.browser === browser && c.count === count && c.engine === engine);
        const phases = [...new Set(matching.map((c) => c.suite))];
        for (const phase of phases.length ? phases : [run.suite]) {
          const s = summarizeGroup(matching.filter((c) => c.suite === phase));
          const { name, profile } = adapterLabel(engine);
          lines.push(`| ${cell(browser)} (${cell(phase)}) | ${count.toLocaleString("en-US")} | ${cell(name)} | ${cell(profile)} | ${verdicts[s.verdict]}${s.verdict === "flaky" ? ` (${s.failedPasses}/${s.completed} failed)` : ""} | ${s.completed}/${matching.filter((c) => c.suite === phase).length} | ${cell(s.details.join("; ").slice(0, 500))} |`);
        }
      }
  lines.push("", "Download the job artifact for the full HTML report, raw JSON and run metadata.", "");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(process.argv[2] ?? "output/bench");
  const dirs = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
  const summaries = dirs.map((d) => {
    try { return summaryMarkdown(readRun(path.join(root, d.name))); }
    catch (error) { return `## Benchmark incomplete\n\n${cell(error.message)}\n`; }
  });
  const text = summaries.join("\n") || "## Benchmark\n\nNo case data was produced. Check the setup and benchmark step logs.\n";
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else console.log(text);
}
