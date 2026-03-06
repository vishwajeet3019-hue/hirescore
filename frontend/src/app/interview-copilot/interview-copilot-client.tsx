"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { addUtmParams } from "@/lib/utm";
import TrackedLink from "../components/tracked-link";

type CreditWallet = {
  credits: number;
  pricing: {
    analyze: number;
    jd_match: number;
    ai_resume_generation: number;
    template_pdf_download: number;
    interview_prep?: number;
  };
};

type AuthPayload = {
  user?: {
    email?: string;
  };
  wallet?: CreditWallet;
};

type InterviewPrepPayload = {
  role: string;
  industry: string;
  focus_skills: string[];
  coach_note: string;
  coach_note_ai_generated?: boolean;
  mock_questions: string[];
  prep_sprint: string[];
  star_drills?: { title: string; prompt: string }[];
  ai?: {
    used?: boolean;
    model?: string | null;
    reason?: string;
  };
};

type ApplicationPackPayload = {
  role: string;
  industry: string;
  subject_line: string;
  outreach_email: string;
  linkedin_message: string;
  cover_letter_opening: string;
  jd_focus_keywords: string[];
  application_checklist: string[];
  recruiter_follow_up?: string;
  ai?: {
    used?: boolean;
    model?: string | null;
    reason?: string;
  };
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
const INTERVIEW_COPILOT_MIN_LOADING_MS = 4800;
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const fieldClass =
  "w-full rounded-xl border border-cyan-100/26 bg-[#081f38]/76 px-3 py-2.5 text-sm text-cyan-50 placeholder:text-cyan-100/34 outline-none transition focus:border-cyan-100/62";

const textAreaClass = `${fieldClass} min-h-[130px] leading-relaxed`;

const parseCriticalSkills = (value: string) =>
  value
    .split(/[,\n;/|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 10);

export default function InterviewCopilotClient() {
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
  const [criticalSkillsInput, setCriticalSkillsInput] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState("");
  const [interviewPrep, setInterviewPrep] = useState<InterviewPrepPayload | null>(null);
  const [applicationPack, setApplicationPack] = useState<ApplicationPackPayload | null>(null);
  const [outputView, setOutputView] = useState<"briefing" | "prep" | "pack">("briefing");
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);

  const authHeader = useMemo(() => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined), [authToken]);

  const openAnalysisHref = addUtmParams("/upload", {
    source: "interview_copilot_page",
    medium: "internal",
    campaign: "interview_copilot",
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
        setAuthError("Login required to run Interview Copilot.");
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
    setCopilotError("");
    setInterviewPrep(null);
    setApplicationPack(null);
    setResumeFileUploading(true);
    try {
      const payload = await extractTextFromUpload(file, "resume");
      setResumeText(payload.job_description || "");
      setResumeUploadedFileName(payload.file_name || file.name);
    } catch (error) {
      setResumeText("");
      setResumeUploadedFileName("");
      setCopilotError(error instanceof Error ? error.message : "Unable to extract text from resume file.");
    } finally {
      setResumeFileUploading(false);
    }
  };

  const handleUploadJdFile = async (file: File | null) => {
    if (!file) return;
    setCopilotError("");
    setInterviewPrep(null);
    setApplicationPack(null);
    setJdFileUploading(true);
    try {
      const payload = await extractTextFromUpload(file, "jd");
      setJdInput(payload.job_description || "");
      setJdUploadedFileName(payload.file_name || file.name);
    } catch (error) {
      setJdInput("");
      setJdUploadedFileName("");
      setCopilotError(error instanceof Error ? error.message : "Unable to extract JD text from uploaded file.");
    } finally {
      setJdFileUploading(false);
    }
  };

  const handleRunCopilot = async () => {
    if (!authToken || !authHeader) {
      setCopilotError("Login required to run Interview Copilot.");
      return;
    }
    if (resumeText.trim().length < 24) {
      setCopilotError("Upload resume file or paste richer resume text before running Interview Copilot.");
      return;
    }

    const criticalMissingSkills = parseCriticalSkills(criticalSkillsInput);
    setCopilotError("");
    setCopilotLoading(true);
    setInterviewPrep(null);
    setApplicationPack(null);

    const startedAt = Date.now();
    try {
      const [prepPayload, packPayload] = await Promise.all([
        fetchJsonWithWakeAndRetry<InterviewPrepPayload>({
          apiUrl,
          path: "/analysis/interview-prep",
          init: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify({
              industry: industry.trim() || "General",
              role: role.trim() || "Target role",
              job_description: jdInput.trim(),
              critical_missing_skills: criticalMissingSkills,
              auth_token: authToken,
            }),
          },
          timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
          parseError: parseApiError,
          abortErrorMessage: "Interview prep generation is taking longer than expected. Please try again.",
        }),
        fetchJsonWithWakeAndRetry<ApplicationPackPayload>({
          apiUrl,
          path: "/analysis/application-pack",
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
          abortErrorMessage: "Application pack generation is taking longer than expected. Please try again.",
        }),
      ]);

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < INTERVIEW_COPILOT_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, INTERVIEW_COPILOT_MIN_LOADING_MS - elapsedMs);
        });
      }

      setInterviewPrep(prepPayload);
      setApplicationPack(packPayload);
      setOutputView("briefing");
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < INTERVIEW_COPILOT_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, INTERVIEW_COPILOT_MIN_LOADING_MS - elapsedMs);
        });
      }
      setInterviewPrep(null);
      setApplicationPack(null);
      setCopilotError(error instanceof Error ? error.message : "Unable to run Interview Copilot right now.");
    } finally {
      setCopilotLoading(false);
    }
  };

  const canRunCopilot =
    Boolean(authToken) &&
    resumeText.trim().length >= 24 &&
    !resumeFileUploading &&
    !jdFileUploading &&
    !copilotLoading;
  const copilotOutput = useMemo(
    () => (interviewPrep && applicationPack ? { interviewPrep, applicationPack } : null),
    [interviewPrep, applicationPack]
  );
  const hasOutput = Boolean(copilotOutput);

  return (
    <main className="min-h-screen px-4 pb-16 pt-8 sm:px-6 lg:px-8">
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

      <section className="mx-auto max-w-[1320px] rounded-[2rem] border border-cyan-100/22 bg-[linear-gradient(150deg,rgba(8,26,48,0.94),rgba(4,14,30,0.96)_52%,rgba(7,30,52,0.92))] p-6 shadow-[0_20px_54px_rgba(2,8,22,0.48)] sm:p-8">
        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/78">Interview Operations Console</p>
            <h1 className="mt-3 text-3xl font-semibold text-cyan-50 sm:text-5xl">Interview Copilot</h1>
            <p className="mt-3 max-w-3xl text-sm text-cyan-50/78 sm:text-base">
              Convert resume + role context into targeted interview preparation and an application-ready outreach kit.
            </p>
            <p className="mt-4 rounded-xl border border-cyan-100/22 bg-cyan-100/8 px-3 py-2 text-xs text-cyan-100/80">
              Required input: resume content. Optional input: JD and critical skill gaps.
            </p>
          </div>

          <div className="rounded-2xl border border-cyan-100/22 bg-[#061a32]/72 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/72">Session Status</p>
            <p className="mt-2 text-sm text-cyan-50/84">{authEmail ? `Signed in as ${authEmail}` : "Not signed in"}</p>
            <p className="mt-1 text-xs text-cyan-100/74">{wallet ? `Wallet: ${wallet.credits} credits` : "Wallet unavailable"}</p>
            {authError ? (
              <div className="mt-3 rounded-xl border border-amber-100/34 bg-amber-100/12 p-3">
                <p className="text-xs text-amber-50">{authError}</p>
                <TrackedLink
                  href={openAnalysisHref}
                  eventName="cta_check_my_score_click"
                  eventParams={{ cta_location: "interview_copilot_page", cta_label: "Go To Analysis + Login" }}
                  className="mt-3 inline-flex rounded-lg border border-amber-100/40 bg-amber-100/14 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-100/20"
                >
                  Go To Analysis + Login
                </TrackedLink>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-6 grid max-w-[1320px] gap-5 xl:grid-cols-12">
        <aside className="space-y-4 xl:col-span-3">
          <div className="rounded-2xl border border-cyan-100/22 bg-[linear-gradient(160deg,rgba(7,22,43,0.9),rgba(4,14,29,0.95))] p-4 xl:sticky xl:top-24">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Command Deck</p>
            <button
              type="button"
              onClick={() => void handleRunCopilot()}
              disabled={!canRunCopilot}
              className="mt-3 w-full rounded-xl border border-cyan-100/38 bg-gradient-to-r from-cyan-200/20 via-cyan-200/16 to-emerald-200/14 px-3 py-2.5 text-sm font-semibold text-cyan-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {copilotLoading ? "Running Copilot..." : "Run Interview Copilot"}
            </button>

            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => resumeFileInputRef.current?.click()}
                disabled={resumeFileUploading || copilotLoading}
                className="rounded-xl border border-cyan-100/30 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resumeFileUploading ? "Extracting Resume..." : "Upload Resume File"}
              </button>
              <button
                type="button"
                onClick={() => jdFileInputRef.current?.click()}
                disabled={jdFileUploading || copilotLoading}
                className="rounded-xl border border-cyan-100/30 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {jdFileUploading ? "Extracting JD..." : "Upload JD File"}
              </button>
            </div>

            <div className="mt-4 space-y-2 rounded-xl border border-cyan-100/18 bg-cyan-100/6 p-3 text-xs text-cyan-100/78">
              <p>Resume source: {resumeUploadedFileName || "Not imported yet"}</p>
              <p>JD source: {jdUploadedFileName || "Optional"}</p>
              <p>Status: {canRunCopilot ? "Ready to run" : "Add resume content to continue"}</p>
            </div>
            {copilotError && <p className="mt-3 text-xs text-amber-100">{copilotError}</p>}
          </div>
        </aside>

        <section className="space-y-5 xl:col-span-5">
          <article className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(8,24,44,0.88),rgba(5,16,31,0.94))] p-5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Role Brief</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input
                value={industry}
                onChange={(event) => setIndustry(event.target.value)}
                placeholder="Industry (optional)"
                className={fieldClass}
              />
              <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Role (optional)" className={fieldClass} />
            </div>
          </article>

          <article className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(8,24,44,0.88),rgba(5,16,31,0.94))] p-5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Resume Context (Required)</p>
            <textarea
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              placeholder="Paste full resume summary, experience highlights, and skills."
              className={`${textAreaClass} mt-3`}
            />
          </article>

          <article className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(8,24,44,0.88),rgba(5,16,31,0.94))] p-5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Job Context (Optional)</p>
            <textarea
              value={jdInput}
              onChange={(event) => setJdInput(event.target.value)}
              placeholder="Paste target job description to personalize prep and outreach."
              className={`${textAreaClass} mt-3`}
            />
            <textarea
              value={criticalSkillsInput}
              onChange={(event) => setCriticalSkillsInput(event.target.value)}
              placeholder="Critical missing skills (optional): e.g. system design, stakeholder management, roadmap ownership"
              className={`${fieldClass} mt-3 min-h-[88px]`}
            />
          </article>
        </section>

        <section className="xl:col-span-4">
          <article className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(8,24,44,0.88),rgba(5,16,31,0.94))] p-5 xl:sticky xl:top-24">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Output Console</p>
              <div className="inline-flex rounded-xl border border-cyan-100/22 bg-cyan-100/8 p-1">
                <button
                  type="button"
                  onClick={() => setOutputView("briefing")}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    outputView === "briefing" ? "bg-cyan-200/24 text-cyan-50" : "text-cyan-100/72"
                  }`}
                >
                  Briefing
                </button>
                <button
                  type="button"
                  onClick={() => setOutputView("prep")}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    outputView === "prep" ? "bg-cyan-200/24 text-cyan-50" : "text-cyan-100/72"
                  }`}
                >
                  Interview Prep
                </button>
                <button
                  type="button"
                  onClick={() => setOutputView("pack")}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    outputView === "pack" ? "bg-cyan-200/24 text-cyan-50" : "text-cyan-100/72"
                  }`}
                >
                  Apply Pack
                </button>
              </div>
            </div>

            {copilotLoading ? (
              <div className="mt-4 space-y-3 rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-4">
                <p className="text-sm font-semibold text-cyan-50">Synthesizing interview strategy and outreach assets...</p>
                <div className="h-2 overflow-hidden rounded-full border border-cyan-100/22 bg-cyan-100/10">
                  <div className="h-full w-[82%] animate-pulse rounded-full bg-gradient-to-r from-cyan-300/70 via-sky-300/75 to-emerald-200/80" />
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-cyan-100/22 bg-cyan-100/10">
                  <div className="h-full w-[68%] animate-pulse rounded-full bg-gradient-to-r from-cyan-300/70 via-sky-300/75 to-emerald-200/80" />
                </div>
              </div>
            ) : !hasOutput ? (
              <p className="mt-4 text-sm text-cyan-50/72">Run Interview Copilot to generate role-specific prep and messaging outputs.</p>
            ) : copilotOutput ? (
              <>
                {outputView === "briefing" && (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">AI Engine</p>
                      <p className="mt-1 text-sm text-cyan-100/84">
                        {copilotOutput.interviewPrep.ai?.used || copilotOutput.applicationPack.ai?.used
                          ? "Hybrid AI + LLM personalization active"
                          : "Rules-first fallback mode"}
                      </p>
                      {(copilotOutput.interviewPrep.ai?.model || copilotOutput.applicationPack.ai?.model) && (
                        <p className="mt-1 text-xs text-cyan-100/72">
                          Model: {copilotOutput.interviewPrep.ai?.model || copilotOutput.applicationPack.ai?.model}
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Coach Note</p>
                      <p className="mt-1 text-sm text-cyan-100/84">{copilotOutput.interviewPrep.coach_note}</p>
                    </div>
                    <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Focus Skills</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(copilotOutput.interviewPrep.focus_skills || []).slice(0, 8).map((skill) => (
                          <span
                            key={`focus-${skill}`}
                            className="rounded-full border border-cyan-100/26 bg-cyan-100/12 px-2.5 py-1 text-[11px] font-medium text-cyan-50"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {outputView === "prep" && (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Mock Questions</p>
                      <ol className="mt-2 space-y-1 text-sm text-cyan-50/82">
                        {(copilotOutput.interviewPrep.mock_questions || []).slice(0, 6).map((question, index) => (
                          <li key={`question-${index}`}>
                            {index + 1}. {question}
                          </li>
                        ))}
                      </ol>
                    </div>
                    {(copilotOutput.interviewPrep.star_drills || []).length > 0 && (
                      <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">STAR Drills</p>
                        <ul className="mt-2 space-y-1 text-sm text-cyan-50/82">
                          {(copilotOutput.interviewPrep.star_drills || []).slice(0, 4).map((drill, index) => (
                            <li key={`drill-${index}`}>
                              <span className="font-semibold text-cyan-100">{drill.title}:</span> {drill.prompt}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">5-Day Prep Sprint</p>
                      <ol className="mt-2 space-y-1 text-sm text-cyan-50/82">
                        {(copilotOutput.interviewPrep.prep_sprint || []).slice(0, 5).map((step, index) => (
                          <li key={`sprint-${index}`}>
                            {index + 1}. {step}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                )}

                {outputView === "pack" && (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                      <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Subject Line</p>
                      <p className="mt-1 text-sm text-cyan-50/84">{copilotOutput.applicationPack.subject_line}</p>
                      <p className="mt-3 text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">LinkedIn Message</p>
                      <p className="mt-1 text-sm text-cyan-50/84">{copilotOutput.applicationPack.linkedin_message}</p>
                      <p className="mt-3 text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Cover Letter Opening</p>
                      <p className="mt-1 text-sm text-cyan-50/84">{copilotOutput.applicationPack.cover_letter_opening}</p>
                      <p className="mt-3 text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Outreach Email Draft</p>
                      <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-cyan-100/18 bg-[#061a34]/72 p-2 text-xs text-cyan-50/84">
                        {copilotOutput.applicationPack.outreach_email}
                      </pre>
                      {copilotOutput.applicationPack.recruiter_follow_up && (
                        <>
                          <p className="mt-3 text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Recruiter Follow-Up</p>
                          <p className="mt-1 text-sm text-cyan-50/84">{copilotOutput.applicationPack.recruiter_follow_up}</p>
                        </>
                      )}
                      {(copilotOutput.applicationPack.application_checklist || []).length > 0 && (
                        <>
                          <p className="mt-3 text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Checklist</p>
                          <ul className="mt-1 space-y-1 text-sm text-cyan-50/82">
                            {(copilotOutput.applicationPack.application_checklist || []).slice(0, 6).map((item, index) => (
                              <li key={`check-${index}`}>- {item}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </article>
        </section>
      </section>
    </main>
  );
}
