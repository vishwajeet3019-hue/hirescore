"use client";

import { motion } from "framer-motion";

type StudioLockVisualProps = {
  compact?: boolean;
};

const SPARKS = Array.from({ length: 16 }, (_, index) => index);
const ORBITS = Array.from({ length: 4 }, (_, index) => index);

export default function StudioLockVisual({ compact = false }: StudioLockVisualProps) {
  const frameSize = compact ? "h-48 w-48 sm:h-52 sm:w-52" : "h-64 w-64 sm:h-72 sm:w-72";
  const coreSize = compact ? "h-20 w-20" : "h-24 w-24";

  return (
    <div className={`relative mx-auto ${frameSize}`}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 10, ease: "linear" }}
        className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,rgba(34,211,238,0.18),rgba(56,189,248,0.08),rgba(251,191,36,0.2),rgba(34,211,238,0.18))] blur-xl"
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ repeat: Infinity, duration: 16, ease: "linear" }}
        className="absolute inset-2 rounded-full border border-cyan-100/22"
      />
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 9, ease: "linear" }}
        className="absolute inset-7 rounded-full border border-cyan-100/35"
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ repeat: Infinity, duration: 7, ease: "linear" }}
        className="absolute inset-[26%] rounded-full border border-amber-100/38"
      />

      {ORBITS.map((orbit) => {
        const delay = orbit * 0.2;
        const duration = 4.4 + orbit * 0.6;
        return (
          <motion.div
            key={`orbit-${orbit}`}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration, ease: "linear", delay }}
            className="absolute inset-0"
          >
            <span
              className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cyan-100/90 shadow-[0_0_14px_rgba(34,211,238,0.9)]"
              style={{ transform: `translateX(-50%) translateY(${20 + orbit * 12}px)` }}
            />
          </motion.div>
        );
      })}

      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        {SPARKS.map((spark) => {
          const left = 6 + spark * 5.7;
          const duration = 2.4 + (spark % 4) * 0.45;
          const delay = (spark % 6) * 0.18;
          return (
            <motion.span
              key={`spark-${spark}`}
              className="absolute h-1.5 w-1.5 rounded-full bg-cyan-100/78"
              style={{ left: `${left}%`, bottom: "-10%" }}
              animate={{ y: [-2, -170], opacity: [0, 1, 0], scale: [0.6, 1.1, 0.7] }}
              transition={{ repeat: Infinity, duration, delay, ease: "easeOut" }}
            />
          );
        })}
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0.95, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
          className={`${coreSize} rounded-full bg-gradient-to-br from-cyan-300/40 to-amber-200/40 blur-md`}
        />
        <div
          className={`absolute ${coreSize} flex items-center justify-center rounded-full border border-cyan-100/55 bg-[#07243f]/90 shadow-[0_0_32px_rgba(34,211,238,0.45)]`}
        >
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4], y: [0, -1, 0] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
            className="text-xl font-semibold text-cyan-50"
          >
            01
          </motion.span>
        </div>
      </div>
    </div>
  );
}
