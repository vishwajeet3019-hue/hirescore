"use client";

import { useEffect } from "react";
import { classifyHost, normalizeHost } from "@/lib/runtime-hosts";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    __hirescore_ga_id?: string;
  }
}

const PROD_GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || "";
const STAGING_GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_STAGING_MEASUREMENT_ID?.trim() || "";
const PREVIEW_GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_PREVIEW_MEASUREMENT_ID?.trim() || "";

const measurementIdForHost = (host: string): string => {
  const hostType = classifyHost(host);
  if (hostType === "production") return PROD_GA_MEASUREMENT_ID;
  if (hostType === "staging") return STAGING_GA_MEASUREMENT_ID;
  if (hostType === "preview") return PREVIEW_GA_MEASUREMENT_ID;
  return "";
};

export default function AnalyticsBootstrap() {
  useEffect(() => {
    const host = normalizeHost(window.location.hostname);
    const measurementId = measurementIdForHost(host);
    if (!measurementId) return;

    if (!Array.isArray(window.dataLayer)) {
      window.dataLayer = [];
    }

    window.gtag = window.gtag || function gtag() {
      window.dataLayer?.push(arguments);
    };

    const alreadyInitialized = window.__hirescore_ga_id === measurementId;
    if (!alreadyInitialized) {
      window.gtag("js", new Date());
      window.gtag("config", measurementId, { send_page_view: false });
      window.__hirescore_ga_id = measurementId;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[data-hs-ga-id="${measurementId}"]`);
    if (existingScript) return;

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    script.dataset.hsGaId = measurementId;
    document.head.appendChild(script);
  }, []);

  return null;
}
