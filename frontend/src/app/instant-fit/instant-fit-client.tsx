"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { trackEvent } from "@/lib/analytics";
import { addUtmParams } from "@/lib/utm";
import TrackedLink from "../components/tracked-link";

type InstantFitMetrics = {
  match_percentage: number;
  jd_relevance: number;
  must_have_coverage: number;
  good_to_have_coverage: number;
  critical_coverage: number;
};

type InstantFitResult = {
  role: string;
  industry: string;
  match_percentage: number;
  alignment_summary: string;
  metrics: InstantFitMetrics;
  matched_skills: string[];
  missing_skills: string[];
  feedback: string[];
  improvements: string[];
  next_steps: string[];
  jd_relevance?: {
    score?: number;
    verdict?: string;
    detected_jd_track?: string;
    is_field_mismatch?: boolean;
    reasoning?: string[];
  };
  skill_breakdown?: {
    must_have_coverage?: number;
    good_to_have_coverage?: number;
    gap_severity?: string;
  };
  ai?: {
    used?: boolean;
    model?: string | null;
    blend?: number;
    mode?: string;
    reason?: string;
  };
  result_id?: string;
  created_at?: string;
  rate_limit?: {
    window_seconds?: number;
    limit?: number;
    remaining?: number;
  };
};

type InstantFitExtractPayload = {
  extracted_text: string;
  extracted_chars: number;
  file_name: string;
  file_type?: string;
};

type InstantFitSharePayload = {
  share_id: string;
  share_path: string;
  created_at: string;
  expires_in_seconds: number;
};

type ApiErrorPayload = {
  detail?: string;
};

const PRIMARY_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const INSTANT_FIT_FALLBACK_API_BASE_URL =
  process.env.NEXT_PUBLIC_INSTANT_FIT_FALLBACK_API_BASE_URL?.trim() || "https://backend-six-gilt-84.vercel.app";
