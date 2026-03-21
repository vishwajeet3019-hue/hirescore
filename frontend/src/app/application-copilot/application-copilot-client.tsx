"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { ensurePublicAccessSession, setStoredPublicAccessName } from "@/lib/public-access";

type MatcherPayload = {
  role: string;
  industry: string;
  match_percentage: number;
  matched_skills: string[];
  missing_skills: string[];
  feedback: string[];
  resume_improvements: string[];
  next_steps_7_day?: string[];
  skills_analysis?: {
    matched?: {
      must_have?: string[];
      supporting?: string[];
      evidence?: Record<string, string[]>;
    };
    missing?: {
      must_have?: string[];
      supporting?: string[];
    };
    gap_to_90?: {
      current_score?: number;
      target_score?: number;
      points_needed?: number;
      gap_severity?: string;
      summary?: string;
      priority_actions?: string[];
    };
    coverage?: {
      must_have?: number;
      good_to_have?: number;
      critical?: number;
    };
  };
  jd_match?: {
    critical_coverage?: number;
    must_have_coverage?: number;
    good_to_have_coverage?: number;
    gap_severity?: string;
    matched_must_have_skills?: string[];
    missing_must_have_skills?: string[];
    matched_good_to_have_skills?: string[];
    missing_good_to_have_skills?: string[];
    matched_skill_evidence?: Record<string, string[]>;
    jd_relevance?: number;
    alignment_summary?: string;
  };
};

type ExtractPayload = {
  job_description: string;
  extracted_chars: number;
  file_name: string;
  file_type?: string;
  candidate_name?: string;
};

