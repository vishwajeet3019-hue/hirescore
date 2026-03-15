"use client";

import { fetchJsonWithWakeAndRetry } from "./backend-warm";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const AUTH_TOKEN_STORAGE_KEY = "hirescore_auth_token";
const PUBLIC_ACCESS_GUEST_KEY_STORAGE_KEY = "hirescore_public_access_guest_key";
const AUTH_CHANGE_EVENT = "hirescore-auth-changed";
const FEATURE_FLAG_CACHE_TTL_MS = 5_000;

type FeatureFlagsPayload = {
  feature_flags?: {
    public_feature_access_enabled?: boolean;
  };
};

type PublicAccessSessionPayload = {
  auth_token?: string;
};

export type ResolvedAuthSession<T> = {
  token: string;
  payload: T | null;
  error: Error | null;
};

let featureFlagCache: { enabled: boolean; expiresAt: number } | null = null;
let featureFlagPromise: Promise<boolean> | null = null;
let publicAccessSessionPromise: Promise<string | null> | null = null;

const dispatchAuthChange = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
};

const ensurePublicAccessGuestKey = () => {
  const existing = window.localStorage.getItem(PUBLIC_ACCESS_GUEST_KEY_STORAGE_KEY) || "";
  if (existing) return existing;

  let created = "";
  try {
    const randomBytes = new Uint8Array(12);
    window.crypto.getRandomValues(randomBytes);
    created = `public-${Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    created = `public-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  window.localStorage.setItem(PUBLIC_ACCESS_GUEST_KEY_STORAGE_KEY, created);
  return created;
};

const fetchPublicAccessEnabled = async () => {
  if (typeof window === "undefined") return false;
  const now = Date.now();
  if (featureFlagCache && featureFlagCache.expiresAt > now) {
    return featureFlagCache.enabled;
  }
  if (featureFlagPromise) {
    return featureFlagPromise;
  }

  featureFlagPromise = fetchJsonWithWakeAndRetry<FeatureFlagsPayload>({
    apiUrl,
    path: "/feature-flags",
    init: {
      method: "GET",
      cache: "no-store",
    },
    timeoutMs: 30_000,
    parseError: async (response) => {
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      return payload?.detail || `Request failed (${response.status})`;
    },
  })
    .then((payload) => Boolean(payload.feature_flags?.public_feature_access_enabled))
    .catch(() => false)
    .then((enabled) => {
      featureFlagCache = {
        enabled,
        expiresAt: Date.now() + FEATURE_FLAG_CACHE_TTL_MS,
      };
      return enabled;
    })
    .finally(() => {
      featureFlagPromise = null;
    });

  return featureFlagPromise;
};

const fetchAuthPayload = async <T,>(token: string): Promise<T | null> => {
  const response = await fetch(apiUrl("/auth/me"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unable to verify session (${response.status}).`);
  }
  return (await response.json()) as T;
};

export const getStoredAuthToken = () => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
};

export const setStoredAuthToken = (token: string) => {
  if (typeof window === "undefined") return;
  const normalized = token.trim();
  if (normalized) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, normalized);
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
  dispatchAuthChange();
};

export const clearStoredAuthToken = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  dispatchAuthChange();
};

export const addAuthChangeListener = (listener: () => void) => {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === AUTH_TOKEN_STORAGE_KEY) {
      listener();
    }
  };
  const onLocalChange = () => listener();

  window.addEventListener(AUTH_CHANGE_EVENT, onLocalChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onLocalChange);

  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onLocalChange);
  };
};

export const ensurePublicAccessSession = async (): Promise<string | null> => {
  if (typeof window === "undefined") return null;
  const existing = getStoredAuthToken();
  if (existing) return existing;

  const enabled = await fetchPublicAccessEnabled();
  if (!enabled) return null;

  if (!publicAccessSessionPromise) {
    publicAccessSessionPromise = fetchJsonWithWakeAndRetry<PublicAccessSessionPayload>({
      apiUrl,
      path: "/auth/public-access-session",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guest_key: ensurePublicAccessGuestKey(),
        }),
        cache: "no-store",
      },
      timeoutMs: 45_000,
      parseError: async (response) => {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        return payload?.detail || `Request failed (${response.status})`;
      },
      abortErrorMessage: "Public access is taking longer than expected. Please refresh and try again.",
    })
      .then((payload) => {
        const token = payload.auth_token?.trim() || "";
        if (token) {
          setStoredAuthToken(token);
          return token;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        publicAccessSessionPromise = null;
      });
  }

  return publicAccessSessionPromise;
};

export const resolveAuthSession = async <T,>(): Promise<ResolvedAuthSession<T>> => {
  if (typeof window === "undefined") {
    return { token: "", payload: null, error: null };
  }

  let token = getStoredAuthToken();
  if (token) {
    try {
      const payload = await fetchAuthPayload<T>(token);
      if (payload) {
        return { token, payload, error: null };
      }
      clearStoredAuthToken();
    } catch (error) {
      return {
        token,
        payload: null,
        error: error instanceof Error ? error : new Error("Unable to verify session."),
      };
    }
  }

  token = (await ensurePublicAccessSession()) || "";
  if (!token) {
    return { token: "", payload: null, error: null };
  }

  try {
    const payload = await fetchAuthPayload<T>(token);
    if (payload) {
      return { token, payload, error: null };
    }
    clearStoredAuthToken();
    return { token: "", payload: null, error: null };
  } catch (error) {
    return {
      token,
      payload: null,
      error: error instanceof Error ? error : new Error("Unable to verify session."),
    };
  }
};
