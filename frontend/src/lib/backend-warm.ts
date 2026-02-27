type ApiUrlBuilder = (path: string) => string;

type WarmState = {
  lastWakeAt: number;
  inFlight: Promise<void> | null;
};

type FetchJsonOptions = {
  apiUrl: ApiUrlBuilder;
  path: string;
  init?: RequestInit;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  warmup?: boolean;
  parseError?: (response: Response) => Promise<string>;
  abortErrorMessage?: string;
};

const WAKE_MIN_INTERVAL_MS = 120_000;
const WAKE_TIMEOUT_MS = 15_000;
const states = new Map<string, WarmState>();

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const isRetryableNetworkError = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("network request failed")
  );
};

export const warmBackend = async (apiUrl: ApiUrlBuilder, force = false) => {
  const key = apiUrl("/");
  let state = states.get(key);
  if (!state) {
    state = { lastWakeAt: 0, inFlight: null };
    states.set(key, state);
  }

  const now = Date.now();
  if (!force && now - state.lastWakeAt < WAKE_MIN_INTERVAL_MS) {
    return;
  }
  if (state.inFlight) {
    return state.inFlight;
  }

  state.inFlight = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), WAKE_TIMEOUT_MS);
    try {
      await fetch(apiUrl("/"), {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      // Warm-up is best effort only.
    } finally {
      window.clearTimeout(timeout);
      const latest = states.get(key);
      if (latest) {
        latest.lastWakeAt = Date.now();
        latest.inFlight = null;
      }
    }
  })();

  return state.inFlight;
};

export const fetchJsonWithWakeAndRetry = async <T>({
  apiUrl,
  path,
  init,
  timeoutMs = 70_000,
  retries = 1,
  retryDelayMs = 1_200,
  warmup = true,
  parseError,
  abortErrorMessage,
}: FetchJsonOptions): Promise<T> => {
  if (warmup) {
    await warmBackend(apiUrl);
  }

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(apiUrl(path), {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        if (parseError) {
          throw new Error(await parseError(response));
        }
        throw new Error(`Request failed (${response.status})`);
      }
      return (await response.json()) as T;
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const retryable = isRetryableNetworkError(error);
      if (retryable && attempt < retries) {
        attempt += 1;
        await warmBackend(apiUrl, true);
        await sleep(retryDelayMs * attempt);
        continue;
      }
      if (aborted && abortErrorMessage) {
        throw new Error(abortErrorMessage);
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
};
