"use client";

import { useEffect, useId, useState } from "react";

type BrandLogoProps = {
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  subtitle?: string;
  intro?: boolean;
};

export default function BrandLogo({
  className = "",
  titleClassName = "",
  subtitleClassName = "",
  subtitle = "Interview Calls Made Easier",
  intro = false,
}: BrandLogoProps) {
  const [introActive, setIntroActive] = useState(false);
  const gradientId = useId().replace(/:/g, "");

  useEffect(() => {
    if (!intro) return;
    const startTimer = window.setTimeout(() => {
      setIntroActive(true);
    }, 40);
    const stopTimer = window.setTimeout(() => {
      setIntroActive(false);
    }, 5040);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(stopTimer);
    };
  }, [intro]);

  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <span
        className={`relative flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-slate-300/70 bg-[radial-gradient(circle_at_30%_24%,rgba(255,255,255,0.9),rgba(255,255,255,0)_58%),linear-gradient(140deg,rgba(148,163,184,0.32),rgba(226,232,240,0.75)_42%,rgba(255,255,255,0.95)_100%)] shadow-[0_10px_22px_rgba(15,23,42,0.12)] sm:h-11 sm:w-11 sm:rounded-[1.05rem] ${introActive ? "logo-intro-active" : ""}`.trim()}
      >
        {introActive && <span aria-hidden className="logo-intro-orbit" />}
        {introActive && <span aria-hidden className="logo-intro-flare" />}
        <svg viewBox="0 0 64 64" aria-hidden className="h-6 w-6 sm:h-7 sm:w-7">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#334155" />
              <stop offset="56%" stopColor="#1e293b" />
              <stop offset="100%" stopColor="#64748b" />
            </linearGradient>
          </defs>
          <path d="M13 14h10v15h18V14h10v36H41V35H23v15H13z" fill={`url(#${gradientId})`} />
          <path d="M48 12h4v40h-4z" fill="#CBD5E1" opacity="0.9" />
        </svg>
      </span>

      <span>
        <span className={`block text-xs uppercase tracking-[0.2em] text-slate-500 ${subtitleClassName}`.trim()}>{subtitle}</span>
        <span className={`block font-semibold tracking-[0.02em] text-slate-900 sm:text-xl ${titleClassName}`.trim()}>HireScore</span>
      </span>
    </div>
  );
}
