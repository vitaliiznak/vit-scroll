// Cancel pending animation frames too: hidden tabs can suspend rAF indefinitely.
export function liteFrame(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => {
      cancelAnimationFrame(id);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const id = requestAnimationFrame((time) => {
      signal.removeEventListener("abort", abort);
      resolve(time);
    });
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function settleLite(frames, signal) {
  for (let i = 0; i < frames; i++) await liteFrame(signal);
}

// Keep the measured DOM visible and programmatically scrollable, but prevent
// user input from changing the workload. Stop lives outside the inert root.
export function lockLitePage(root, stopButton, interrupt) {
  const previousFocus = document.activeElement;
  const previousInert = root.inert;
  const previousOverflow = document.documentElement.style.overflow;
  root.inert = true;
  document.documentElement.style.overflow = "hidden";
  stopButton.focus({ preventScroll: true });

  const preventScroll = (event) => event.preventDefault();
  const keydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      interrupt("Stopped by you.");
    } else if (event.key === "Tab") {
      event.preventDefault();
      stopButton.focus({ preventScroll: true });
    } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)
      && !(event.key === " " && event.target === stopButton)) {
      event.preventDefault();
    }
  };
  const visibility = () => {
    if (document.hidden) interrupt("Stopped because the tab was hidden. Keep this tab visible and focused while it runs.");
  };
  const blur = () => interrupt("Stopped because the window lost focus. Keep this tab focused while it runs.");
  const resize = () => interrupt("Stopped because the window size changed. Run again at the new size.");
  document.addEventListener("wheel", preventScroll, { passive: false, capture: true });
  document.addEventListener("touchmove", preventScroll, { passive: false, capture: true });
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("blur", blur);
  window.addEventListener("resize", resize);
  visibility();

  return () => {
    document.removeEventListener("wheel", preventScroll, true);
    document.removeEventListener("touchmove", preventScroll, true);
    document.removeEventListener("keydown", keydown, true);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("blur", blur);
    window.removeEventListener("resize", resize);
    root.inert = previousInert;
    document.documentElement.style.overflow = previousOverflow;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
}
