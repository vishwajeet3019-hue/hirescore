"use client";

import { motion } from "framer-motion";

type StudioLockVisualProps = {
  compact?: boolean;
};

const SATELLITES = Array.from({ length: 6 }, (_, index) => index);

export default function StudioLockVisual({ compact = false }: StudioLockVisualProps) {
  const frameSize = compact ? "h-44 w-44 sm:h-48 sm:w-48" : "h-56 w-56 sm:h-64 sm:w-64";
  const coreSize = compact ? "h-20 w-20" : "h-24 w-24";
  const scannerWidth = compact ? "w-24" : "w-32";

  return (
    <div className={`relative mx-auto ${frameSize}`}>
      <motion.div
        animate={{ opacity: [0.35, 0.62, 0.35], scale: [0.96, 1.03, 0.96] }}
        transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut" }}
        className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_36%,rgba(125,211,252,0.24),rgba(125,211,252,0.07)_42%,rgba(3,12,27,0)_76%)]"
      />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
        <motion.circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke="rgba(125,211,252,0.25)"
          strokeWidth="0.5"
          strokeDasharray="2 5"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
          style={{ transformOrigin: "50% 50%" }}
        />
        <motion.circle
          cx="50"
          cy="50"
          r="33"
          fill="none"
          stroke="rgba(253,230,138,0.28)"
          strokeWidth="0.5"
          strokeDasharray="3 6"
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 16, ease: "linear" }}
          style={{ transformOrigin: "50% 50%" }}
        />
        <motion.path
          d="M14 50 Q50 24 86 50"
          fill="none"
          stroke="rgba(56,189,248,0.54)"
          strokeWidth="1"
          strokeLinecap="round"
          animate={{ pathLength: [0, 1, 0], opacity: [0.2, 0.86, 0.2] }}
          transition={{ repeat: Infinity, duration: 3.4, ease: "easeInOut" }}
        />
        <motion.path
          d="M14 50 Q50 76 86 50"
          fill="none"
          stroke="rgba(250,204,21,0.46)"
          strokeWidth="1"
          strokeLinecap="round"
          animate={{ pathLength: [0, 1, 0], opacity: [0.2, 0.86, 0.2] }}
          transition={{ repeat: Infinity, duration: 3.4, ease: "easeInOut", delay: 0.45 }}
        />
      </svg>

      {SATELLITES.map((satellite, index) => (
        <motion.div
          key={`satellite-${index}`}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 8 + index * 1.4, ease: "linear", delay: index * 0.18 }}
          className="absolute inset-0"
        >
          <span
            className="absolute left-1/2 top-1/2 block h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-100/70 shadow-[0_0_12px_rgba(125,211,252,0.65)]"
            style={{ transform: `translate(-50%, -50%) rotate(${satellite * 60}deg) translateY(-${compact ? 76 : 94}px)` }}
          />
        </motion.div>
      ))}

      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.05, 1], boxShadow: ["0 0 20px rgba(56,189,248,0.2)", "0 0 34px rgba(56,189,248,0.42)", "0 0 20px rgba(56,189,248,0.2)"] }}
          transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
          className={`${coreSize} rounded-[1.4rem] border border-cyan-100/36 bg-[linear-gradient(155deg,rgba(10,25,41,0.95),rgba(6,18,31,0.9))]`}
        />
        <motion.div
          animate={{ y: [-14, 14, -14], opacity: [0.15, 0.75, 0.15] }}
          transition={{ repeat: Infinity, duration: 2.1, ease: "easeInOut" }}
          className={`absolute h-[1px] ${scannerWidth} rounded-full bg-gradient-to-r from-transparent via-cyan-100 to-transparent`}
        />
        <motion.span
          animate={{ opacity: [0.45, 0.95, 0.45] }}
          transition={{ repeat: Infinity, duration: 2.1, ease: "easeInOut" }}
          className="absolute text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-50/88"
        >
          STUDIO
        </motion.span>
      </div>
    </div>
  );
}
