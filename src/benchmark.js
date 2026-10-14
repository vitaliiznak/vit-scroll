export const frame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));
export async function settle(frames = 4) {
  for (let i = 0; i < frames; i++) await frame();
}
export const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * p) - 1)
  ] ?? 0;

