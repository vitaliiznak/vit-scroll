import { mib } from "./measurements.mjs";

export const HEAP_WARNING_RATIO = 0.8;
export const HEAP_STOP_RATIO = 0.9;
export const LITE_DEADLINE_MS = 25_000;

// This is the approximate page heap, including previous mounts awaiting GC.
// It is neither process RSS nor a per-library allocation measurement.
export function heapPressure(heap) {
  if (!Number.isFinite(heap?.usedSize) || heap.usedSize < 0 ||
      !Number.isFinite(heap?.heapLimit) || heap.heapLimit <= 0)
    return { level: "unavailable", ratio: null };
  const ratio = heap.usedSize / heap.heapLimit;
  return {
    ratio,
    level: ratio >= HEAP_STOP_RATIO ? "critical"
      : ratio >= HEAP_WARNING_RATIO ? "warning" : "normal",
  };
}

export function heapLabel(heap) {
  if (!Number.isFinite(heap?.usedSize)) return "Unavailable in this browser";
  const { ratio } = heapPressure(heap);
  return `${mib(heap.usedSize)} MiB${ratio == null ? " · limit unavailable"
    : ` / ${mib(heap.heapLimit)} MiB · ${(ratio * 100).toFixed(1)}%`}`;
}

export function peakHeap(previous, sample) {
  if (!Number.isFinite(sample?.usedSize)) return previous ?? null;
  return !previous || sample.usedSize > previous.usedSize ? sample : previous;
}

export function previewError(message, status = "error") {
  return Object.assign(new Error(message), { status });
}

// Recoverable failures belong to one library. Resource pressure and user stops
// end the run because the next library would inherit the same tab's heap.
export async function runLitePasses({ targets, repeats, runPass, onResult }) {
  const failed = new Set();
  let completed = 0;
  let attempted = 0;
  const total = targets.length * repeats;
  for (let round = 0; round < repeats; round++) {
    const shift = round % targets.length;
    for (const item of [...targets.slice(shift), ...targets.slice(0, shift)]) {
      if (failed.has(item.id)) continue;
      let result;
      try {
        result = { ...await runPass(item, round, { completed, attempted, total }), status: "completed" };
        completed++;
      } catch (error) {
        result = { ...error.observations, status: error.status ?? "error", error: error.message };
        failed.add(item.id);
      }
      attempted++;
      onResult({ ...result, engine: item.id, round });
      if (["stopped", "resource-budget"].includes(result.status))
        return { completed, attempted, total, failed: failed.size, stopped: result.error };
    }
  }
  return { completed, attempted, total, failed: failed.size, skipped: total - attempted };
}
