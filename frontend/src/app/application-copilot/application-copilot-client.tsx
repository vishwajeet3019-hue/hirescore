"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";

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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const REQUEST_TIMEOUT_MS = 70_000;
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const fieldClass =
  "w-full rounded-[1.4rem] border border-[#d8ccb9] bg-[#fffaf3] px-4 py-3 text-sm text-[#203528] outline-none transition focus:border-[#8fa08b] focus:bg-white";
const textAreaClass = `${fieldClass} min-h-[180px] resize-y leading-relaxed`;

export default function ApplicationCopilotClient() {
  const [role, setRole] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [jdInput, setJdInput] = useState("");
  const [resumeUploadedFileName, setResumeUploadedFileName] = useState("");
  const [jdUploadedFileName, setJdUploadedFileName] = useState("");
  const [resumeFileUploading, setResumeFileUploading] = useState(false);
  const [jdFileUploading, setJdFileUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MatcherPayload | null>(null);

  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void warmBackend(apiUrl);
  }, []);

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

    try {
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
            role: role.trim() || "Target role",
            company: "",
            resume_text: resumeText.trim(),
            job_description: jdInput.trim(),
          }),
        },
        timeoutMs: REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Resume matching is taking longer than expected. Please try again.",
      });

      setResult({
        ...payload,
        role: role.trim() || payload.role || "Target role",
        industry: payload.industry || "General",
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to run the matcher right now.");
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

  const metricCards = useMemo(
    () => [
      { label: "Resume match", value: result?.match_percentage || 0 },
      { label: "Critical coverage", value: result?.jd_match?.critical_coverage || 0 },
      { label: "Must-have coverage", value: result?.jd_match?.must_have_coverage || 0 },
      { label: "JD relevance", value: result?.jd_match?.jd_relevance || 0 },
    ],
    [result],
  );

  const suggestions = useMemo(() => {
    const nextSuggestions: string[] = [];
    for (const item of result?.resume_improvements || []) {
      const clean = item.trim();
      if (clean && !nextSuggestions.includes(clean)) {
        nextSuggestions.push(clean);
      }
    }
    for (const item of result?.feedback || []) {
      const clean = item.trim();
      if (clean && !nextSuggestions.includes(clean)) {
        nextSuggestions.push(clean);
      }
    }
    return nextSuggestions.slice(0, 8);
  }, [result]);

  return (
    <section className="grid gap-5 lg:grid-cols-[0.96fr_1.04fr]">
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

      <section className="surface-panel rounded-[2rem] p-6 sm:p-7">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#7a846e]">Input</p>
        <h2 className="mt-3 text-2xl font-semibold text-[#203528]">Paste your resume and the job description</h2>
        <p className="mt-3 text-sm leading-relaxed text-[#52604d]">
          The matcher is temporarily free. Upload PDF, TXT, or image files, or paste the content directly.
        </p>

        <div className="mt-5 space-y-4">
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="Target role (optional)"
            className={fieldClass}
          />

          <div className="space-y-2">
            <textarea
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              placeholder="Paste your resume text here."
              className={textAreaClass}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => resumeFileInputRef.current?.click()}
                disabled={resumeFileUploading || loading}
                className="rounded-full border border-[#d8ccb9] bg-white px-4 py-2 text-sm font-semibold text-[#203528] transition hover:bg-[#f7efe3] disabled:opacity-60"
              >
                {resumeFileUploading ? "Extracting resume..." : "Upload resume"}
              </button>
              {resumeUploadedFileName ? <span className="text-xs text-[#677463]">Loaded: {resumeUploadedFileName}</span> : null}
            </div>
          </div>

          <div className="space-y-2">
            <textarea
              value={jdInput}
              onChange={(event) => setJdInput(event.target.value)}
              placeholder="Paste the job description here."
              className={textAreaClass}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => jdFileInputRef.current?.click()}
                disabled={jdFileUploading || loading}
                className="rounded-full border border-[#d8ccb9] bg-white px-4 py-2 text-sm font-semibold text-[#203528] transition hover:bg-[#f7efe3] disabled:opacity-60"
              >
                {jdFileUploading ? "Extracting JD..." : "Upload JD"}
              </button>
              {jdUploadedFileName ? <span className="text-xs text-[#677463]">Loaded: {jdUploadedFileName}</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleRunMatcher()}
            disabled={!canRunMatcher}
            className="rounded-full bg-[#355e46] px-6 py-3 text-sm font-semibold text-[#f8f4ec] shadow-[0_18px_28px_rgba(53,94,70,0.18)] transition hover:bg-[#2d503c] disabled:opacity-60"
          >
            {loading ? "Running matcher..." : "Run Resume Matcher"}
          </button>
          <p className="text-xs text-[#677463]">You will get a score, missing skills, and shortlist-focused suggestions.</p>
        </div>

        {error ? <p className="mt-4 text-sm text-[#a04e34]">{error}</p> : null}
      </section>

      <section className="surface-panel rounded-[2rem] p-6 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#7a846e]">Output</p>
            <h2 className="mt-3 text-2xl font-semibold text-[#203528]">Score and suggestions</h2>
          </div>
        </div>

        {loading ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-[1.6rem] border border-[#ddd0ba] bg-[#fffaf3] p-5">
              <div className="loading-bar h-4 w-24" />
              <div className="loading-bar mt-4 h-12 w-36" />
              <div className="loading-bar mt-4 h-4 w-full" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="rounded-[1.4rem] border border-[#ddd0ba] bg-[#fffaf3] p-4">
                  <div className="loading-bar h-3 w-24" />
                  <div className="loading-bar mt-4 h-8 w-20" />
                </div>
              ))}
            </div>
            <div className="rounded-[1.4rem] border border-[#ddd0ba] bg-[#fffaf3] p-4">
              <div className="loading-bar h-3 w-28" />
              <div className="mt-4 space-y-2">
                <div className="loading-bar h-3" />
                <div className="loading-bar h-3 w-[88%]" />
                <div className="loading-bar h-3 w-[72%]" />
              </div>
            </div>
          </div>
        ) : result ? (
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
              <div className="accent-panel rounded-[1.6rem] p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Resume match</p>
                <p className="mt-3 text-5xl font-semibold text-[#203528]">
                  {Math.max(0, Math.min(100, Math.round(result.match_percentage || 0)))}%
                </p>
              </div>

              <div className="rounded-[1.6rem] border border-[#ddd0ba] bg-[#fffaf3] p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Summary</p>
                <p className="mt-3 text-sm leading-relaxed text-[#52604d]">
                  {result.jd_match?.alignment_summary || "Your score is ready along with the gaps and suggestions to improve the application."}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards.map((metric) => (
                <article key={metric.label} className="rounded-[1.4rem] border border-[#ddd0ba] bg-[#fffaf3] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">{metric.label}</p>
                  <p className="mt-3 text-2xl font-semibold text-[#203528]">{Math.max(0, Math.min(100, Math.round(metric.value || 0)))}%</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ece2d2]">
                    <div
                      className="h-full rounded-full bg-[#355e46] transition-all duration-500"
                      style={{ width: `${Math.max(0, Math.min(100, metric.value || 0))}%` }}
                    />
                  </div>
                </article>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <article className="rounded-[1.6rem] border border-[#ddd0ba] bg-[#fffaf3] p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Matched skills</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(result.matched_skills || []).length > 0 ? (
                    result.matched_skills.slice(0, 18).map((skill) => (
                      <span key={`matched-${skill}`} className="rounded-full bg-[#e6efe8] px-3 py-1.5 text-xs font-medium text-[#274837]">
                        {skill}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-[#677463]">No matched skills were surfaced for this input.</p>
                  )}
                </div>
              </article>

              <article className="rounded-[1.6rem] border border-[#ddd0ba] bg-[#fffaf3] p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Missing skills</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(result.missing_skills || []).length > 0 ? (
                    result.missing_skills.slice(0, 18).map((skill) => (
                      <span key={`missing-${skill}`} className="rounded-full bg-[#f4e0d5] px-3 py-1.5 text-xs font-medium text-[#9b4f35]">
                        {skill}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-[#677463]">No major missing skills were surfaced for this input.</p>
                  )}
                </div>
              </article>
            </div>

            <article className="rounded-[1.6rem] border border-[#ddd0ba] bg-[#fffaf3] p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Suggestions</p>
              <ol className="mt-4 space-y-3">
                {suggestions.length > 0 ? (
                  suggestions.map((item, index) => (
                    <li key={`suggestion-${index}`} className="rounded-[1.2rem] border border-[#eadfce] bg-white px-4 py-3 text-sm leading-relaxed text-[#203528]">
                      <span className="mr-2 font-semibold text-[#355e46]">{index + 1}.</span>
                      {item}
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-[#677463]">Suggestions will appear here after the matcher runs.</li>
                )}
              </ol>
            </article>
          </div>
        ) : (
          <div className="mt-6 rounded-[1.6rem] border border-[#ddd0ba] bg-[#fffaf3] p-5">
            <p className="text-sm leading-relaxed text-[#52604d]">
              Run the matcher to see the score, the missing skills, and the suggestions to improve this application.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}
