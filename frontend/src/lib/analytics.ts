import { isPreviewHost, isProductionHost, isStagingHost, normalizeHost } from "@/lib/runtime-hosts";

type EventValue = string | number | boolean;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const BOT_USER_AGENT_PATTERN =
  /bot|spider|crawler|crawl|headless|lighthouse|pingdom|monitor|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|applebot|yandex|baiduspider|duckduckbot|semrush|ahrefs|mj12bot|bytespider/i;
const GA_ENABLE_PREVIEW = (process.env.NEXT_PUBLIC_GA_ENABLE_PREVIEW?.trim() || "").toLowerCase() === "true";

type NavigatorWithWebDriver = Navigator & {
  webdriver?: boolean;
};

const isLikelyAutomatedClient = (): boolean => {
  const agent = (navigator.userAgent || "").trim();
  if (!agent) return true;
  if (BOT_USER_AGENT_PATTERN.test(agent)) return true;
  if ((navigator as NavigatorWithWebDriver).webdriver) return true;
  return false;
};

const isAllowedAnalyticsHost = (): boolean => {
  const host = normalizeHost(window.location.hostname);
  if (!host) return false;
  if (isProductionHost(host) || isStagingHost(host)) return true;
  if (GA_ENABLE_PREVIEW && isPreviewHost(host)) return true;
  return false;
};

const shouldTrackAnalytics = (): boolean => {
  if (typeof window === "undefined") return false;
  if (!isAllowedAnalyticsHost()) return false;
  if (isLikelyAutomatedClient()) return false;
  return true;
};

export const trackEvent = (eventName: string, params: Record<string, EventValue> = {}) => {
  if (!shouldTrackAnalytics()) return;

  if (typeof window.gtag === "function") {
    window.gtag("event", eventName, params);
    return;
  }

  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({
      event: eventName,
      ...params,
    });
  }
};

export const trackPageView = (pagePath: string) => {
  const safePath = pagePath || "/";
  if (!shouldTrackAnalytics()) return;

  const params = {
    page_path: safePath,
    page_title: document.title,
    page_location: `${window.location.origin}${safePath}`,
  };

  if (typeof window.gtag === "function") {
    window.gtag("event", "page_view", params);
    return;
  }

  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({
      event: "page_view",
      ...params,
    });
  }
};

export const trackSignup = (method: string = "email") => {
  trackEvent("sign_up", {
    method,
  });
};

export const trackBeginCheckout = (params: {
  item_id: string;
  item_name: string;
  currency: string;
  value: number;
  payment_gateway?: string;
  location?: string;
}) => {
  trackEvent("begin_checkout", {
    item_id: params.item_id,
    item_name: params.item_name,
    currency: params.currency,
    value: params.value,
    payment_gateway: params.payment_gateway || "unknown",
    location: params.location || "pricing_page",
  });
};

export const trackPurchase = (params: {
  transaction_id?: string;
  item_id: string;
  item_name: string;
  currency: string;
  value: number;
  payment_gateway?: string;
  credits?: number;
}) => {
  trackEvent("purchase", {
    transaction_id: params.transaction_id || "",
    item_id: params.item_id,
    item_name: params.item_name,
    currency: params.currency,
    value: params.value,
    payment_gateway: params.payment_gateway || "unknown",
    credits: params.credits || 0,
  });
};

export const trackAnalyzeStart = (mode: "manual" | "upload", location = "upload_page") => {
  trackEvent("analyze_start", {
    analyze_mode: mode,
    location,
  });
};

export const trackAnalyzeComplete = (params: {
  score: number;
  mode?: "manual" | "upload";
  location?: string;
}) => {
  trackEvent("analyze_complete", {
    score: params.score,
    analyze_mode: params.mode || "manual",
    location: params.location || "upload_page",
  });
};
