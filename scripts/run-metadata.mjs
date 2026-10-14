import os from "node:os";

const enabled = (value) => !!value?.trim() && !/^(false|0|no)$/i.test(value.trim());

// Record an allowlist only: no usernames, hostnames, paths, tokens or full env dump.
export function captureExecution(env = process.env) {
  if (env.GITHUB_ACTIONS === "true") {
    return {
      kind: "ci",
      provider: "github-actions",
      runnerEnvironment: env.RUNNER_ENVIRONMENT || null,
      runnerOS: env.RUNNER_OS || null,
      runnerArch: env.RUNNER_ARCH || null,
      imageOS: env.ImageOS || null,
      imageVersion: env.ImageVersion || null,
      workflow: env.GITHUB_WORKFLOW || null,
      job: env.GITHUB_JOB || null,
      repository: env.GITHUB_REPOSITORY || null,
      serverUrl: env.GITHUB_SERVER_URL || "https://github.com",
      runId: env.GITHUB_RUN_ID || null,
      runAttempt: env.GITHUB_RUN_ATTEMPT || null,
      event: env.GITHUB_EVENT_NAME || null,
      ref: env.GITHUB_REF || null,
      commit: env.GITHUB_SHA || null,
    };
  }
  return { kind: enabled(env.CI) ? "ci" : "local", provider: null };
}

export function captureRunMetadata() {
  const cpus = os.cpus();
  const memoryBytes = os.totalmem();
  return {
    execution: captureExecution(),
    host: {
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      os: os.type(),
      release: os.release(),
      arch: os.arch(),
      cpu: cpus[0]?.model ?? null,
      cores: cpus.length,
      availableParallelism: os.availableParallelism(),
      memoryBytes,
      memoryGiB: Math.round(memoryBytes / 2 ** 30 * 100) / 100,
      constrainedMemoryBytes: process.constrainedMemory?.() || null,
      node: process.version,
    },
  };
}
