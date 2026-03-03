"use client";

import { motion } from "framer-motion";

type StudioLockVisualProps = {
  compact?: boolean;
};

const TUNNEL_RINGS = Array.from({ length: 6 }, (_, index) => index);
const COMETS = [
  { left: 8, delay: 0.1, duration: 3.2 },
  { left: 18, delay: 0.35, duration: 3.7 },
  { left: 28, delay: 0.7, duration: 2.9 },
  { left: 38, delay: 0.95, duration: 3.4 },
  { left: 48, delay: 1.2, duration: 3.1 },
  { left: 58, delay: 0.45, duration: 3.8 },
  { left: 68, delay: 0.85, duration: 3.3 },
  { left: 78, delay: 1.35, duration: 2.8 },
  { left: 88, delay: 0.25, duration: 3.6 },
];
const SATELLITES = [
  { radius: 28, size: 7, duration: 4.8, delay: 0 },
  { radius: 40, size: 6, duration: 6.2, delay: 0.2 },
  { radius: 52, size: 5, duration: 7.6, delay: 0.4 },
  { radius: 62, size: 4, duration: 9.1, delay: 0.6 },
];
const SPOKES = Array.from({ length: 18 }, (_, index) => index * 20);

export default function StudioLockVisual({ compact = false }: StudioLockVisualProps) {
  const frameSize = compact ? "h-52 w-52 sm:h-56 sm:w-56" : "h-72 w-72 sm:h-80 sm:w-80";
  const crystalSize = compact ? "h-24 w-24" : "h-28 w-28";
  const scannerWidth = compact ? "w-28" : "w-36";

  return (
    <div className={`relative mx-auto ${frameSize}`} style={{ perspective: "960px" }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 18, ease: "linear" }}
        className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,rgba(34,211,238,0.15),rgba(2,132,199,0.04),rgba(250,204,21,0.2),rgba(34,211,238,0.15))] blur-2xl"
      />

      <div className="absolute inset-0 overflow-hidden rounded-full">
        {COMETS.map((comet, index) => (
          <motion.span
            key={`comet-${index}`}
            className="absolute h-2 w-2 rounded-full bg-cyan-100/86 shadow-[0_0_16px_rgba(103,232,249,0.9)]"
            style={{ left: `${comet.left}%`, bottom: "-12%" }}
            animate={{ y: [0, -220], opacity: [0, 1, 0], scale: [0.7, 1.2, 0.65] }}
            transition={{ repeat: Infinity, duration: comet.duration, delay: comet.delay, ease: "easeOut" }}
          />
        ))}
      </div>

      <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {TUNNEL_RINGS.map((ring) => {
          const inset = 8 + ring * 10;
          const tilt = 62 + ring * 2;
          return (
            <motion.div
              key={`ring-${ring}`}
              animate={{ rotateZ: ring % 2 === 0 ? 360 : -360 }}
              transition={{ repeat: Infinity, duration: 7 + ring * 1.2, ease: "linear" }}
              className="absolute rounded-full border border-cyan-100/20"
              style={{
                inset: `${inset}px`,
                transform: `rotateX(${tilt}deg)`,
                boxShadow: ring % 2 === 0 ? "0 0 18px rgba(34,211,238,0.25)" : "0 0 14px rgba(251,191,36,0.18)",
              }}
            />
          );
        })}
      </div>

      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
        <motion.circle
          cx="50"
          cy="50"
          r="41"
          fill="none"
          stroke="rgba(125,211,252,0.36)"
          strokeWidth="0.6"
          strokeDasharray="2 3"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 14, ease: "linear" }}
          style={{ transformOrigin: "50% 50%" }}
        />
        <motion.circle
          cx="50"
          cy="50"
          r="30"
          fill="none"
          stroke="rgba(253,230,138,0.4)"
          strokeWidth="0.6"
          strokeDasharray="3 4"
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 10, ease: "linear" }}
          style={{ transformOrigin: "50% 50%" }}
        />
        {SPOKES.map((angle) => (
          <line
            key={`spoke-${angle}`}
            x1="50"
            y1="50"
            x2="50"
            y2="8"
            stroke="rgba(125,211,252,0.2)"
            strokeWidth="0.35"
            transform={`rotate(${angle} 50 50)`}
          />
        ))}
        <motion.path
          d="M9 56 Q50 5 91 56"
          fill="none"
          stroke="rgba(56,189,248,0.66)"
          strokeWidth="0.9"
          strokeLinecap="round"
          animate={{ pathLength: [0, 1, 0], opacity: [0.2, 1, 0.2] }}
          transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut" }}
        />
        <motion.path
          d="M9 44 Q50 95 91 44"
          fill="none"
          stroke="rgba(250,204,21,0.66)"
          strokeWidth="0.9"
          strokeLinecap="round"
          animate={{ pathLength: [0, 1, 0], opacity: [0.2, 1, 0.2] }}
          transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut", delay: 0.35 }}
        />
      </svg>

      {SATELLITES.map((satellite, index) => (
        <motion.div
          key={`satellite-${index}`}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: satellite.duration, ease: "linear", delay: satellite.delay }}
          className="absolute inset-0"
        >
          <span
            className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100/75 bg-cyan-200/50 shadow-[0_0_20px_rgba(56,189,248,0.75)]"
            style={{ width: `${satellite.size}px`, height: `${satellite.size}px`, transform: `translate(-50%, -50%) translateY(-${satellite.radius}px)` }}
          />
        </motion.div>
      ))}

      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          animate={{ scale: [0.96, 1.08, 0.96], opacity: [0.46, 0.92, 0.46] }}
          transition={{ repeat: Infinity, duration: 2.1, ease: "easeInOut" }}
          className={`${crystalSize} rounded-[32%] bg-gradient-to-br from-cyan-300/45 via-sky-300/25 to-amber-200/42 blur-md`}
        />
        <motion.div
          animate={{ rotate: [0, 180, 360] }}
          transition={{ repeat: Infinity, duration: 8.4, ease: "linear" }}
          className={`absolute ${crystalSize} border border-cyan-100/58 bg-[#082742]/84 shadow-[0_0_38px_rgba(34,211,238,0.52)]`}
          style={{ clipPath: "polygon(50% 0%, 87% 25%, 87% 75%, 50% 100%, 13% 75%, 13% 25%)" }}
        />
        <motion.div
          animate={{ y: [-18, 18, -18], opacity: [0.25, 0.95, 0.25] }}
          transition={{ repeat: Infinity, duration: 1.9, ease: "easeInOut" }}
          className={`absolute h-1 ${scannerWidth} rounded-full bg-gradient-to-r from-transparent via-cyan-100 to-transparent blur-[1px]`}
        />
        <motion.span
          animate={{ opacity: [0.45, 1, 0.45], letterSpacing: ["0.2em", "0.28em", "0.2em"] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
          className="absolute text-[11px] font-semibold uppercase text-cyan-50"
        >
          ANALYZE
        </motion.span>
      </div>
    </div>
  );
}
