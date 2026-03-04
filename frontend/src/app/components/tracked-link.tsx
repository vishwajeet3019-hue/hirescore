"use client";

import Link from "next/link";
import { trackEvent } from "@/lib/analytics";

type EventValue = string | number | boolean;

type TrackedLinkProps = {
  href: string;
  className?: string;
  eventName: string;
  eventParams?: Record<string, EventValue>;
  children: React.ReactNode;
};

export default function TrackedLink({
  href,
  className,
  eventName,
  eventParams,
  children,
}: TrackedLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        trackEvent(eventName, eventParams);
      }}
    >
      {children}
    </Link>
  );
}
