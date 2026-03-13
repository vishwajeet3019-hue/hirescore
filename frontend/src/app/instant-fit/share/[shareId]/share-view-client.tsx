"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import TrackedLink from "@/app/components/tracked-link";
import { addUtmParams } from "@/lib/utm";

type SharedInstantFitResult = {
  role?: string;
  industry?: string;
  match_percentage?: number;
  alignment_summary?: string;
  metrics?: {
    match_percentage?: number;
    jd_relevance?: number;
    must_have_coverage?: number;
    good_to_have_coverage?: number;
    critical_coverage?: number;
  };
  matched_skills?: string[];
  missing_skills?: string[];
  feedback?: string[];
  improvements?: string[];
  next_steps?: string[];
  jd_relevance?: {
    verdict?: string;
    is_field_mismatch?: boolean;
  };
};

type SharedResultPayload = {
  share_id: string;
  created_at?: string;
  result?: SharedInstantFitResult;
};

type ApiErrorPayload = {
  detail?: string;
};

type InstantFitShareClientProps = {
  shareId: string;
};

const PRIMARY_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const INSTANT_FIT_FALLBACK_API_BASE_URL =
  process.env.NEXT_PUBLIC_INSTANT_FIT_FALLBACK_API_BASE_URL?.trim() || "https://backend-six-gilt-84.vercel.app";
