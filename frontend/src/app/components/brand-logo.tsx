"use client";

import { BRAND_SUBTITLE } from "@/lib/brand";

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
  subtitle = BRAND_SUBTITLE,
}: BrandLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#cdbfa8] bg-[#fff8ee] shadow-[0_16px_28px_rgba(120,95,64,0.1)] sm:h-11 sm:w-11">
        <svg viewBox="0 0 64 64" aria-hidden className="h-6 w-6 text-[#355e46] sm:h-7 sm:w-7">
          <path d="M14 14h10v14h18V14h10v36H42V36H24v14H14z" fill="currentColor" />
          <path d="M47 12h4v40h-4z" fill="#c8744d" opacity="0.75" />
        </svg>
      </span>

      <span>
        <span className={`block text-[11px] uppercase tracking-[0.18em] text-[#74826d] ${subtitleClassName}`.trim()}>
          {subtitle}
        </span>
        <span className={`block font-semibold tracking-[0.02em] text-[#203528] sm:text-xl ${titleClassName}`.trim()}>
          HireScore
        </span>
      </span>
    </div>
  );
}
