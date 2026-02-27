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
  subtitle = "Precision Career Intelligence",
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
        className={`relative flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-cyan-200/45 bg-[radial-gradient(circle_at_30%_24%,rgba(255,255,255,0.46),rgba(255,255,255,0)_52%),linear-gradient(140deg,rgba(34,211,238,0.34),rgba(14,165,233,0.14)_42%,rgba(251,191,36,0.14)_100%)] shadow-[0_10px_30px_rgba(6,182,212,0.28)] sm:h-11 sm:w-11 sm:rounded-[1.05rem] ${introActive ? "logo-intro-active" : ""}`.trim()}
      >
        {introActive && <span aria-hidden className="logo-intro-orbit" />}
        {introActive && <span aria-hidden className="logo-intro-flare" />}
        <svg viewBox="0 0 64 64" aria-hidden className="h-6 w-6 sm:h-7 sm:w-7">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#CFFAFE" />
              <stop offset="56%" stopColor="#22D3EE" />
              <stop offset="100%" stopColor="#FDE68A" />
            </linearGradient>
          </defs>
          <path d="M13 14h10v15h18V14h10v36H41V35H23v15H13z" fill={`url(#${gradientId})`} />
          <path d="M48 12h4v40h-4z" fill="#E0F2FE" opacity="0.7" />
        </svg>
      </span>

      <span>
        <span className={`block text-xs uppercase tracking-[0.2em] text-cyan-100/68 ${subtitleClassName}`.trim()}>{subtitle}</span>
        <span className={`block font-semibold tracking-[0.02em] text-cyan-50 sm:text-xl ${titleClassName}`.trim()}>HireScore</span>
      </span>
    </div>
  );
}
