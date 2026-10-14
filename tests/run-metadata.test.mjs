import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { captureExecution, captureRunMetadata } from "../scripts/run-metadata.mjs";
import { executionLabel, executionDetails, machineLines, githubRunUrl } from "../src/run-environment.mjs";
import { buildPublishedRun, manifestEntry } from "../src/bench-results.mjs";
import { reportHtml } from "../scripts/bench-report.mjs";
import { summaryMarkdown } from "../scripts/bench-ci-summary.mjs";

const github = captureExecution({
  GITHUB_ACTIONS: "true", CI: "false", GITHUB_REPOSITORY: "example/scroll-bench",
  GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
  GITHUB_WORKFLOW: "Scroll benchmarks", GITHUB_JOB: "benchmark", GITHUB_SHA: "abc123",
  RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", RUNNER_ARCH: "X64",
  GITHUB_TOKEN: "do-not-copy", GITHUB_ACTOR: "private-user", RUNNER_NAME: "private-host",
});
const host = { platform: "Linux test x64", cpu: "Test CPU", cores: 4, memoryGiB: 16, node: "v22.0.0" };
const report = {
  browser: "chromium", file: "chromium-performance.json",
  startedAt: "2026-10-13", completedAt: "2026-10-13",
  config: { suite: "performance", rowMode: "fixed", counts: [1000], repetitions: 1 },
  cases: [{ engine: "vit", count: 1000, round: 0, browser: "chromium", suite: "performance", status: "completed", seeks: [{ reached: true }], errors: [] }],
};

test("origin distinguishes GitHub, other CI and local without retaining private env", () => {
  assert.equal(executionLabel(github), "GitHub Actions CI");
  assert.equal(githubRunUrl(github), "https://github.com/example/scroll-bench/actions/runs/123");
  assert.equal(github.runnerEnvironment, "github-hosted");
  assert(!JSON.stringify(github).includes("private-"));
  assert(!JSON.stringify(github).includes("do-not-copy"));
  assert.equal(executionLabel(captureExecution({ CI: "true" })), "Other CI");
  for (const CI of [undefined, "", " ", "0", "false", "FALSE", "no"])
    assert.equal(executionLabel(captureExecution({ CI, GITHUB_ACTIONS: "false" })), "Local machine");
  assert.match(executionDetails({ ...github, runnerEnvironment: "self-hosted" }).join(), /self-hosted/);
  assert.equal(githubRunUrl({ ...github, serverUrl: "javascript:alert(1)" }), null);
  assert.equal(githubRunUrl({ ...github, serverUrl: "https://user:secret@github.com" }), null);
  assert.equal(githubRunUrl({ ...github, repository: "x/y/../../bad" }), null);
  assert.equal(githubRunUrl({ ...github, serverUrl: "https://github.example.org" }), "https://github.example.org/example/scroll-bench/actions/runs/123");
});

test("machine specifications are captured from the executing OS", () => {
  const { host } = captureRunMetadata();
  assert.equal(host.memoryBytes, os.totalmem());
  assert.equal(host.arch, os.arch());
  assert.equal(host.cores, os.cpus().length);
  assert.equal(host.node, process.version);
  assert.ok(host.availableParallelism > 0);
  assert.match(machineLines(host).join(), /logical cores/);
});

test("publication preserves original CI metadata and never invents legacy provenance", () => {
  const run = buildPublishedRun({ id: "ci", meta: { execution: github, host }, reports: [report] });
  assert.deepEqual(run.execution, github);
  assert.deepEqual(run.host, host);
  assert.equal(manifestEntry(run).execution.provider, "github-actions");
  const standalone = buildPublishedRun({ id: "raw", reports: [{ ...report, execution: github, host }] });
  assert.deepEqual(standalone.execution, github);
  assert.deepEqual(standalone.host, host);
  const legacy = buildPublishedRun({ id: "old", meta: { host }, reports: [report] });
  assert.equal(executionLabel(legacy.execution), "Origin not recorded");
  assert.deepEqual(legacy.host, host);
  assert.equal(buildPublishedRun({ id: "unknown", reports: [report] }).host, null);
});

test("HTML and job summaries distinguish environments and keep machine specs", () => {
  const html = reportHtml([report], "performance", { execution: github, host });
  assert.match(html, /GitHub Actions CI/);
  assert.match(html, /4 logical cores · 16 GiB RAM/);
  assert.match(html, /Linux test x64 · Node v22.0.0/);
  assert.match(html, /https:\/\/github.com\/example\/scroll-bench\/actions\/runs\/123/);
  assert(!html.includes("LOCAL MEASUREMENTS"));
  assert.match(reportHtml([report], "performance"), /Origin not recorded/);
  assert.match(reportHtml([report], "performance", { execution: { kind: "local" }, host }), /Local machine/);
  const unsafe = reportHtml([report], "performance", { execution: github, host: { cpu: "<script>bad()</script>" } });
  assert(!unsafe.includes("<script>bad()"));
  assert.match(unsafe, /&lt;script&gt;bad/);
  const run = buildPublishedRun({ id: "ci", meta: { execution: github, host }, reports: [report] });
  const summary = summaryMarkdown(run);
  assert.match(summary, /GitHub Actions CI/);
  assert.match(summary, /Test CPU/);
  assert.match(summary, /Passed/);
  assert.match(summary, /not that every library passed/);
});

test("job summary does not hide failed checks, resource stops or unsupported modes", () => {
  const cases = [
    report.cases[0],
    { ...report.cases[0], engine: "window", seeks: [{ index: 999, reached: false }] },
    { ...report.cases[0], engine: "rc", status: "timeout", lastStage: "mount", reason: "25 second deadline" },
    { ...report.cases[0], engine: "ag", status: "unsupported", reason: "Dynamic heights unsupported" },
  ];
  const run = buildPublishedRun({ id: "mixed", reports: [{ ...report, cases }] });
  const summary = summaryMarkdown(run);
  for (const outcome of ["Passed", "Checks failed", "Stopped / error", "Unsupported (not run)"])
    assert.ok(summary.includes(outcome), outcome);
  assert.match(summary, /Origin not recorded/);
  assert.match(summary, /Machine specifications not recorded/);
});
