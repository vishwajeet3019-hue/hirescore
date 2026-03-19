"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { resolveAuthSession } from "@/lib/public-access";

type MatcherPayload = {
  role: string;
  industry: string;
  match_percentage: number;
  matched_skills: string[];
  missing_skills: string[];
  feedback: string[];
  resume_improvements: string[];
  jd_match?: {
    critical_coverage?: number;
    must_have_coverage?: number;
    good_to_have_coverage?: number;
    jd_relevance?: number;
    alignment_summary?: string;
  };
};

type ExtractPayload = {
  job_description: string;
  extracted_chars: number;
  file_name: string;
};

type ApiErrorPayload = {
  detail?: string | { message?: string };
};

type AuthSessionPayload = {
  auth_token?: string;
  guest_mode?: boolean;
  user?: {
    name?: string;
    email?: string;
  };
};

type JobTrackPayload = {
  job_track?: {
    id?: number;
    status?: string;
    match_percentage?: number;
    updated_at?: string;
  };
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const REQUEST_TIMEOUT_MS = 70_000;
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const fieldClass =
  "w-full rounded-[1.5rem] border border-black/10 bg-white px-4 py-3 text-sm text-[#111111] outline-none transition focus:border-black focus:bg-white";
const textAreaClass = `${fieldClass} min-h-[176px] resize-y leading-relaxed`;

const normalizeInsight = (value: string) =>
  value
    .replace(/^\s*[-*]\s*/, "")
    .replace(/^\s*\d+[\.\)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

const sentenceCase = (value: string) => {
  const cleaned = normalizeInsight(value);
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const statusForSavedTrack = (score: number) => (score < 70 ? "rejected" : "saved");

const statusToneForScore = (score: number) => {
  if (score < 70) {
    return {
      label: "Likely Rejected ❌",
      badgeClass: "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]",
      accentClass: "text-[#b91c1c]",
      borderClass: "border-[#fecaca]",
      backgroundClass: "bg-[#fff5f5]",
    };
  }
  if (score < 84) {
    return {
      label: "Borderline ⚠️",
      badgeClass: "border-[#fcd34d] bg-[#fffbeb] text-[#b45309]",
      accentClass: "text-[#b45309]",
      borderClass: "border-[#fcd34d]",
      backgroundClass: "bg-[#fffaf0]",
    };
  }
  return {
    label: "Strong Match ✅",
    badgeClass: "border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]",
    accentClass: "text-[#15803d]",
    borderClass: "border-[#bbf7d0]",
    backgroundClass: "bg-[#f7fff8]",
  };
};

export default function ApplicationCopilotClient() {
  const [resumeText, setResumeText] = useState("");
  const [jdInput, setJdInput] = useState("");
  const [resumeUploadedFileName, setResumeUploadedFileName] = useState("");
  const [jdUploadedFileName, setJdUploadedFileName] = useState("");
  const [resumeFileUploading, setResumeFileUploading] = useState(false);
  const [jdFileUploading, setJdFileUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MatcherPayload | null>(null);
  const [guestSessionToken, setGuestSessionToken] = useState("");
  const [workspaceNote, setWorkspaceNote] = useState("");
  const [savedTrackId, setSavedTrackId] = useState<number | null>(null);

  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void warmBackend(apiUrl);
  }, []);

  const bootstrapGuestWorkspace = useCallback(async () => {
    const session = await resolveAuthSession<AuthSessionPayload>();
    const token = session.token?.trim() || "";
    if (token) {
      setGuestSessionToken(token);
    }
    return token;
  }, []);

  useEffect(() => {
    void bootstrapGuestWorkspace();
  }, [bootstrapGuestWorkspace]);

  const parseApiError = useCallback(async (response: Response) => {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    if (typeof payload?.detail === "string") {
      return payload.detail;
    }
    if (payload?.detail && typeof payload.detail === "object") {
      return payload.detail.message || `Request failed (${response.status})`;
    }
    return `Request failed (${response.status})`;
  }, []);

  const saveScoreCheckToDashboard = useCallback(
    async (authToken: string, payload: MatcherPayload) => {
      if (!authToken) return null;

      const score = Math.max(0, Math.min(100, Math.round(payload.match_percentage || 0)));
      const saved = await fetchJsonWithWakeAndRetry<JobTrackPayload>({
        apiUrl,
        path: "/application-copilot/job-tracks",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            role: payload.role || "Target role",
            industry: payload.industry || "General",
            status: statusForSavedTrack(score),
            copilot_payload: payload,
          }),
        },
        timeoutMs: REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Saving your score check is taking longer than expected. Please try again.",
      });

      return saved.job_track?.id || null;
    },
    [parseApiError],
  );

  const extractTextFromUpload = useCallback(
    async (file: File, context: "resume" | "jd") => {
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

      return fetchJsonWithWakeAndRetry<ExtractPayload>({
        apiUrl,
        path: "/analysis/jd-match/extract",
        init: {
          method: "POST",
          body: formData,
        },
        timeoutMs: REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: `${context === "resume" ? "Resume" : "JD"} extraction is taking longer than expected. Please try again.`,
      });
    },
    [parseApiError],
  );

  const handleUploadResumeFile = async (file: File | null) => {
    if (!file) return;
    setError("");
    setResumeFileUploading(true);
    try {
      const payload = await extractTextFromUpload(file, "resume");
      setResumeText(payload.job_description || "");
      setResumeUploadedFileName(payload.file_name || file.name);
    } catch (uploadError) {
      setResumeText("");
      setResumeUploadedFileName("");
      setError(uploadError instanceof Error ? uploadError.message : "Unable to extract text from the resume file.");
    } finally {
      setResumeFileUploading(false);
    }
  };

  const handleUploadJdFile = async (file: File | null) => {
    if (!file) return;
    setError("");
    setJdFileUploading(true);
    try {
      const payload = await extractTextFromUpload(file, "jd");
      setJdInput(payload.job_description || "");
      setJdUploadedFileName(payload.file_name || file.name);
    } catch (uploadError) {
      setJdInput("");
      setJdUploadedFileName("");
      setError(uploadError instanceof Error ? uploadError.message : "Unable to extract text from the JD file.");
    } finally {
      setJdFileUploading(false);
    }
  };

  const handleRunMatcher = async () => {
    if (resumeText.trim().length < 24) {
      setError("Resume content is required. Paste the text or upload a file.");
      return;
    }
    if (jdInput.trim().length < 24) {
      setError("Job description content is required. Paste the text or upload a file.");
      return;
    }

    setError("");
    setLoading(true);
    setResult(null);
    setWorkspaceNote("");
    setSavedTrackId(null);

    try {
      let authToken = guestSessionToken.trim();
      if (!authToken) {
        authToken = await bootstrapGuestWorkspace();
      }
      if (authToken) {
        setGuestSessionToken(authToken);
      }

      const payload = await fetchJsonWithWakeAndRetry<MatcherPayload>({
        apiUrl,
        path: "/analysis/application-copilot",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            industry: "General",
            role: "Target role",
            company: "",
            resume_text: resumeText.trim(),
            job_description: jdInput.trim(),
            auth_token: authToken || undefined,
          }),
        },
        timeoutMs: REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Resume scoring is taking longer than expected. Please try again.",
      });

      const nextResult = {
        ...payload,
        role: payload.role || "Target role",
        industry: payload.industry || "General",
      };
      setResult(nextResult);

      if (authToken) {
        try {
          const trackId = await saveScoreCheckToDashboard(authToken, nextResult);
          setSavedTrackId(trackId);
          setWorkspaceNote("Saved to your dashboard. No signup needed.");
        } catch {
          setWorkspaceNote("Score ready. We could not save this run to your dashboard just yet.");
        }
      } else {
        setWorkspaceNote("Score ready. We'll connect it to your dashboard as soon as the guest workspace is available.");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to run the score check right now.");
      setWorkspaceNote("");
    } finally {
      setLoading(false);
    }
  };

  const canRunMatcher =
    resumeText.trim().length >= 24 &&
    jdInput.trim().length >= 24 &&
    !resumeFileUploading &&
    !jdFileUploading &&
    !loading;

  const score = Math.max(0, Math.min(100, Math.round(result?.match_percentage || 0)));
  const statusTone = statusToneForScore(score);

  const topReasons = useMemo(() => {
    if (!result) return [];

    const reasons: string[] = [];
    const normalizedInsights = [...(result.feedback || []), ...(result.resume_improvements || [])]
      .map(sentenceCase)
      .filter(Boolean);

    if ((result.missing_skills || []).length > 0) {
      reasons.push(`Missing required skills (${result.missing_skills.slice(0, 2).join(", ")})`);
    } else {
      reasons.push("Missing key skills for this job description");
    }

    const experienceReason =
      normalizedInsights.find((line) => /experience|year|seniority|senior|junior|required level|qualification/i.test(line)) ||
      "Experience below job requirement";
    reasons.push(experienceReason);

    const tailoringReason =
      normalizedInsights.find((line) => /tailor|tailored|job description|jd|keyword|alignment|relevance|position|role fit/i.test(line)) ||
      "Resume not tailored to job description";
    reasons.push(tailoringReason);

    const uniqueReasons: string[] = [];
    for (const reason of reasons) {
      if (!reason) continue;
      if (!uniqueReasons.includes(reason)) {
        uniqueReasons.push(reason);
      }
    }

    return uniqueReasons.slice(0, 3);
  }, [result]);

  const lockedPlanLines = useMemo(() => {
    if (!result) {
      return [
        "Rewrite your strongest bullets around the job description.",
        "Add evidence for the missing hard skills recruiters expect.",
        "Move role-specific keywords higher in the resume.",
      ];
    }

    const lines = [...(result.resume_improvements || []), ...(result.feedback || [])]
      .map(sentenceCase)
      .filter(Boolean);

    return (lines.length > 0 ? lines : [
      "Rewrite your strongest bullets around the job description.",
      "Add evidence for the missing hard skills recruiters expect.",
      "Move role-specific keywords higher in the resume.",
    ]).slice(0, 3);
  }, [result]);

  return (
    <section className="grid gap-6 lg:grid-cols-[0.94fr_1.06fr]">
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

      <section className="editorial-panel rounded-[2rem] p-6 sm:p-7">
        <p className="inline-flex rounded-full bg-black px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
          Input
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[#111111]">
          Upload your resume and paste the job description
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-black/66">
          Get your score first, then continue from your dashboard without signup.
        </p>

        <div className="mt-6 space-y-5">
          <div className="rounded-[1.6rem] border border-black/8 bg-white/88 p-4">
            <label className="mb-2 block text-sm font-semibold text-[#111111]">Resume</label>
            <textarea
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              placeholder="Paste your resume text here."
              className={textAreaClass}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => resumeFileInputRef.current?.click()}
                disabled={resumeFileUploading || loading}
                className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
              >
                {resumeFileUploading ? "Extracting resume..." : "Upload resume"}
              </button>
              {resumeUploadedFileName ? <span className="text-xs text-black/52">Loaded: {resumeUploadedFileName}</span> : null}
            </div>
          </div>

          <div className="rounded-[1.6rem] border border-black/8 bg-white/88 p-4">
            <label className="mb-2 block text-sm font-semibold text-[#111111]">Job description</label>
            <textarea
              value={jdInput}
              onChange={(event) => setJdInput(event.target.value)}
              placeholder="Paste the job description here."
              className={textAreaClass}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => jdFileInputRef.current?.click()}
                disabled={jdFileUploading || loading}
                className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
              >
                {jdFileUploading ? "Extracting JD..." : "Upload JD"}
              </button>
              {jdUploadedFileName ? <span className="text-xs text-black/52">Loaded: {jdUploadedFileName}</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-7">
          <button
            type="button"
            onClick={() => void handleRunMatcher()}
            disabled={!canRunMatcher}
            className="inline-flex w-full items-center justify-center rounded-full border border-black bg-black px-7 py-4 text-base font-semibold text-white shadow-[0_20px_34px_rgba(17,17,17,0.12)] transition hover:-translate-y-0.5 hover:bg-[#1a1a1a] disabled:opacity-60 sm:w-auto"
          >
            {loading ? "Checking your resume..." : "Check My Resume Score (Free)"}
          </button>
          <p className="mt-3 text-sm font-medium text-black/58">Takes 30 seconds • No signup required</p>
          <p className="mt-2 text-sm text-black/52">Your resume is private and not stored</p>
        </div>

        {error ? <p className="mt-4 text-sm text-[#b91c1c]">{error}</p> : null}
        {!error && workspaceNote ? <p className="mt-4 text-sm text-black/62">{workspaceNote}</p> : null}
      </section>

      <section className="editorial-panel rounded-[2rem] p-6 sm:p-7">
        <p className="inline-flex rounded-full bg-black px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
          Result
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[#111111]">See the decision first</h2>
        <p className="mt-3 text-sm leading-relaxed text-black/66">
          The first result answers the core question: likely rejected, borderline, or strong match.
        </p>

        {loading ? (
          <div className="mt-6 rounded-[1.8rem] border border-black/10 bg-[linear-gradient(180deg,#ffffff_0%,#f7f7f4_100%)] p-6">
            <div className="loading-bar h-4 w-28" />
            <div className="loading-bar mt-5 h-16 w-40" />
            <div className="loading-bar mt-5 h-10 w-44" />
            <div className="mt-6 space-y-3">
              <div className="loading-bar h-14" />
              <div className="loading-bar h-14 w-[92%]" />
              <div className="loading-bar h-14 w-[85%]" />
            </div>
          </div>
        ) : result ? (
          <div className={`fade-up-card mt-6 rounded-[1.8rem] border ${statusTone.borderClass} ${statusTone.backgroundClass} p-6 shadow-[0_24px_48px_rgba(17,17,17,0.05)]`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#111111]">Your Hiring Score</p>
                <p className="mt-4 text-6xl font-semibold tracking-[-0.05em] text-[#111111] sm:text-7xl">{score}/100</p>
              </div>

              <span className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold ${statusTone.badgeClass}`}>
                {statusTone.label}
              </span>
            </div>

            <div className="mt-7">
              <p className="text-xs uppercase tracking-[0.16em] text-black/54">Top Reasons</p>
              <ol className="mt-4 space-y-3">
                {topReasons.map((reason, index) => (
                  <li
                    key={reason}
                    className="flex items-start gap-3 rounded-[1.15rem] border border-black/8 bg-white px-4 py-3 text-sm leading-relaxed text-[#111111]"
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-semibold text-white">
                      0{index + 1}
                    </span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="relative mt-6 overflow-hidden rounded-[1.5rem] border border-black/8 bg-[#f6f6f6] p-5">
              <div className="space-y-3 blur-[6px] opacity-50 select-none">
                {lockedPlanLines.map((line, index) => (
                  <div key={`${line}-${index}`} className="rounded-[1rem] bg-white px-4 py-3 text-sm text-black/72">
                    {line}
                  </div>
                ))}
              </div>

              <div className="absolute inset-0 bg-gradient-to-t from-[#f6f6f6] via-[#f6f6f6]/94 to-transparent" />
              <div className="absolute inset-x-4 bottom-4 rounded-[1.15rem] border border-black/10 bg-white/96 px-4 py-3 shadow-[0_12px_24px_rgba(17,17,17,0.06)]">
                <p className="text-sm font-semibold text-[#111111]">Open the full improvement plan in dashboard</p>
                <p className="mt-1 text-xs text-black/52">Your score check is saved first, then you can continue from there.</p>
              </div>
            </div>

            <p className="mt-5 text-sm font-medium text-black/64">
              {workspaceNote || "This score check runs without signup. Your guest dashboard is ready automatically."}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-full border border-black bg-black px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#1a1a1a]"
              >
                Open Dashboard
              </Link>
              <p className="text-xs text-black/52">
                {savedTrackId
                  ? `Saved as score check #${savedTrackId} in your dashboard.`
                  : "Saved to your dashboard once the guest workspace is ready."}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-[1.8rem] border border-black/10 bg-[linear-gradient(180deg,#ffffff_0%,#f7f7f4_100%)] p-6">
            <p className="text-sm leading-relaxed text-black/66">
              Upload your resume and paste the job description to see whether this application looks likely to be rejected or shortlisted.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}
