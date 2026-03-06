"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { addUtmParams } from "@/lib/utm";
import TrackedLink from "../components/tracked-link";

type CreditWallet = {
  credits: number;
  pricing: {
    analyze: number;
  };
};

type AuthPayload = {
  user?: {
    email?: string;
  };
  wallet?: CreditWallet;
};

type JdMatchPayload = {
  role_track: string;
  match_score: number;
  matched_keywords: string[];
  missing_keywords: string[];
  jd_keyword_count: number;
  resume_keyword_count: number;
  critical_coverage: number;
  suggested_bullets: string[];
  alignment_summary: string;
};

type JdExtractPayload = {
  job_description: string;
  extracted_chars: number;
  file_name: string;
  file_type?: string;
};

type ApiErrorDetail = {
  message?: string;
  wallet?: CreditWallet;
};

type ApiErrorPayload = {
  detail?: string | ApiErrorDetail;
  wallet?: CreditWallet;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const AUTH_REQUEST_TIMEOUT_MS = 70000;
const JD_MATCH_MIN_LOADING_MS = 4500;
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const fieldClass =
  "w-full rounded-xl border border-cyan-100/28 bg-[#08233f]/72 px-3 py-2.5 text-sm text-cyan-50 placeholder:text-cyan-100/36 outline-none transition focus:border-cyan-100/62";

const textAreaClass = `${fieldClass} min-h-[140px] leading-relaxed`;

export default function JdMatcherClient() {
  const [authToken, setAuthToken] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeUploadedFileName, setResumeUploadedFileName] = useState("");
  const [resumeFileUploading, setResumeFileUploading] = useState(false);
  const [jdInput, setJdInput] = useState("");
  const [jdUploadedFileName, setJdUploadedFileName] = useState("");
  const [jdFileUploading, setJdFileUploading] = useState(false);
  const [jdMatchLoading, setJdMatchLoading] = useState(false);
  const [jdMatchError, setJdMatchError] = useState("");
  const [jdMatch, setJdMatch] = useState<JdMatchPayload | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);

  const authHeader = useMemo(() => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined), [authToken]);

  const openAnalysisHref = addUtmParams("/upload", {
    source: "jd_matcher_page",
    medium: "internal",
    campaign: "jd_matcher",
  });

  useEffect(() => {
    void warmBackend(apiUrl);
  }, []);

  useEffect(() => {
    const syncAuth = async () => {
      const token = window.localStorage.getItem("hirescore_auth_token") || "";
      if (!token) {
        setAuthToken("");
        setWallet(null);
        setAuthEmail("");
        setAuthError("Login required to run JD match.");
        return;
      }

      try {
        const response = await fetch(apiUrl("/auth/me"), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });
        if (!response.ok) {
          window.localStorage.removeItem("hirescore_auth_token");
          setAuthToken("");
          setWallet(null);
          setAuthEmail("");
          setAuthError("Session expired. Login again to continue.");
          return;
        }
        const payload = (await response.json()) as AuthPayload;
        setAuthToken(token);
        setWallet(payload.wallet || null);
        setAuthEmail(payload.user?.email || "");
        setAuthError("");
      } catch {
        setAuthError("Unable to verify your session right now.");
      }
    };
    void syncAuth();
  }, []);

  const parseApiError = async (response: Response) => {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    if (payload?.wallet) {
      setWallet(payload.wallet);
    }
    if (payload?.detail && typeof payload.detail === "object") {
      if (payload.detail.wallet) {
        setWallet(payload.detail.wallet);
      }
      return payload.detail.message || `Request failed (${response.status})`;
    }
    if (typeof payload?.detail === "string") {
      return payload.detail;
    }
    return `Request failed (${response.status})`;
  };

  const extractTextFromUpload = async (file: File, context: "resume" | "jd") => {
    if (!authToken || !authHeader) {
      throw new Error(`Login required to upload ${context === "resume" ? "resume" : "JD"} file.`);
    }

    const normalizedName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || normalizedName.endsWith(".pdf");
    const isText = file.type.startsWith("text/") || normalizedName.endsWith(".txt");
    const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(normalizedName);
    if (!isPdf && !isText && !isImage) {
      throw new Error("Upload as PDF, TXT, or image (JPG/PNG/WebP).");
    }
    if (file.size > 12 * 1024 * 1024) {
      throw new Error("File is too large. Keep it under 12 MB.");
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("auth_token", authToken);

    const payload = await fetchJsonWithWakeAndRetry<JdExtractPayload>({
      apiUrl,
      path: "/analysis/jd-match/extract",
      init: {
        method: "POST",
        headers: {
          ...authHeader,
        },
        body: formData,
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: parseApiError,
      abortErrorMessage: `${context === "resume" ? "Resume" : "JD"} extraction is taking longer than expected. Please try again.`,
    });

    return payload;
  };

  const handleUploadResumeFile = async (file: File | null) => {
    if (!file) return;
    setJdMatchError("");
    setJdMatch(null);
    setResumeFileUploading(true);
    try {
      const payload = await extractTextFromUpload(file, "resume");
      setResumeText(payload.job_description || "");
      setResumeUploadedFileName(payload.file_name || file.name);
    } catch (error) {
      setResumeText("");
      setResumeUploadedFileName("");
      setJdMatchError(error instanceof Error ? error.message : "Unable to extract text from resume file.");
    } finally {
      setResumeFileUploading(false);
    }
  };

  const handleUploadJdFile = async (file: File | null) => {
    if (!file) return;
    setJdMatchError("");
    setJdMatch(null);
    setJdFileUploading(true);
    try {
      const payload = await extractTextFromUpload(file, "jd");
      setJdInput(payload.job_description || "");
      setJdUploadedFileName(payload.file_name || file.name);
    } catch (error) {
      setJdInput("");
      setJdUploadedFileName("");
      setJdMatchError(error instanceof Error ? error.message : "Unable to extract JD text from uploaded file.");
    } finally {
      setJdFileUploading(false);
    }
  };

  const handleRunJdMatch = async () => {
    if (!authToken || !authHeader) {
      setJdMatchError("Login required to run JD match.");
      return;
    }
    if (!resumeUploadedFileName) {
      setJdMatchError("Upload resume file before running AI JD match.");
      return;
    }
    if (!jdUploadedFileName && jdInput.trim().length < 24) {
      setJdMatchError("Upload JD file or paste a fuller job description (at least 24 characters).");
      return;
    }
    if (jdInput.trim().length < 24) {
      setJdMatchError("Could not extract enough JD text. Upload a clearer JD file or paste manually.");
      return;
    }
    if (resumeText.trim().length < 24) {
      setJdMatchError("Could not extract enough text from resume. Upload a clearer resume file.");
      return;
    }

    setJdMatchError("");
    setJdMatchLoading(true);
    setJdMatch(null);
    const startedAt = Date.now();
    try {
      const payload = await fetchJsonWithWakeAndRetry<JdMatchPayload>({
        apiUrl,
        path: "/analysis/jd-match",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            industry: industry.trim() || "General",
            role: role.trim() || "Target role",
            resume_text: resumeText.trim(),
            job_description: jdInput.trim(),
            auth_token: authToken,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "JD match is taking longer than expected. Please try again.",
      });
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < JD_MATCH_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, JD_MATCH_MIN_LOADING_MS - elapsedMs);
        });
      }
      setJdMatch(payload);
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < JD_MATCH_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, JD_MATCH_MIN_LOADING_MS - elapsedMs);
        });
      }
      setJdMatch(null);
      setJdMatchError(error instanceof Error ? error.message : "Unable to run JD match right now.");
    } finally {
      setJdMatchLoading(false);
    }
  };

  const canRunMatch =
    Boolean(authToken) &&
    Boolean(resumeUploadedFileName) &&
    (Boolean(jdUploadedFileName) || jdInput.trim().length >= 24) &&
    !resumeFileUploading &&
    !jdFileUploading &&
    !jdMatchLoading;

  return (
    <main className="min-h-screen px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-6xl rounded-[2rem] border border-cyan-100/24 bg-[linear-gradient(150deg,rgba(8,28,52,0.93),rgba(5,18,34,0.96)_58%,rgba(18,46,58,0.86))] p-6 shadow-[0_26px_70px_rgba(2,8,22,0.48)] sm:p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/78">Dedicated Tool</p>
        <h1 className="mt-3 text-3xl font-semibold text-cyan-50 sm:text-5xl">JD Matcher</h1>
        <p className="mt-3 max-w-3xl text-sm text-cyan-50/78 sm:text-base">
          Paste a target JD, add your resume text, and get precise keyword-gap and role-fit signals.
        </p>
        {authEmail && <p className="mt-3 text-sm text-cyan-100/84">Signed in as: {authEmail}</p>}
        {wallet && (
          <p className="mt-1 text-xs text-cyan-100/76">
            Wallet: {wallet.credits} credits | Analyze cost: {wallet.pricing.analyze} credits
          </p>
        )}
        <p className="mt-3 rounded-xl border border-cyan-100/24 bg-cyan-100/8 px-3 py-2 text-xs text-cyan-100/82">
          Mandatory: Upload your <span className="font-semibold text-cyan-50">Resume</span> file. For{" "}
          <span className="font-semibold text-cyan-50">JD</span>, you can upload a file or paste text directly.
        </p>
        {authError && (
          <div className="mt-4 rounded-xl border border-amber-100/34 bg-amber-100/12 p-3">
            <p className="text-sm text-amber-50">{authError}</p>
            <TrackedLink
              href={openAnalysisHref}
              eventName="cta_check_my_score_click"
              eventParams={{ cta_location: "jd_matcher_page", cta_label: "Go To Analysis + Login" }}
              className="mt-3 inline-flex rounded-lg border border-amber-100/40 bg-amber-100/14 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-100/20"
            >
              Go To Analysis + Login
            </TrackedLink>
          </div>
        )}
      </section>

      <section className="mx-auto mt-6 grid max-w-6xl gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-2xl border border-cyan-100/22 bg-[linear-gradient(145deg,rgba(7,27,50,0.86),rgba(4,18,36,0.9))] p-5">
          <h2 className="text-lg font-semibold text-cyan-50">Inputs</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              placeholder="Industry (optional)"
              className={fieldClass}
            />
            <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Role (optional)" className={fieldClass} />
          </div>
          <textarea
            value={resumeText}
            readOnly
            placeholder="Resume text preview appears after resume upload"
            className={`${textAreaClass} mt-3`}
          />
          <textarea
            value={jdInput}
            onChange={(event) => setJdInput(event.target.value)}
            placeholder="Paste target job description here (or upload JD file)"
            className={`${textAreaClass} mt-3`}
          />
          <input
            ref={resumeFileInputRef}
            type="file"
            accept=".pdf,.txt,image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              void handleUploadResumeFile(file);
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
              void handleUploadJdFile(file);
              event.currentTarget.value = "";
            }}
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={() => resumeFileInputRef.current?.click()}
              disabled={resumeFileUploading || jdMatchLoading}
              className="rounded-xl border border-cyan-100/34 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resumeFileUploading ? "Extracting Resume..." : "Upload Resume (Required)"}
            </button>
            <button
              type="button"
              onClick={() => jdFileInputRef.current?.click()}
              disabled={jdFileUploading || jdMatchLoading}
              className="rounded-xl border border-cyan-100/34 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {jdFileUploading ? "Extracting JD..." : "Upload JD (Optional)"}
            </button>
            <button
              type="button"
              onClick={() => void handleRunJdMatch()}
              disabled={!canRunMatch}
              className="rounded-xl border border-cyan-100/34 bg-cyan-200/18 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {jdMatchLoading ? "Running AI Match..." : "Run AI JD Match"}
            </button>
          </div>
          {resumeUploadedFileName && <p className="mt-2 text-xs text-cyan-100/78">Resume imported from: {resumeUploadedFileName}</p>}
          {jdUploadedFileName && <p className="mt-2 text-xs text-cyan-100/78">Imported from: {jdUploadedFileName}</p>}
          {jdMatchError && <p className="mt-2 text-xs text-amber-100">{jdMatchError}</p>}
        </div>

        <div className="rounded-2xl border border-cyan-100/22 bg-[linear-gradient(145deg,rgba(7,27,50,0.86),rgba(4,18,36,0.9))] p-5">
          <h2 className="text-lg font-semibold text-cyan-50">Match Result</h2>
          {jdMatchLoading ? (
            <div className="mt-4 rounded-2xl border border-cyan-100/18 bg-cyan-100/8 p-4">
              <div className="mx-auto relative h-24 w-24">
                <div className="absolute inset-0 rounded-full border-2 border-cyan-100/22" />
                <div className="absolute inset-2 rounded-full border-2 border-cyan-200/45 border-t-transparent animate-spin" />
                <div className="absolute inset-5 rounded-full border border-emerald-200/40 animate-pulse" />
              </div>
              <p className="mt-3 text-center text-sm font-semibold text-cyan-50">AI is evaluating role alignment...</p>
              <div className="mt-3 space-y-2">
                <div className="h-2 rounded-full border border-cyan-100/22 bg-cyan-100/10 overflow-hidden">
                  <div className="h-full w-[86%] animate-pulse rounded-full bg-gradient-to-r from-cyan-300/70 via-sky-300/75 to-emerald-200/80" />
                </div>
                <div className="h-2 rounded-full border border-cyan-100/22 bg-cyan-100/10 overflow-hidden">
                  <div className="h-full w-[72%] animate-pulse rounded-full bg-gradient-to-r from-cyan-300/70 via-sky-300/75 to-emerald-200/80" />
                </div>
                <div className="h-2 rounded-full border border-cyan-100/22 bg-cyan-100/10 overflow-hidden">
                  <div className="h-full w-[92%] animate-pulse rounded-full bg-gradient-to-r from-cyan-300/70 via-sky-300/75 to-emerald-200/80" />
                </div>
              </div>
            </div>
          ) : !jdMatch ? (
            <p className="mt-3 text-sm text-cyan-50/72">Run JD Match to see coverage score, missing keywords, and suggested bullets.</p>
          ) : (
            <>
              <div className="mt-3 rounded-lg border border-cyan-100/20 bg-cyan-100/8 p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/70">AI Match Graphs</p>
                <div className="mt-3 space-y-2.5">
                  {[
                    { label: "Role Match", value: jdMatch.match_score },
                    { label: "Critical Coverage", value: jdMatch.critical_coverage },
                    {
                      label: "Keyword Coverage",
                      value: Math.min(100, Math.round((jdMatch.matched_keywords.length / Math.max(1, jdMatch.jd_keyword_count)) * 100)),
                    },
                  ].map((metric) => (
                    <div key={metric.label}>
                      <div className="flex items-center justify-between text-xs text-cyan-100/80">
                        <span>{metric.label}</span>
                        <span>{metric.value}%</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full border border-cyan-100/18 bg-[#061a34]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-300 to-emerald-200 transition-all duration-700"
                          style={{ width: `${Math.max(0, Math.min(100, metric.value))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-cyan-100/18 bg-cyan-100/8 p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">AI Feedback</p>
                <p className="mt-2 text-sm text-cyan-100/84">{jdMatch.alignment_summary}</p>
                <p className="mt-3 text-[11px] uppercase tracking-[0.11em] text-cyan-100/72">Matched Signals</p>
                <p className="mt-1 text-sm text-cyan-50/78">{(jdMatch.matched_keywords || []).slice(0, 12).join(", ") || "None yet"}</p>
                <p className="mt-3 text-[11px] uppercase tracking-[0.11em] text-cyan-100/72">Gap Keywords</p>
                <p className="mt-1 text-sm text-cyan-50/78">{(jdMatch.missing_keywords || []).slice(0, 16).join(", ") || "None"}</p>
              </div>

              {(jdMatch.suggested_bullets || []).length > 0 && (
                <div className="mt-3 rounded-lg border border-cyan-100/18 bg-cyan-100/8 p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Action Feedback</p>
                  <ul className="mt-2 space-y-1 text-sm text-cyan-50/80">
                    {(jdMatch.suggested_bullets || []).slice(0, 5).map((line, index) => (
                      <li key={`${line}-${index}`}>- {line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
