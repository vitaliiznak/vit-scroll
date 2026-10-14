// Shared presentation for the results page, saved HTML and GitHub job summary.
// Missing provenance in old files stays unknown; never infer it at publish time.
export function executionLabel(execution) {
  if (execution?.kind === "ci")
    return execution.provider === "github-actions" ? "GitHub Actions CI" : "Other CI";
  return execution?.kind === "local" ? "Local machine" : "Origin not recorded";
}

export function machineLines(host) {
  if (!host) return ["Machine specifications not recorded"];
  return [
    [host.cpu || "CPU not recorded", host.cores != null && `${host.cores} logical cores`, host.memoryGiB != null && `${host.memoryGiB} GiB RAM`].filter(Boolean).join(" · "),
    [host.platform || "OS not recorded", host.node && `Node ${host.node}`].filter(Boolean).join(" · "),
    host.constrainedMemoryBytes && `Process memory limit: ${(host.constrainedMemoryBytes / 2 ** 30).toFixed(2)} GiB`,
  ].filter(Boolean);
}

export function executionDetails(execution) {
  if (execution?.provider !== "github-actions") return [];
  return [
    [execution.runnerEnvironment, execution.runnerOS, execution.runnerArch, execution.imageOS, execution.imageVersion].filter(Boolean).join(" · "),
    [execution.workflow, execution.job, execution.runAttempt && `attempt ${execution.runAttempt}`].filter(Boolean).join(" · "),
    execution.commit && `Commit ${execution.commit}`,
  ].filter(Boolean);
}

export function githubRunUrl(execution) {
  if (execution?.provider !== "github-actions" ||
      !/^[\w.-]+\/[\w.-]+$/.test(execution.repository ?? "") ||
      !/^\d+$/.test(execution.runId ?? "")) return null;
  try {
    const server = new URL(execution.serverUrl);
    if (server.protocol !== "https:" || server.username || server.password ||
        server.pathname !== "/" || server.search || server.hash) return null;
    return `${server.origin}/${execution.repository}/actions/runs/${execution.runId}`;
  } catch { return null; }
}
