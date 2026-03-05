"use client";

import { useEffect } from "react";

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  connection?: {
    saveData?: boolean;
    effectiveType?: string;
  };
};

const shouldUsePerformanceLiteByHints = () => {
  if (typeof window === "undefined") return false;

  const nav = navigator as NavigatorWithHints;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lowMemory = (nav.deviceMemory ?? 8) <= 3;
  const lowCpuThreads = (navigator.hardwareConcurrency ?? 8) <= 2;
  const saveData = Boolean(nav.connection?.saveData);
  const verySlowNetwork = /2g|slow-2g/i.test(nav.connection?.effectiveType || "");

  return prefersReducedMotion || lowMemory || lowCpuThreads || saveData || verySlowNetwork;
};

const probeFrameRate = async () => {
  if (typeof window === "undefined") return 60;
  const start = performance.now();
  let frames = 0;

  await new Promise<void>((resolve) => {
    const run = (now: number) => {
      frames += 1;
      if (now - start >= 1100) {
        resolve();
        return;
      }
      window.requestAnimationFrame(run);
    };
    window.requestAnimationFrame(run);
  });

  const elapsedMs = Math.max(1, performance.now() - start);
  return (frames * 1000) / elapsedMs;
};

export default function PerformanceAdapter() {
  useEffect(() => {
    const body = document.body;
    if (!body) return;
    let active = true;

    const applyMode = (enabled: boolean) => {
      body.classList.toggle("performance-lite", enabled);
    };
    const applyHintMode = () => applyMode(shouldUsePerformanceLiteByHints());

    applyHintMode();

    // If the device hints look strong but runtime FPS is poor, downgrade effects automatically.
    const fpsProbeTimer = window.setTimeout(() => {
      void (async () => {
        if (!active || body.classList.contains("performance-lite")) return;
        const fps = await probeFrameRate();
        if (!active) return;
        if (fps < 50) {
          applyMode(true);
        }
      })();
    }, 900);

    const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionMedia.addEventListener?.("change", applyHintMode);

    return () => {
      active = false;
      window.clearTimeout(fpsProbeTimer);
      reducedMotionMedia.removeEventListener?.("change", applyHintMode);
    };
  }, []);

  return null;
}
