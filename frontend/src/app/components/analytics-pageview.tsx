"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackPageView } from "@/lib/analytics";

export default function AnalyticsPageviewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const query = typeof window === "undefined" ? "" : window.location.search;
    const path = `${pathname || "/"}${query || ""}`;
    trackPageView(path);
  }, [pathname]);

  return null;
}
