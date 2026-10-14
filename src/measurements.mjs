export const MIB = 1024 * 1024;
export const mib = (bytes) => bytes == null ? "—" : (bytes / MIB).toFixed(1);

export const firstLine = (text) =>
  text ? String(text).split("\n")[0].slice(0, 240) : null;

// Production React only prints an error number; name the common one.
export function explainError(text) {
  const line = firstLine(text);
  const react = line?.match(/Minified React error #(\d+)/);
  if (!react) return line;
  return react[1] === "185"
    ? "React #185: maximum update depth exceeded"
    : `React error #${react[1]}`;
}

export function caseOutcome(run) {
  if (run.status === "unsupported") return { label: "Unsupported configuration", detail: run.reason ?? "This adapter does not support the scenario." };
  if (run.status && run.status !== "completed") {
    const labels = {
      "resource-budget": "Memory budget reached",
      timeout: "Time limit reached",
      "renderer-crash": "Browser renderer crashed",
      "worker-exit": "Worker exited",
      error: "Error",
      stopped: "Stopped",
    };
    // Supervisor-triggered shutdown errors are browser logs, not the cause.
    // An uncaught page error comes first: the harness error usually follows from it.
    const error = ["error", "stopped"].includes(run.status)
      ? [explainError(run.errors?.[0]), firstLine(run.error)?.slice(0, 220)].filter(Boolean).join(" → ") || null
      : null;
    const elapsed = run.stop?.elapsedMs ?? run.elapsedMs;
    return {
      label: labels[run.status] ?? run.status,
      detail: `${run.lastStage ?? "unknown stage"}${Number.isFinite(elapsed) ? ` · ${(elapsed / 1000).toFixed(1)}s` : ""}${error ? ` · ${error}` : ""}`,
    };
  }
  const failed = run.seeks?.find((s) => !s.reached);
  const native = run.nativeEnd ?? run.nativeBottom;
  const problems = [];
  const dynamicFailed = run.dynamicChecks?.filter((c) => !c.passed) ?? [];
  if (dynamicFailed.length) problems.push(`Dynamic checks failed: ${dynamicFailed.map((c) => `${c.name} (${[!c.heightChecks && "height/geometry", !c.anchorVisible && "anchor left viewport"].filter(Boolean).join(", ") || "did not settle"})`).join("; ")}`);
  if (run.errors?.length) problems.push(`Runtime error: ${explainError(run.errors[0]).slice(0, 220)}`);
  if (failed) problems.push(`First failed jump: row ${((failed.index ?? failed.target) + 1).toLocaleString("en-US")}`);
  const misaligned = run.seeks?.find((s) => s.aligned === false);
  if (misaligned) problems.push(`Jump to row ${(misaligned.index + 1).toLocaleString("en-US")} landed ${Number.isFinite(misaligned.alignErrorPx) ? `${Math.abs(misaligned.alignErrorPx).toFixed(1)} px ${misaligned.alignErrorPx > 0 ? "below" : "above"}` : "away from"} its requested position`);
  if (native && !native.lastRowVisible) problems.push(`Native end${Number.isFinite(native.last) ? ` stopped at row ${(native.last + 1).toLocaleString("en-US")}` : " failed"}`);
  const invalidFrames = (run.scroll ?? run.pacing)?.invalidFrames?.length;
  if (invalidFrames) problems.push(`${invalidFrames} frames with blanks, gaps or overlaps`);
  if (problems.length) return { label: "Checks failed", detail: problems.join(" · ") };
  return { label: "Checks passed", detail: "" };
}

// Diagnostic fallback for the manual page. CDP/RSS in the isolated suite is
// the comparable measurement; performance.memory can be rounded or shared.
export function readPageHeap() {
  const memory = globalThis.performance?.memory;
  if (!Number.isFinite(memory?.usedJSHeapSize)) return null;
  return {
    usedSize: memory.usedJSHeapSize,
    totalSize: memory.totalJSHeapSize,
    heapLimit: memory.jsHeapSizeLimit,
  };
}
