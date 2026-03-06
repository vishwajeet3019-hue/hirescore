type EventValue = string | number | boolean;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export const trackEvent = (eventName: string, params: Record<string, EventValue> = {}) => {
  if (typeof window === "undefined") return;

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
  if (typeof window === "undefined") return;

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
