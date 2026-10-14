import { inspect } from "./adapters.jsx";
import { liteFrame, settleLite } from "./lite-session.mjs";

// Benchmark lite: one quick pass of the mounted demo list, in this tab.
// Kept out of benchmark.js so the results page never imports the adapters.
export const LITE_PASSES = 3;
export const LITE_FRAMES = 60;

export async function measureAdapter(api, count, rowHeight, checkCancelled, signal, onProgress = () => {}) {
  const frame = () => liteFrame(signal);
  const settle = (frames = 4) => settleLite(frames, signal);
  const seeks = [];
  for (const target of [0, Math.floor(count / 2), count - 1]) {
    checkCancelled();
    api.jump(target);
    await settle(6);
    const observed = inspect(api, count);
    seeks.push({
      target,
      reached: !!observed?.visible.includes(target) && !observed.overlap,
    });
    onProgress({ seeks: [...seeks] });
  }
  checkCancelled();
  api.bottom();
  await settle(6);
  const nativeBottom = inspect(api, count);
  onProgress({ nativeEnd: !!nativeBottom?.lastRowVisible });
  checkCancelled();
  api.offset(0);
  await settle(8);
  // Identical logical requests at a reachable part of every list. Frame
  // intervals are not timed: at a few rows per frame they only show the
  // display refresh rate.
  for (let i = 0; i < LITE_FRAMES; i++) {
    checkCancelled();
    api.offset(i * rowHeight * 3);
    await frame();
  }
  await settle();
  return {
    mountedAfterScroll: inspect(api, count)?.mounted ?? 0,
    seeks,
    nativeEnd: !!nativeBottom?.lastRowVisible,
  };
}