type ApiErrorPayload = {
  detail?: string | { message?: string };
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

const clampPercent = (value: number | undefined) => Math.max(0, Math.min(100, Math.round(value || 0)));

const gapSeverityLabel = (value: string | undefined) => {
  if (!value) return "";
  if (value === "high") return "High gap";
  if (value === "low") return "Low gap";
  return "Medium gap";
};

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

function MetricBar({ label, value }: { label: string; value: number | undefined }) {
  const safeValue = clampPercent(value);

  return (
    <div className="rounded-[1.1rem] border border-black/8 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-sm text-[#111111]">
        <span>{label}</span>
        <span className="font-semibold">{safeValue}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/8">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#111111_0%,#545454_100%)] transition-all duration-700"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}

export default function ApplicationCopilotClient() {
  const [resumeText, setResumeText] = useState("");
  const [jdInput, setJdInput] = useState("");
  const [resumeUploadedFileName, setResumeUploadedFileName] = useState("");
  const [jdUploadedFileName, setJdUploadedFileName] = useState("");
  const [capturedName, setCapturedName] = useState("");
  const [resumeFileUploading, setResumeFileUploading] = useState(false);
  const [jdFileUploading, setJdFileUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MatcherPayload | null>(null);
  const [guestSessionToken, setGuestSessionToken] = useState("");

  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);

  const ensureGuestWorkspaceToken = useCallback(async () => {
    const existing = guestSessionToken.trim();
    if (existing) {
      return existing;
    }
    const token = ((await ensurePublicAccessSession()) || "").trim();
    if (token) {
      setGuestSessionToken(token);
    }
    return token;
  }, [guestSessionToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void warmBackend(apiUrl);
      void ensureGuestWorkspaceToken();
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [ensureGuestWorkspaceToken]);

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
      formData.append("kind", context === "resume" ? "resume" : "jd");

      const authToken = await ensureGuestWorkspaceToken();
      if (authToken) {
        formData.append("auth_token", authToken);
      }

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
    [ensureGuestWorkspaceToken, parseApiError],
  );

  const handleUploadResumeFile = async (file: File | null) => {
    if (!file) return;
    setError("");
    setCapturedName("");
    setResumeFileUploading(true);
    try {
      const payload = await extractTextFromUpload(file, "resume");
      setResumeText(payload.job_description || "");
      setResumeUploadedFileName(payload.file_name || file.name);
      const nextName = payload.candidate_name?.trim() || "";
      if (nextName) {
        setCapturedName(nextName);
        setStoredPublicAccessName(nextName);
      }
    } catch (uploadError) {
      setResumeText("");
      setResumeUploadedFileName("");
      setCapturedName("");
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

    try {
      let authToken = guestSessionToken.trim();
      if (!authToken) {
        authToken = await ensureGuestWorkspaceToken();
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
      const inferredName = capturedName.trim();
      if (inferredName) {
        setStoredPublicAccessName(inferredName);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to run the score check right now.");
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

  const score = clampPercent(result?.match_percentage);
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

  const matchedMustHave = useMemo(
    () => result?.skills_analysis?.matched?.must_have || result?.jd_match?.matched_must_have_skills || [],
    [result],
  );

  const matchedSupporting = useMemo(() => {
    const base = result?.skills_analysis?.matched?.supporting || result?.jd_match?.matched_good_to_have_skills || result?.matched_skills || [];
    return Array.from(new Set(base)).slice(0, 10);
  }, [result]);

  const missingMustHave = useMemo(
    () => result?.skills_analysis?.missing?.must_have || result?.jd_match?.missing_must_have_skills || [],
    [result],
  );

  const missingSupporting = useMemo(() => {
    const base = result?.skills_analysis?.missing?.supporting || result?.jd_match?.missing_good_to_have_skills || result?.missing_skills || [];
    return Array.from(new Set(base)).slice(0, 10);
  }, [result]);

  const matchedEvidenceEntries = useMemo(() => {
    const evidence = result?.skills_analysis?.matched?.evidence || result?.jd_match?.matched_skill_evidence || {};
    return Object.entries(evidence).filter(([, lines]) => lines.length > 0).slice(0, 3);
  }, [result]);

  const gapSeverity = result?.skills_analysis?.gap_to_90?.gap_severity || result?.jd_match?.gap_severity;
  const targetScore = result?.skills_analysis?.gap_to_90?.target_score || 90;
  const pointsToTarget = result?.skills_analysis?.gap_to_90?.points_needed ?? Math.max(0, targetScore - score);

  const gapSummary = useMemo(() => {
    const summary = sentenceCase(result?.skills_analysis?.gap_to_90?.summary || "");
    if (summary) return summary;
    if (pointsToTarget === 0) {
      return `You are already at ${targetScore}/100 or above. Focus on sharpening clarity and proof.`;
    }
    if (missingMustHave.length > 0) {
      return `Closing the missing must-have skills is the fastest path to ${targetScore}/100.`;
    }
    return `You are ${pointsToTarget} points away from ${targetScore}/100. Stronger quantified bullets and tighter JD alignment should create the biggest lift.`;
  }, [missingMustHave.length, pointsToTarget, result?.skills_analysis?.gap_to_90?.summary, targetScore]);

  const improvementPlan = useMemo(() => {
    const priorityActions = (result?.skills_analysis?.gap_to_90?.priority_actions || []).map(sentenceCase).filter(Boolean);
    if (priorityActions.length > 0) {
      return priorityActions.slice(0, 4);
    }

    const fallback = [
      ...(missingMustHave.length > 0
        ? [`Add direct proof for ${missingMustHave.slice(0, 3).join(", ")} in your summary and latest experience bullets.`]
        : []),
      ...(missingSupporting.length > 0
        ? [`Add supporting evidence for ${missingSupporting.slice(0, 3).join(", ")} through projects, certifications, or quantified work.`]
        : []),
      ...(matchedMustHave.length > 0
        ? [`Keep ${matchedMustHave.slice(0, 2).join(" and ")} prominent, but strengthen them with metrics and business outcomes.`]
        : []),
      ...[...(result?.resume_improvements || []), ...(result?.next_steps_7_day || []), ...(result?.feedback || [])]
        .map(sentenceCase)
        .filter(Boolean),
    ];

    return Array.from(new Set(fallback)).slice(0, 4);
  }, [matchedMustHave, missingMustHave, missingSupporting, result]);

  const metrics = useMemo(
    () => [
      { label: "Role Match", value: score },
      { label: "Must-Have Coverage", value: result?.skills_analysis?.coverage?.must_have ?? result?.jd_match?.must_have_coverage },
      { label: "Good-To-Have Coverage", value: result?.skills_analysis?.coverage?.good_to_have ?? result?.jd_match?.good_to_have_coverage },
      { label: "Critical Coverage", value: result?.skills_analysis?.coverage?.critical ?? result?.jd_match?.critical_coverage },
    ],
    [result, score],
  );

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
          Get your score and full improvement plan here without signup.
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
              {resumeUploadedFileName ? (
                <span className="text-xs text-black/52">
                  Loaded: {resumeUploadedFileName}
                  {capturedName ? ` • Name captured: ${capturedName}` : ""}
                </span>
              ) : null}
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

              <div className="flex flex-col items-start gap-2 sm:items-end">
                <span className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold ${statusTone.badgeClass}`}>
                  {statusTone.label}
                </span>
                <span className="inline-flex rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[#111111]">
                  {pointsToTarget === 0 ? `${targetScore}+ reached` : `${pointsToTarget} points away from ${targetScore}`}
                </span>
              </div>
            </div>

            <div className="mt-6 rounded-[1.4rem] border border-black/8 bg-white/96 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs uppercase tracking-[0.16em] text-black/54">Fit Summary</p>
                {gapSeverity ? (
                  <span className="rounded-full border border-black/10 bg-[#f6f6f6] px-2.5 py-1 text-[11px] font-semibold text-black/62">
                    {gapSeverityLabel(gapSeverity)}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-black/72">
                {sentenceCase(result.jd_match?.alignment_summary || "") || "Role-fit summary generated."}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {metrics.map((metric) => (
                  <MetricBar key={metric.label} label={metric.label} value={metric.value} />
                ))}
              </div>
            </div>

            <div className="mt-6">
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

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <article className="rounded-[1.45rem] border border-black/8 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-semibold text-[#111111]">Skills Matching</p>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    {matchedMustHave.length} must-have matched
                  </span>
                </div>

                <p className="mt-4 text-xs uppercase tracking-[0.14em] text-black/48">Role-critical matches</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {matchedMustHave.length > 0 ? (
                    matchedMustHave.slice(0, 8).map((skill) => (
                      <span
                        key={`matched-must-${skill}`}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"
                      >
                        {skill}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-black/58">No clear must-have matches detected yet.</p>
                  )}
                </div>

                <p className="mt-5 text-xs uppercase tracking-[0.14em] text-black/48">Supporting matches</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {matchedSupporting.length > 0 ? (
                    matchedSupporting.slice(0, 10).map((skill) => (
                      <span
                        key={`matched-support-${skill}`}
                        className="rounded-full border border-black/10 bg-[#f6f6f6] px-3 py-1.5 text-xs font-medium text-black/72"
                      >
                        {skill}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-black/58">Add more role-specific proof to surface stronger matches.</p>
                  )}
                </div>

                {matchedEvidenceEntries.length > 0 ? (
                  <div className="mt-5 space-y-2.5">
                    <p className="text-xs uppercase tracking-[0.14em] text-black/48">Evidence found in resume</p>
                    {matchedEvidenceEntries.map(([skill, lines]) => (
                      <div key={`evidence-${skill}`} className="rounded-[1rem] border border-black/8 bg-[#faf9f7] px-4 py-3">
                        <p className="text-sm font-semibold text-[#111111]">{skill}</p>
                        <p className="mt-1 text-sm leading-relaxed text-black/62">{lines[0]}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>

              <article className="rounded-[1.45rem] border border-black/8 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-semibold text-[#111111]">Skills Lacking</p>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    {missingMustHave.length} must-have gaps
                  </span>
                </div>

                <p className="mt-4 text-xs uppercase tracking-[0.14em] text-black/48">Missing must-have skills</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {missingMustHave.length > 0 ? (
                    missingMustHave.slice(0, 8).map((skill) => (
                      <span
                        key={`missing-must-${skill}`}
                        className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
                      >
                        {skill}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-black/58">No major must-have gaps detected.</p>
                  )}
                </div>

                <p className="mt-5 text-xs uppercase tracking-[0.14em] text-black/48">Secondary gaps</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {missingSupporting.length > 0 ? (
                    missingSupporting.slice(0, 10).map((skill) => (
                      <span
                        key={`missing-support-${skill}`}
                        className="rounded-full border border-black/10 bg-[#f6f6f6] px-3 py-1.5 text-xs font-medium text-black/72"
                      >
                        {skill}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-black/58">Secondary skill coverage looks stable for this JD.</p>
                  )}
                </div>

                <div className="mt-5 rounded-[1rem] border border-black/8 bg-[#faf9f7] px-4 py-3">
                  <p className="text-sm font-semibold text-[#111111]">What is blocking a stronger score?</p>
                  <p className="mt-1 text-sm leading-relaxed text-black/62">
                    {missingMustHave.length > 0
                      ? `The score is being held back mainly by missing must-have skills such as ${missingMustHave.slice(0, 3).join(", ")}.`
                      : "The score is likely being limited more by proof quality, metric density, and role-specific phrasing than by pure skill gaps."}
                  </p>
                </div>
              </article>
            </div>

            <div className="relative mt-6 overflow-hidden rounded-[1.5rem] border border-black/8 bg-[#f6f6f6] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-[#111111]">Improvement Needed To Reach {targetScore}/100</p>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-black/62">{gapSummary}</p>
                </div>
                <span className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm font-semibold text-[#111111]">
                  {pointsToTarget === 0 ? "Target met" : `Need +${pointsToTarget}`}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {improvementPlan.map((line, index) => (
                  <div key={`${line}-${index}`} className="rounded-[1rem] bg-white px-4 py-3 text-sm text-black/72">
                    <span className="font-semibold text-black/80">Priority {index + 1}:</span> {line}
                  </div>
                ))}
              </div>

              {(result.next_steps_7_day || []).length > 0 ? (
                <div className="mt-4 rounded-[1.15rem] border border-black/10 bg-white/96 px-4 py-3 shadow-[0_12px_24px_rgba(17,17,17,0.06)]">
                  <p className="text-sm font-semibold text-[#111111]">Recommended next 7 days</p>
                  <div className="mt-2 space-y-1.5">
                    {(result.next_steps_7_day || []).slice(0, 3).map((step) => (
                      <p key={step} className="text-xs leading-relaxed text-black/56">
                        {sentenceCase(step)}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
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
