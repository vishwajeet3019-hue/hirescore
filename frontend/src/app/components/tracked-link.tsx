"use client";

import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

type EventValue = string | number | boolean;

type TrackedLinkProps = {
  href: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
  eventName: string;
  eventParams?: Record<string, EventValue>;
  children: React.ReactNode;
};

export default function TrackedLink({
  href,
  className,
  title,
  ariaLabel,
  eventName,
  eventParams,
  children,
}: TrackedLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={() => {
        trackEvent(eventName, eventParams);
      }}
    >
      {children}
    </Link>
  );
}
