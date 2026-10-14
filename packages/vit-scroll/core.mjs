/** Fixed-height coordinates, with O(1) metadata regardless of row count. */
export function createGeometry({
  count,
  rowHeight,
  viewportHeight,
  maxPhysicalHeight = 8_000_000,
}) {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError("count must be a non-negative safe integer");
  for (const n of [rowHeight, viewportHeight, maxPhysicalHeight]) {
    if (!Number.isFinite(n) || n <= 0)
      throw new RangeError("dimensions must be finite and positive");
  }
  const total = count * rowHeight;
  if (total > Number.MAX_SAFE_INTEGER)
    throw new RangeError("logical height exceeds safe precision");
  if (maxPhysicalHeight <= viewportHeight)
    throw new RangeError("physical cap must exceed viewport height");
  const physical = Math.max(viewportHeight, Math.min(total, maxPhysicalHeight));
  const logicalRange = Math.max(0, total - viewportHeight);
  const physicalRange = Math.max(0, physical - viewportHeight);
  const clamp = (n) =>
    Math.max(0, Math.min(logicalRange, Number.isFinite(n) ? n : 0));
  return {
    count,
    rowHeight,
    viewportHeight,
    total,
    physical,
    logicalRange,
    physicalRange,
    clamp,
    toPhysical: (logical) =>
      logicalRange ? (clamp(logical) / logicalRange) * physicalRange : 0,
    toLogical: (physicalTop) =>
      physicalRange ? clamp((physicalTop / physicalRange) * logicalRange) : 0,
    range(logicalTop, overscan = 6) {
      const top = clamp(logicalTop);
      const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
      const end = Math.min(
        count,
        Math.ceil((top + viewportHeight) / rowHeight) + overscan,
      );
      return { first, end, top };
    },
    rowTop: (index, logicalTop, physicalTop) =>
      physicalTop + (index * rowHeight - logicalTop),
  };
}

/** Measure this engine instead of hard-coding a browser name/version table. */
export function probeHeightLimit() {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-20px;top:0;width:1px;height:100px;overflow:auto;visibility:hidden;contain:strict;";
  const spacer = document.createElement("div");
  spacer.style.cssText = "width:1px;";
  host.append(spacer);
  document.body.append(host);
  try {
    // Engines may clamp an oversized height or collapse it to zero. Find
    // the largest faithfully represented height instead of assuming clamping.
    let low = 1,
      high = 1_000_000_000;
    while (low < high) {
      const candidate = Math.ceil((low + high) / 2);
      spacer.style.height = `${candidate}px`;
      const measured = spacer.getBoundingClientRect().height;
      if (measured > 0 && Math.abs(measured - candidate) <= 1) low = candidate;
      else high = candidate - 1;
    }
    spacer.style.height = `${low}px`;
    const height = spacer.getBoundingClientRect().height;
    host.scrollTop = 1_000_000_000;
    return {
      height,
      scrollHeight: host.scrollHeight,
      maxScrollTop: host.scrollTop,
      measuredAt: new Date().toISOString(),
    };
  } finally {
    host.remove();
  }
}