const AUTH_REQUEST_TIMEOUT_MS = 70000;
const buildApiUrl = (baseUrl: string) => (path: string) => `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const primaryApiUrl = buildApiUrl(PRIMARY_API_BASE_URL);
const fallbackApiUrl = buildApiUrl(INSTANT_FIT_FALLBACK_API_BASE_URL);

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export default function InstantFitShareClient({ shareId }: InstantFitShareClientProps) {
  const [useFallbackApi, setUseFallbackApi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<SharedResultPayload | null>(null);

  const runOwnCheckHref = addUtmParams("/instant-fit", {
    source: "instant_fit_share",
    medium: "internal",
    campaign: "share_to_tool",
  });
  const fullAnalysisHref = addUtmParams("/upload", {
    source: "instant_fit_share",
    medium: "internal",
    campaign: "share_to_analysis",
  });

  useEffect(() => {
    void warmBackend(primaryApiUrl);
    if (INSTANT_FIT_FALLBACK_API_BASE_URL !== PRIMARY_API_BASE_URL) {
      void warmBackend(fallbackApiUrl);
    }
  }, []);

  const activeApiUrl = useFallbackApi ? fallbackApiUrl : primaryApiUrl;

  useEffect(() => {
    let cancelled = false;
    const shouldFallbackOnError = (error: unknown) => {
      if (useFallbackApi) return false;
      if (INSTANT_FIT_FALLBACK_API_BASE_URL === PRIMARY_API_BASE_URL) return false;
      if (!(error instanceof Error)) return false;
      const message = error.message.toLowerCase();
      return message.includes("404") || message.includes("not found");
    };
    const parseApiError = async (response: Response) => {
      const errorPayload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
      if (typeof errorPayload?.detail === "string" && errorPayload.detail.trim()) return errorPayload.detail;
      return `Request failed (${response.status})`;
    };

    const loadSharedResult = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetchJsonWithWakeAndRetry<SharedResultPayload>({
          apiUrl: activeApiUrl,
          path: `/public/instant-fit-check/share/${encodeURIComponent(shareId)}`,
          init: {
            method: "GET",
            cache: "no-store",
          },
          timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
          parseError: parseApiError,
          abortErrorMessage: "Shared result is taking longer than expected. Please reload.",
        });
        if (!cancelled) {
          setPayload(response);
        }
      } catch (loadError) {
        if (shouldFallbackOnError(loadError)) {
          try {
            setUseFallbackApi(true);
            const fallbackResponse = await fetchJsonWithWakeAndRetry<SharedResultPayload>({
              apiUrl: fallbackApiUrl,
              path: `/public/instant-fit-check/share/${encodeURIComponent(shareId)}`,
              init: {
                method: "GET",
                cache: "no-store",
              },
              timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
              parseError: parseApiError,
              abortErrorMessage: "Shared result is taking longer than expected. Please reload.",
            });
            if (!cancelled) {
              setPayload(fallbackResponse);
              setError("");
            }
            return;
          } catch (fallbackError) {
            if (!cancelled) {
              setPayload(null);
              setError(fallbackError instanceof Error ? fallbackError.message : "Unable to load shared result.");
            }
            return;
          }
        }
        if (!cancelled) {
          setPayload(null);
          setError(loadError instanceof Error ? loadError.message : "Unable to load shared result.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSharedResult();
    return () => {
      cancelled = true;
    };
  }, [shareId, activeApiUrl, useFallbackApi]);

  const createdAtLabel = useMemo(() => {
    if (!payload?.created_at) return "";
    const dateValue = new Date(payload.created_at);
    if (Number.isNaN(dateValue.getTime())) return "";
    return dateValue.toLocaleString();
  }, [payload?.created_at]);

  const result = payload?.result;
  const metrics = result?.metrics || {};

  return (
    <main className="min-h-screen px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-4xl rounded-[2rem] border border-cyan-100/24 bg-[linear-gradient(150deg,rgba(8,28,52,0.93),rgba(5,18,34,0.96)_58%,rgba(18,46,58,0.86))] p-6 shadow-[0_26px_70px_rgba(2,8,22,0.48)] sm:p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/78">Shared Score Card</p>
        <h1 className="mt-3 text-3xl font-semibold text-cyan-50 sm:text-4xl">Instant JD Fit Snapshot</h1>
        {createdAtLabel && <p className="mt-2 text-xs text-cyan-100/72">Shared on: {createdAtLabel}</p>}
      </section>

      <section className="mx-auto mt-6 max-w-4xl rounded-2xl border border-cyan-100/22 bg-[linear-gradient(145deg,rgba(7,27,50,0.86),rgba(4,18,36,0.9))] p-5">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-52 animate-pulse rounded bg-cyan-100/18" />
            <div className="h-2 w-full animate-pulse rounded bg-cyan-100/12" />
            <div className="h-2 w-[86%] animate-pulse rounded bg-cyan-100/12" />
            <div className="h-2 w-[72%] animate-pulse rounded bg-cyan-100/12" />
          </div>
        ) : error ? (
          <div>
            <p className="text-sm text-amber-100">{error}</p>
            <TrackedLink
              href={runOwnCheckHref}
              eventName="cta_instant_fit_click"
              eventParams={{ cta_location: "instant_fit_share_error", cta_label: "Run My Instant Fit Check" }}
              className="mt-4 inline-flex rounded-lg border border-cyan-100/28 bg-cyan-200/14 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
            >
              Run My Instant Fit Check
            </TrackedLink>
          </div>
        ) : !result ? (
          <p className="text-sm text-cyan-50/74">Shared result is unavailable.</p>
        ) : (
          <>
            <div className="rounded-lg border border-cyan-100/18 bg-cyan-100/10 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">
                {result.role || "Target role"} • {result.industry || "General"}
              </p>
              <div className="mt-1 flex flex-wrap items-end gap-2">
                <p className="text-3xl font-semibold text-cyan-50">{clampPercent(result.match_percentage || 0)}%</p>
                {result.jd_relevance?.verdict && (
                  <span className="mb-1 rounded-full border border-cyan-100/24 bg-cyan-100/8 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100/78">
                    {result.jd_relevance.verdict.replace(/_/g, " ")}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-cyan-100/84">{result.alignment_summary || "Role-fit snapshot generated."}</p>
            </div>

            <div className="mt-3 rounded-lg border border-cyan-100/20 bg-cyan-100/8 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/70">Coverage Graphs</p>
              <div className="mt-3 space-y-2.5">
                {[
                  { label: "Role Match", value: metrics.match_percentage || result.match_percentage || 0 },
                  { label: "JD Relevance", value: metrics.jd_relevance || 0 },
                  { label: "Must-Have Coverage", value: metrics.must_have_coverage || 0 },
                  { label: "Good-To-Have Coverage", value: metrics.good_to_have_coverage || 0 },
                  { label: "Critical Coverage", value: metrics.critical_coverage || 0 },
                ].map((metric) => (
                  <div key={metric.label}>
                    <div className="flex items-center justify-between text-xs text-cyan-100/80">
                      <span>{metric.label}</span>
                      <span>{clampPercent(metric.value)}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full border border-cyan-100/18 bg-[#061a34]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-300 to-emerald-200"
                        style={{ width: `${clampPercent(metric.value)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-cyan-100/18 bg-cyan-100/8 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Matched Skills</p>
              <p className="mt-1 text-sm text-cyan-50/84">{(result.matched_skills || []).slice(0, 16).join(", ") || "None listed."}</p>
              <p className="mt-3 text-xs uppercase tracking-[0.12em] text-cyan-100/72">Missing Skills</p>
              <p className="mt-1 text-sm text-cyan-50/84">{(result.missing_skills || []).slice(0, 18).join(", ") || "No major gaps listed."}</p>
            </div>

            <div className="mt-3 rounded-lg border border-cyan-100/18 bg-cyan-100/8 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Feedback</p>
              <ul className="mt-2 space-y-1 text-sm text-cyan-100/84">
                {(result.feedback || []).slice(0, 4).map((line, index) => (
                  <li key={`${line}-${index}`}>- {line}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs uppercase tracking-[0.12em] text-cyan-100/72">Improvements</p>
              <ul className="mt-2 space-y-1 text-sm text-cyan-100/84">
                {(result.improvements || []).slice(0, 4).map((line, index) => (
                  <li key={`${line}-${index}`}>- {line}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs uppercase tracking-[0.12em] text-cyan-100/72">Next Steps</p>
              <ol className="mt-2 space-y-1 text-sm text-cyan-100/84">
                {(result.next_steps || []).slice(0, 4).map((line, index) => (
                  <li key={`${line}-${index}`}>{index + 1}. {line}</li>
                ))}
              </ol>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <TrackedLink
                href={runOwnCheckHref}
                eventName="cta_instant_fit_click"
                eventParams={{ cta_location: "instant_fit_share_result", cta_label: "Run My Instant Fit Check" }}
                className="rounded-lg border border-cyan-100/28 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
              >
                Run My Instant Fit Check
              </TrackedLink>
              <TrackedLink
                href={fullAnalysisHref}
                eventName="cta_check_my_score_click"
                eventParams={{ cta_location: "instant_fit_share_result", cta_label: "Run Full Analysis" }}
                className="rounded-lg border border-cyan-100/24 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-50/88 transition hover:bg-cyan-100/10"
              >
                Run Full Analysis
              </TrackedLink>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
