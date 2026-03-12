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
        className={`relative flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.08)] sm:h-11 sm:w-11 sm:rounded-[1.05rem] ${
          introActive ? "logo-intro-active" : ""
        }`.trim()}
      >
        {introActive && <span aria-hidden className="logo-intro-orbit" />}
        {introActive && <span aria-hidden className="logo-intro-flare" />}
        <svg viewBox="0 0 64 64" aria-hidden className="h-6 w-6 sm:h-7 sm:w-7">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0F172A" />
              <stop offset="50%" stopColor="#06B6D4" />
              <stop offset="100%" stopColor="#84CC16" />
            </linearGradient>
          </defs>
          <path d="M13 14h10v15h18V14h10v36H41V35H23v15H13z" fill={`url(#${gradientId})`} />
          <path d="M48 12h4v40h-4z" fill="#0F172A" opacity="0.35" />
        </svg>
      </span>

      <span>
        <span
          className={`block text-[10px] uppercase tracking-[0.16em] text-slate-500 ${subtitleClassName}`.trim()}
        >
          {subtitle}
        </span>
        <span className={`block font-semibold tracking-[0.01em] text-slate-900 sm:text-xl ${titleClassName}`.trim()}>
          HireScore
        </span>
      </span>
    </div>
  );
}