const AUTH_REQUEST_TIMEOUT_MS = 70000;
const MIN_LOADING_MS = 4500;
const PUBLIC_SESSION_STORAGE_KEY = "hirescore_public_session_id";
const buildApiUrl = (baseUrl: string) => (path: string) => `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const primaryApiUrl = buildApiUrl(PRIMARY_API_BASE_URL);
const fallbackApiUrl = buildApiUrl(INSTANT_FIT_FALLBACK_API_BASE_URL);

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100/70";
const textAreaClass = `${fieldClass} min-h-[136px] leading-relaxed`;

const generatePublicSessionId = () => {
  if (typeof window === "undefined") return "";
  try {
    const randomBytes = new Uint8Array(12);
    window.crypto.getRandomValues(randomBytes);
    const token = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `public-${token}`;
  } catch {
    return `public-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export default function InstantFitClient() {
  const [useFallbackApi, setUseFallbackApi] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText] = useState("");
  const [resumeFileName, setResumeFileName] = useState("");
  const [jdFileName, setJdFileName] = useState("");
  const [resumeUploading, setResumeUploading] = useState(false);
  const [jdUploading, setJdUploading] = useState(false);
  const [runningCheck, setRunningCheck] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InstantFitResult | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);

  const fullAnalysisHref = addUtmParams("/upload", {
    source: "instant_fit",
    medium: "internal",
    campaign: "instant_fit_to_analysis",
  });
  const pricingHref = addUtmParams("/pricing", {
    source: "instant_fit",
    medium: "internal",
    campaign: "instant_fit_to_pricing",
  });

  useEffect(() => {
    void warmBackend(primaryApiUrl);
    if (INSTANT_FIT_FALLBACK_API_BASE_URL !== PRIMARY_API_BASE_URL) {
      void warmBackend(fallbackApiUrl);
    }
  }, []);

  const activeApiUrl = useFallbackApi ? fallbackApiUrl : primaryApiUrl;

  const shouldFallbackOnError = (error: unknown) => {
    if (useFallbackApi) return false;
    if (INSTANT_FIT_FALLBACK_API_BASE_URL === PRIMARY_API_BASE_URL) return false;
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return message.includes("404") || message.includes("not found");
  };

  const requestWithFallback = async <T,>({
    path,
    init,
    parseError,
    abortErrorMessage,
  }: {
    path: string;
    init?: RequestInit;
    parseError?: (response: Response) => Promise<string>;
    abortErrorMessage?: string;
  }): Promise<T> => {
    try {
      return await fetchJsonWithWakeAndRetry<T>({
        apiUrl: activeApiUrl,
        path,
        init,
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError,
        abortErrorMessage,
      });
    } catch (error) {
      if (!shouldFallbackOnError(error)) {
        throw error;
      }
      setUseFallbackApi(true);
      return fetchJsonWithWakeAndRetry<T>({
        apiUrl: fallbackApiUrl,
        path,
        init,
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError,
        abortErrorMessage,
      });
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(PUBLIC_SESSION_STORAGE_KEY) || "";
    if (stored) {
      setSessionId(stored);
      return;
    }
    const generated = generatePublicSessionId();
    if (!generated) return;
    window.localStorage.setItem(PUBLIC_SESSION_STORAGE_KEY, generated);
    setSessionId(generated);
  }, []);

  const parseApiError = async (response: Response) => {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    if (typeof payload?.detail === "string" && payload.detail.trim()) return payload.detail;
    return `Request failed (${response.status})`;
  };

  const extractTextFromFile = async (file: File, target: "resume" | "jd") => {
    if (!sessionId) throw new Error("Initializing session. Please try again.");
    const normalizedName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || normalizedName.endsWith(".pdf");
    const isText = file.type.startsWith("text/") || normalizedName.endsWith(".txt");
    const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(normalizedName);
    if (!isPdf && !isText && !isImage) {
      throw new Error("Upload a PDF, TXT, or image file.");
    }
    if (file.size > 12 * 1024 * 1024) {
      throw new Error("File is too large. Keep it under 12 MB.");
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("session_id", sessionId);

    const payload = await requestWithFallback<InstantFitExtractPayload>({
      path: "/public/instant-fit-check/extract",
      init: {
        method: "POST",
        body: formData,
      },
      parseError: parseApiError,
      abortErrorMessage: `${target === "resume" ? "Resume" : "JD"} extraction is taking longer than expected. Please retry.`,
    });
    return payload;
  };

  const handleFileExtract = async (file: File | null, target: "resume" | "jd") => {
    if (!file) return;
    setError("");
    setShareMessage("");
    setShareUrl("");
    if (target === "resume") {
      setResumeUploading(true);
    } else {
      setJdUploading(true);
    }
    try {
      const payload = await extractTextFromFile(file, target);
      if (target === "resume") {
        setResumeText(payload.extracted_text || "");
        setResumeFileName(payload.file_name || file.name);
      } else {
        setJdText(payload.extracted_text || "");
        setJdFileName(payload.file_name || file.name);
      }
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Unable to extract text from uploaded file.");
      if (target === "resume") {
        setResumeText("");
        setResumeFileName("");
      } else {
        setJdText("");
        setJdFileName("");
      }
    } finally {
      if (target === "resume") {
        setResumeUploading(false);
      } else {
        setJdUploading(false);
      }
    }
  };

  const handleRunInstantFit = async () => {
    if (!sessionId) {
      setError("Session is still initializing. Please retry in a moment.");
      return;
    }
    if (resumeText.trim().length < 24) {
      setError("Add your resume text (or upload resume file) before running AI match.");
      return;
    }
    if (jdText.trim().length < 24) {
      setError("Add job description text (or upload JD file) before running AI match.");
      return;
    }

    setError("");
    setShareMessage("");
    setShareUrl("");
    setRunningCheck(true);
    setResult(null);
    const startedAt = Date.now();

    trackEvent("instant_fit_check_start", {
      has_resume_upload: Boolean(resumeFileName),
      has_jd_upload: Boolean(jdFileName),
    });

    try {
      const payload = await requestWithFallback<InstantFitResult>({
        path: "/public/instant-fit-check",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            industry: industry.trim() || "General",
            role: role.trim() || "Target role",
            resume_text: resumeText.trim(),
            job_description: jdText.trim(),
            session_id: sessionId,
          }),
        },
        parseError: parseApiError,
        abortErrorMessage: "Instant fit check is taking longer than expected. Please retry.",
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, MIN_LOADING_MS - elapsed));
      }
      setResult(payload);
      trackEvent("instant_fit_check_complete", {
        score: clampPercent(payload.match_percentage || 0),
      });
    } catch (runError) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, MIN_LOADING_MS - elapsed));
      }
      setResult(null);
      setError(runError instanceof Error ? runError.message : "Unable to run instant fit check right now.");
    } finally {
      setRunningCheck(false);
    }
  };

  const handleCreateShareLink = async () => {
    if (!result?.result_id) {
      setShareMessage("Run Instant Fit Check first.");
      return;
    }
    if (!sessionId) {
      setShareMessage("Session is unavailable right now. Retry.");
      return;
    }
    setShareLoading(true);
    setShareMessage("");
    try {
      const payload = await requestWithFallback<InstantFitSharePayload>({
        path: "/public/instant-fit-check/share",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            result_id: result.result_id,
            session_id: sessionId,
          }),
        },
        parseError: parseApiError,
        abortErrorMessage: "Share link generation timed out. Please try again.",
      });
      const finalShareUrl =
        typeof window !== "undefined" ? `${window.location.origin}${payload.share_path}` : payload.share_path;
      setShareUrl(finalShareUrl);
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(finalShareUrl);
          setShareMessage("Share link copied to clipboard.");
        } else {
          setShareMessage("Share link generated.");
        }
      } catch {
        setShareMessage("Share link generated.");
      }
      trackEvent("instant_fit_share_link_created", {
        score: clampPercent(result.match_percentage || 0),
      });
    } catch (shareError) {
      setShareMessage(shareError instanceof Error ? shareError.message : "Unable to generate share link right now.");
    } finally {
      setShareLoading(false);
    }
  };

  const canRunCheck =
    resumeText.trim().length >= 24 &&
    jdText.trim().length >= 24 &&
    !resumeUploading &&
    !jdUploading &&
    !runningCheck;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f9fc] px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl" />
        <div className="absolute -left-20 top-56 h-72 w-72 rounded-full bg-amber-200/45 blur-3xl" />
        <div className="absolute bottom-10 right-16 h-56 w-56 rounded-full bg-emerald-200/35 blur-3xl" />
      </div>

      <section className="mx-auto max-w-6xl rounded-[2.2rem] border border-slate-200 bg-white p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)] sm:p-8 lg:p-10">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.12em] text-slate-700">
              No Login Tool
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 sm:text-5xl">
              Instant AI JD Fit Check
              <span className="block bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500 bg-clip-text text-transparent">
                built for faster shortlist decisions
              </span>
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
              Upload or paste your resume and JD. Get match percentage, matched skills, missing skills, and clear next steps in one run.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                1. Add Resume + JD
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                2. Run AI Match
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                3. Improve and Re-apply
              </span>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 p-5 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
            <p className="text-xs uppercase tracking-[0.12em] text-slate-500">What you get in this run</p>
            <div className="mt-4 space-y-2.5">
              {[
                "Role-fit percentage with JD relevance context",
                "Matched and missing skills with action points",
                "Immediate next steps for resume iteration",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 rounded-xl border border-white/70 bg-white/85 px-3 py-2.5">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
                  <p className="text-sm text-slate-700">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-6 grid max-w-6xl gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-[0_14px_36px_rgba(15,23,42,0.06)] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Inputs</h2>
            <p className="text-xs text-slate-500">Minimum 24 characters each for resume and JD</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              placeholder="Industry (optional)"
              className={fieldClass}
            />
            <input
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Role (optional)"
              className={fieldClass}
            />
          </div>

          <textarea
            value={resumeText}
            onChange={(event) => setResumeText(event.target.value)}
            placeholder="Paste resume text here or upload resume file"
            className={`${textAreaClass} mt-3`}
          />
          <textarea
            value={jdText}
            onChange={(event) => setJdText(event.target.value)}
            placeholder="Paste full job description here or upload JD file"
            className={`${textAreaClass} mt-3`}
          />

          <input
            ref={resumeFileInputRef}
            type="file"
            accept=".pdf,.txt,image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              void handleFileExtract(file, "resume");
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={jdFileInputRef}
            type="file"
            accept=".pdf,.txt,image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              void handleFileExtract(file, "jd");
              event.currentTarget.value = "";
            }}
          />

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={() => resumeFileInputRef.current?.click()}
              disabled={resumeUploading || runningCheck}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resumeUploading ? "Extracting Resume..." : "Upload Resume"}
            </button>
            <button
              type="button"
              onClick={() => jdFileInputRef.current?.click()}
              disabled={jdUploading || runningCheck}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {jdUploading ? "Extracting JD..." : "Upload JD"}
            </button>
            <button
              type="button"
              onClick={() => void handleRunInstantFit()}
              disabled={!canRunCheck}
              className="rounded-xl border border-amber-300 bg-gradient-to-r from-amber-300 to-amber-200 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runningCheck ? "Running AI Match..." : "Run Instant AI Match"}
            </button>
          </div>

          {resumeFileName && <p className="mt-2 text-xs text-slate-500">Resume imported from: {resumeFileName}</p>}
          {jdFileName && <p className="mt-2 text-xs text-slate-500">JD imported from: {jdFileName}</p>}
          {result?.rate_limit && (
            <p className="mt-2 text-xs text-slate-500">
              Public usage remaining: {Math.max(0, Number(result.rate_limit.remaining || 0))} of{" "}
              {Math.max(0, Number(result.rate_limit.limit || 0))} in current window.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        </div>

        <div className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-[0_14px_36px_rgba(15,23,42,0.06)] sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Match Result</h2>

          {runningCheck ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-cyan-50 p-4">
              <div className="relative mx-auto h-24 w-24">
                <div className="absolute inset-0 rounded-full border-2 border-slate-300" />
                <div className="absolute inset-2 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
                <div className="absolute inset-5 animate-pulse rounded-full border border-emerald-400/60" />
              </div>
              <p className="mt-3 text-center text-sm font-semibold text-slate-800">AI is evaluating role alignment...</p>
              <div className="mt-3 space-y-2">
                <div className="h-2 overflow-hidden rounded-full border border-slate-200 bg-white">
                  <div className="h-full w-[86%] animate-pulse rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400" />
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-slate-200 bg-white">
                  <div className="h-full w-[72%] animate-pulse rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400" />
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-slate-200 bg-white">
                  <div className="h-full w-[92%] animate-pulse rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400" />
                </div>
              </div>
            </div>
          ) : !result ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-cyan-50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 text-cyan-700">%</div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Result card will appear here</p>
                  <p className="text-sm text-slate-600">Run instant match to unlock score, gaps, and next actions.</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-3 rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-emerald-50 p-4">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Match Percentage</p>
                <div className="mt-1 flex flex-wrap items-end gap-2">
                  <p className="text-3xl font-semibold text-slate-900">{clampPercent(result.match_percentage)}%</p>
                  {result.jd_relevance?.verdict && (
                    <span className="mb-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-600">
                      {result.jd_relevance.verdict.replace(/_/g, " ")}
                    </span>
                  )}
                  {result.skill_breakdown?.gap_severity && (
                    <span className="mb-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-600">
                      Gap {result.skill_breakdown.gap_severity}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-700">{result.alignment_summary}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {result.ai?.used ? "Hybrid AI mode active" : "Rules mode active"}
                  {result.ai?.model ? ` | model: ${result.ai.model}` : ""}
                </p>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">AI Match Graphs</p>
                <div className="mt-3 space-y-2.5">
                  {[
                    { label: "Role Match", value: result.metrics.match_percentage },
                    { label: "JD Relevance", value: result.metrics.jd_relevance },
                    { label: "Critical Coverage", value: result.metrics.critical_coverage },
                    { label: "Must-Have Coverage", value: result.metrics.must_have_coverage },
                    { label: "Good-To-Have Coverage", value: result.metrics.good_to_have_coverage },
                  ].map((metric) => (
                    <div key={metric.label}>
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>{metric.label}</span>
                        <span>{clampPercent(metric.value)}%</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full border border-slate-200 bg-white">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 transition-all duration-700"
                          style={{ width: `${clampPercent(metric.value)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Matched Skills</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(result.matched_skills || []).slice(0, 12).map((skill) => (
                    <span
                      key={`matched-${skill}`}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                    >
                      {skill}
                    </span>
                  ))}
                  {(result.matched_skills || []).length === 0 && <p className="text-sm text-slate-600">None detected yet.</p>}
                </div>

                <p className="mt-3 text-xs uppercase tracking-[0.12em] text-slate-500">Missing Skills</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(result.missing_skills || []).slice(0, 14).map((skill) => (
                    <span
                      key={`missing-${skill}`}
                      className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
                    >
                      {skill}
                    </span>
                  ))}
                  {(result.missing_skills || []).length === 0 && (
                    <p className="text-sm text-slate-600">No critical gaps detected.</p>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">AI Feedback</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {(result.feedback || []).slice(0, 5).map((line, index) => (
                    <li key={`${line}-${index}`}>- {line}</li>
                  ))}
                </ul>
                <p className="mt-3 text-xs uppercase tracking-[0.12em] text-slate-500">Improvements</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {(result.improvements || []).slice(0, 5).map((line, index) => (
                    <li key={`${line}-${index}`}>- {line}</li>
                  ))}
                </ul>
                <p className="mt-3 text-xs uppercase tracking-[0.12em] text-slate-500">Next Steps</p>
                <ol className="mt-2 space-y-1 text-sm text-slate-700">
                  {(result.next_steps || []).slice(0, 4).map((line, index) => (
                    <li key={`${line}-${index}`}>
                      {index + 1}. {line}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-gradient-to-r from-white via-cyan-50/50 to-white p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCreateShareLink()}
                    disabled={shareLoading}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {shareLoading ? "Generating Share Link..." : "Share Score Card"}
                  </button>
                  <TrackedLink
                    href={fullAnalysisHref}
                    eventName="cta_check_my_score_click"
                    eventParams={{ cta_location: "instant_fit_result", cta_label: "Run Full Analysis" }}
                    className="rounded-lg border border-cyan-200 bg-cyan-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-600"
                  >
                    Run Full Analysis
                  </TrackedLink>
                  <TrackedLink
                    href={pricingHref}
                    eventName="cta_view_premium_plans_click"
                    eventParams={{ cta_location: "instant_fit_result", cta_label: "View Premium Plans" }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    View Premium Plans
                  </TrackedLink>
                </div>
                {shareMessage && <p className="mt-2 text-xs text-slate-600">{shareMessage}</p>}
                {shareUrl && (
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex text-xs font-semibold text-cyan-700 underline decoration-cyan-300 underline-offset-2"
                  >
                    {shareUrl}
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
