"use client";

import { useId } from "react";
import { motion } from "framer-motion";

type StudioLockVisualProps = {
  compact?: boolean;
};

const LATITUDE_RY = [8, 14, 20, 26, 31];
const LONGITUDE_RX = [7, 14, 21, 28];
const ORBITS = [
  { inset: 6, duration: 20, delay: 0 },
  { inset: 14, duration: 14, delay: 0.1 },
  { inset: 22, duration: 10.5, delay: 0.2 },
];

export default function StudioLockVisual({ compact = false }: StudioLockVisualProps) {
  const uniqueId = useId().replace(/[:]/g, "");
  const size = compact ? 190 : 250;
  const coreSize = compact ? 88 : 104;
  const gradientId = `studio-core-${uniqueId}`;
  const lineId = `studio-line-${uniqueId}`;

  return (
    <div className="relative mx-auto flex items-center justify-center" style={{ width: size, height: size }}>
      <motion.div
        animate={{ opacity: [0.35, 0.62, 0.35], scale: [0.96, 1.03, 0.96] }}
        transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut" }}
        className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_42%,rgba(125,211,252,0.26),rgba(125,211,252,0.08)_42%,rgba(3,12,27,0)_76%)]"
      />

      {ORBITS.map((orbit, index) => (
        <motion.div
          key={`orbit-${orbit.inset}`}
          animate={{ rotate: index % 2 === 0 ? 360 : -360 }}
          transition={{ repeat: Infinity, duration: orbit.duration, ease: "linear", delay: orbit.delay }}
          className="absolute rounded-full border border-cyan-100/24"
          style={{ inset: `${orbit.inset}%` }}
        >
          <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-100/80 shadow-[0_0_12px_rgba(125,211,252,0.7)]" />
        </motion.div>
      ))}

      <svg className="pointer-events-none absolute inset-[17%] h-[66%] w-[66%]" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="50%" r="58%">
            <stop offset="0%" stopColor="rgba(125,211,252,0.22)" />
            <stop offset="68%" stopColor="rgba(7,30,52,0.86)" />
            <stop offset="100%" stopColor="rgba(6,18,31,0.96)" />
          </radialGradient>
          <linearGradient id={lineId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(125,211,252,0.72)" />
            <stop offset="100%" stopColor="rgba(253,230,138,0.5)" />
          </linearGradient>
        </defs>

        <circle cx="60" cy="60" r="38" fill={`url(#${gradientId})`} stroke="rgba(125,211,252,0.34)" strokeWidth="1" />

        <motion.g
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 26, ease: "linear" }}
          style={{ transformOrigin: "60px 60px" }}
        >
          {LATITUDE_RY.map((ry) => (
            <ellipse key={`lat-${ry}`} cx="60" cy="60" rx="34" ry={ry} fill="none" stroke={`url(#${lineId})`} strokeWidth="0.8" opacity="0.65" />
          ))}
        </motion.g>

        <motion.g
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 24, ease: "linear" }}
          style={{ transformOrigin: "60px 60px" }}
        >
          {LONGITUDE_RX.map((rx) => (
            <ellipse key={`lon-${rx}`} cx="60" cy="60" rx={rx} ry="34" fill="none" stroke="rgba(147,197,253,0.52)" strokeWidth="0.8" />
          ))}
        </motion.g>

        <motion.path
          d="M23 60 C42 42 78 42 97 60"
          fill="none"
          stroke="rgba(125,211,252,0.75)"
          strokeWidth="1.2"
          strokeLinecap="round"
          animate={{ pathLength: [0, 1, 0], opacity: [0.18, 0.9, 0.18] }}
          transition={{ repeat: Infinity, duration: 3.8, ease: "easeInOut" }}
        />
        <motion.path
          d="M23 60 C42 78 78 78 97 60"
          fill="none"
          stroke="rgba(250,204,21,0.62)"
          strokeWidth="1.2"
          strokeLinecap="round"
          animate={{ pathLength: [0, 1, 0], opacity: [0.18, 0.82, 0.18] }}
          transition={{ repeat: Infinity, duration: 3.8, ease: "easeInOut", delay: 0.55 }}
        />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          animate={{
            scale: [1, 1.05, 1],
            boxShadow: ["0 0 20px rgba(56,189,248,0.18)", "0 0 34px rgba(56,189,248,0.4)", "0 0 20px rgba(56,189,248,0.18)"],
          }}
          transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
          className={`rounded-[1.2rem] border border-cyan-100/36 bg-[linear-gradient(155deg,rgba(10,25,41,0.95),rgba(6,18,31,0.9))]`}
          style={{ width: coreSize, height: coreSize }}
        />
        <motion.div
          animate={{ y: [-14, 14, -14], opacity: [0.15, 0.75, 0.15] }}
          transition={{ repeat: Infinity, duration: 2.1, ease: "easeInOut" }}
          className="absolute h-[1px] rounded-full bg-gradient-to-r from-transparent via-cyan-100 to-transparent"
          style={{ width: compact ? 96 : 128 }}
        />
        <motion.span
          animate={{ opacity: [0.45, 0.95, 0.45] }}
          transition={{ repeat: Infinity, duration: 2.1, ease: "easeInOut" }}
          className="absolute text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-50/88"
        >
          ANALYSIS GATE
        </motion.span>
      </div>
    </div>
  );
}
