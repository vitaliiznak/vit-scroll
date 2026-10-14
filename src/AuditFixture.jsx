import React, { useRef, useState, useEffect } from "react";
import { flushSync } from "react-dom";
import { Adapter, VIEWPORT, inspect } from "./adapters.jsx";
import { ADAPTERS } from "./engines.mjs";
import { frame, settle } from "./benchmark.js";
import { DynamicAdapter } from "./dynamic-adapters.jsx";
import {
  ALIGN_TOLERANCE_PX,
  expectedStartTop,
  rowSize,
  unsupportedReason,
} from "./row-scenario.mjs";

// Deliberately starts empty: the external controller measures mount after load.
export function AuditFixture({ physicalCap }) {
  const ref = useRef(null);
  // Where the adapter rests row 0 at scroll top, measured after mount.
  const origin = useRef(0);
  const [config, setConfig] = useState(null);
  useEffect(() => {
    const sample = () => inspect(ref.current, config?.count ?? 0);
    // A library that throws during render (e.g. React's maximum update depth)
    // unmounts the tree. Say so instead of failing on a null API later.
    const api = () => {
      if (!ref.current) throw new Error("The list unmounted itself; see page errors.");
      return ref.current;
    };
    const geometry = (o) => {
      if (!o?.visible.length || o.gaps || o.overlap) return false;
      const el = api().element;
      const rect = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll("[data-row-index]")].filter((r) =>
        o.visible.includes(Number(r.dataset.rowIndex)),
      );
      const correctHeights = rows.every((row) => {
        const expected = rowSize(Number(row.dataset.rowIndex), {
          expanded: config.expanded,
          narrow: innerWidth < 700,
        });
        return Math.abs(row.getBoundingClientRect().height - expected) <= 1;
      });
      return correctHeights &&
        Math.min(...rows.map((r) => r.getBoundingClientRect().top)) <= rect.top + 1 &&
        Math.max(...rows.map((r) => r.getBoundingClientRect().bottom)) >= rect.bottom - 1;
    };
    const rowTop = (index) => {
      const api = ref.current;
      const el = api?.element;
      const row = el && (api.rowsRoot || el).querySelector(
        `[data-row-index="${index}"]`,
      );
      return row
        ? row.getBoundingClientRect().top -
            (el.getBoundingClientRect().top + el.clientTop)
        : null;
    };
    // Signed px between the target row and where a start-aligned jump puts it.
    const alignment = (index) => {
      const top = rowTop(index);
      return top === null
        ? null
        : top -
            expectedStartTop({
              index,
              count: config.count,
              viewportHeight: api().element.clientHeight,
              rowHeight: config.rowHeight,
              rowMode: config.rowMode,
              origin: origin.current,
            });
    };
    // Reached: the row is visible without gaps or overlap for two frames.
    // Aligned: it also sits within 1px of the requested start position for
    // two frames. Libraries that correct position after the first visible
    // frame get settleMs more to land.
    const seek = async (index, timeoutMs = 1000, settleMs = 300) => {
      const start = performance.now();
      api().jump(index);
      let observation,
        valid = 0,
        aligned = 0,
        visibleMs = null,
        alignErrorPx = null,
        elapsed = 0;
      do {
        await frame();
        observation = sample();
        const ok =
          observation?.visible.includes(index) &&
          !observation.overlap &&
          !observation.gaps &&
          (config.rowMode !== "dynamic" || geometry(observation));
        valid = ok ? valid + 1 : 0;
        elapsed = performance.now() - start;
        if (valid >= 2 && visibleMs === null) visibleMs = elapsed;
        if (ok) alignErrorPx = alignment(index);
        aligned =
          ok && alignErrorPx != null && Math.abs(alignErrorPx) <= ALIGN_TOLERANCE_PX
            ? aligned + 1
            : 0;
        if (aligned >= 2) break;
      } while (
        visibleMs === null ? elapsed < timeoutMs : elapsed < visibleMs + settleMs
      );
      const reached = visibleMs !== null;
      return {
        index,
        reached,
        visibleMs,
        ...(reached ? {} : { waitedMs: performance.now() - start }),
        aligned: reached ? aligned >= 2 : null,
        alignErrorPx: reached ? alignErrorPx : null,
        observation,
      };
    };
    window.scrollAudit = {
      sample,
      async mount(engine, count, rowHeight = 48, rowMode = "fixed") {
        if (
          !ADAPTERS.some((a) => a.id === engine) ||
          !Number.isSafeInteger(count) ||
          count < 1 ||
          count > 100_000_000 ||
          !["fixed", "dynamic"].includes(rowMode) ||
          unsupportedReason(engine, rowMode)
        )
          throw new Error("Invalid audit configuration");
        const start = performance.now();
        flushSync(() =>
          setConfig({ engine, count, rowHeight, rowMode, expanded: false }),
        );
        const synchronousCommitMs = performance.now() - start;
        let observation;
        do {
          await frame();
          observation = inspect(ref.current, count);
        } while (
          !observation?.visible.includes(0) &&
          performance.now() - start < 5000
        );
        await frame();
        const visibleMs = performance.now() - start;
        origin.current = rowTop(0) ?? 0;
        return {
          synchronousCommitMs,
          visibleMs,
          originPx: origin.current,
          observation: inspect(ref.current, count),
        };
      },
      seek,
      async checkDynamic(anchor, timeoutMs = 2000) {
        const start = performance.now();
        let consecutive = 0, observation, heightChecks;
        do {
          await frame();
          observation = sample();
          heightChecks = geometry(observation);
          consecutive = heightChecks && observation.visible.includes(anchor) ? consecutive + 1 : 0;
        } while (consecutive < 2 && performance.now() - start < timeoutMs);
        const anchorNode = api().element.querySelector(
          `[data-row-index="${anchor}"]`,
        );
        return {
          passed: consecutive >= 2,
          settledMs: performance.now() - start,
          heightChecks,
          anchorVisible: observation?.visible.includes(anchor) ?? false,
          anchorTop: anchorNode
            ? anchorNode.getBoundingClientRect().top - api().element.getBoundingClientRect().top
            : null,
          observation,
        };
      },
      setExpanded(expanded) {
        flushSync(() => setConfig((c) => ({ ...c, expanded })));
      },
      async nativeEnd() {
        api().bottom();
        await settle(6);
        const observation = sample();
        if (config.rowMode === "dynamic" && observation)
          observation.lastRowVisible = observation.lastRowVisible && geometry(observation);
        return observation;
      },
      // 120 frames of three-row steps down and back up. A correctness check:
      // every frame must cover the viewport without blanks, gaps or overlap.
      // Frame intervals are not recorded; at this workload they only measure
      // the display refresh rate.
      async scrollLocal() {
        await seek(0);
        const invalidFrames = [];
        let peakMounted = 0;
        for (let i = 0; i < 120; i++) {
          api().jump(i < 60 ? i * 3 : (119 - i) * 3);
          await frame();
          const o = sample();
          peakMounted = Math.max(peakMounted, o?.mounted ?? 0);
          // Observe coverage, not requested-index visibility: commits can land next frame.
          if (
            !o?.visible.length || o.overlap || o.gaps ||
            (config.rowMode === "dynamic" && !geometry(o))
          ) invalidFrames.push(i);
        }
        return { invalidFrames, peakMounted };
      },
      inputTarget() {
        api().element.dataset.auditInput = "true";
        return { tabIndex: api().element.tabIndex };
      },
      focus() {
        api().element.focus();
        return document.activeElement === api().element;
      },
      unmount() {
        flushSync(() => setConfig(null));
      },
    };
    return () => {
      delete window.scrollAudit;
    };
  }, [config]);
  return (
    <div style={{ width: 900, maxWidth: "100%", margin: "20px auto" }}>
      <p style={{ fontSize: 12 }}>
        Isolated benchmark fixture ·{" "}
        {config
          ? `${config.engine} / ${config.count.toLocaleString()} rows`
          : "Ready"}
      </p>
      <div style={{ height: VIEWPORT }}>
        {config && (config.rowMode === "dynamic" ? (
          <DynamicAdapter {...config} apiRef={ref} />
        ) : (
          <Adapter {...config} apiRef={ref} physicalCap={physicalCap} />
        ))}
      </div>
    </div>
  );
}
