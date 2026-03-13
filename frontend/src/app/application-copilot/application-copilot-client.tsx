"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { addUtmParams } from "@/lib/utm";
import TrackedLink from "../components/tracked-link";

type CreditWallet = {
  credits: number;
  pricing: {
    analyze: number;
    jd_match: number;
  };
};

type AuthPayload = {
  user?: {
    email?: string;
  };
  wallet?: CreditWallet;
};

type ApplicationCopilotPayload = {
  role: string;
  industry: string;
  company?: string;
  match_percentage: number;
  matched_skills: string[];
  missing_skills: string[];
  feedback: string[];
  resume_improvements: string[];
  next_steps_7_day: string[];
  interview_questions: string[];
  jd_focus_keywords: string[];
  application_checklist: string[];
  application_pack?: {
    subject_line?: string;
    linkedin_message?: string;
    cover_letter_opening?: string;
  };
  jd_match?: {
    critical_coverage?: number;
    must_have_coverage?: number;
    good_to_have_coverage?: number;
    jd_relevance?: number;
    alignment_summary?: string;
  };
  ai?: {
    used?: boolean;
    models?: string[];
    engine?: string;
  };
  wallet?: CreditWallet;
  credit_transaction_id?: number;
};

type JobTrack = {
  id: number;
  role: string;
  industry: string;
  company?: string;
  status: string;
  match_percentage: number;
  matched_skills: string[];
  missing_skills: string[];
  feedback: string[];
  next_steps_7_day: string[];
  created_at: string;
  updated_at: string;
  copilot_payload?: ApplicationCopilotPayload;
};

type JobTracksListPayload = {
  job_tracks: JobTrack[];
  count: number;
  status_options?: string[];
};

type JobTrackUpsertPayload = {
  job_track: JobTrack;
};

type JdExtractPayload = {
  job_description: string;
  extracted_chars: number;
  file_name: string;
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
const COPILOT_MIN_LOADING_MS = 4800;
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const statusDisplay = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
const safeTrim = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const fieldClass =
  "w-full rounded-xl border border-cyan-100/28 bg-[#08233f]/72 px-3 py-2.5 text-sm text-cyan-50 placeholder:text-cyan-100/36 outline-none transition focus:border-cyan-100/62";
const textAreaClass = `${fieldClass} min-h-[132px] leading-relaxed`;

export default function ApplicationCopilotClient() {
  const [authToken, setAuthToken] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeUploadedFileName, setResumeUploadedFileName] = useState("");
  const [resumeFileUploading, setResumeFileUploading] = useState(false);
  const [jdInput, setJdInput] = useState("");
  const [jdUploadedFileName, setJdUploadedFileName] = useState("");
  const [jdFileUploading, setJdFileUploading] = useState(false);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState("");
  const [copilotResult, setCopilotResult] = useState<ApplicationCopilotPayload | null>(null);
  const [outputTab, setOutputTab] = useState<"overview" | "plan" | "tracks">("overview");
  const [jobTracks, setJobTracks] = useState<JobTrack[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>(["saved", "applied", "interview", "offer", "rejected"]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [trackActionError, setTrackActionError] = useState("");
  const [trackActionMessage, setTrackActionMessage] = useState("");
  const [savingTrack, setSavingTrack] = useState(false);
  const [updatingTrackId, setUpdatingTrackId] = useState<number | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);
  const authHeader = useMemo(() => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined), [authToken]);
  const openAnalysisHref = addUtmParams("/upload", {
    source: "application_copilot_page",
    medium: "internal",
    campaign: "application_copilot",
  });

  const parseApiError = useCallback(async (response: Response) => {
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
  }, []);

  const loadJobTracks = useCallback(async (token: string) => {
    if (!token) return;
    setTracksLoading(true);
    try {
      const payload = await fetchJsonWithWakeAndRetry<JobTracksListPayload>({
        apiUrl,
        path: "/application-copilot/job-tracks?limit=40",
        init: {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Job tracks are taking longer than expected. Please try again.",
      });
      setJobTracks(payload.job_tracks || []);
      if ((payload.status_options || []).length > 0) {
        setStatusOptions(payload.status_options || []);
      }
    } catch {
      setJobTracks([]);
    } finally {
      setTracksLoading(false);
    }
  }, [parseApiError]);

  useEffect(() => {
    void warmBackend(apiUrl);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const rolePrefill = safeTrim(params.get("role")).slice(0, 120);
    const industryPrefill = safeTrim(params.get("industry")).slice(0, 80);
    const companyPrefill = safeTrim(params.get("company")).slice(0, 120);
    const resumePrefill = safeTrim(params.get("resume_text")).slice(0, 14000);
    const jdPrefill = safeTrim(params.get("job_description")).slice(0, 14000);

    if (rolePrefill) setRole(rolePrefill);
    if (industryPrefill) setIndustry(industryPrefill);
    if (companyPrefill) setCompany(companyPrefill);
    if (resumePrefill) setResumeText(resumePrefill);
    if (jdPrefill) setJdInput(jdPrefill);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tab = safeTrim(params.get("tab")).toLowerCase();
    if (tab === "overview" || tab === "plan" || tab === "tracks") {
      setOutputTab(tab);
    }
  }, []);

  useEffect(() => {
    const syncAuth = async () => {
      const token = window.localStorage.getItem("hirescore_auth_token") || "";
      if (!token) {
        setAuthToken("");
        setWallet(null);
        setAuthEmail("");
        setAuthError("Login required to run Application Copilot.");
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
        await loadJobTracks(token);
      } catch {
        setAuthError("Unable to verify your session right now.");
      }
    };
    void syncAuth();
  }, [loadJobTracks]);

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
    return fetchJsonWithWakeAndRetry<JdExtractPayload>({
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
  };

  const handleUploadResumeFile = async (file: File | null) => {
    if (!file) return;
    setCopilotError("");
    setTrackActionError("");
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
    setTrackActionError("");
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
      setCopilotError("Login required to run Application Copilot.");
      return;
    }
    if (resumeText.trim().length < 24) {
      setCopilotError("Resume content is required (at least 24 characters). Upload or paste resume text.");
      return;
    }
    if (jdInput.trim().length < 24) {
      setCopilotError("Job description is required (at least 24 characters). Upload or paste JD text.");
      return;
    }
    const requestedIndustry = industry.trim();
    const requestedRole = role.trim();
    const requestedCompany = company.trim();

    setCopilotError("");
    setTrackActionError("");
    setTrackActionMessage("");
    setCopilotLoading(true);
    setCopilotResult(null);
    const startedAt = Date.now();
    try {
      const payload = await fetchJsonWithWakeAndRetry<ApplicationCopilotPayload>({
        apiUrl,
        path: "/analysis/application-copilot",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            industry: requestedIndustry || "General",
            role: requestedRole || "Target role",
            company: requestedCompany,
            resume_text: resumeText.trim(),
            job_description: jdInput.trim(),
            auth_token: authToken,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Application Copilot is taking longer than expected. Please try again.",
      });
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < COPILOT_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, COPILOT_MIN_LOADING_MS - elapsedMs);
        });
      }
      if (payload.wallet) {
        setWallet(payload.wallet);
      }
      const normalizedPayload: ApplicationCopilotPayload = {
        ...payload,
        role: requestedRole || payload.role || "Target role",
        industry: requestedIndustry || payload.industry || "General",
        company: requestedCompany || payload.company || "",
      };
      setCopilotResult(normalizedPayload);
      setOutputTab("overview");
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < COPILOT_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, COPILOT_MIN_LOADING_MS - elapsedMs);
        });
      }
      setCopilotResult(null);
      setCopilotError(error instanceof Error ? error.message : "Unable to run Application Copilot right now.");
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleSaveJobTrack = async () => {
    if (!authToken || !authHeader || !copilotResult) {
      setTrackActionError("Run Application Copilot before saving a Job Track.");
      return;
    }
    const trackRole = safeTrim(copilotResult.role) || safeTrim(role);
    const trackIndustry = safeTrim(copilotResult.industry) || safeTrim(industry) || "General";
    const trackCompany = safeTrim(copilotResult.company) || safeTrim(company);
    if (trackRole.length < 2) {
      setTrackActionError("Set a valid target role before saving a Job Track.");
      return;
    }
    setTrackActionError("");
    setTrackActionMessage("");
    setSavingTrack(true);
    try {
      const payload = await fetchJsonWithWakeAndRetry<JobTrackUpsertPayload>({
        apiUrl,
        path: "/application-copilot/job-tracks",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            role: trackRole,
            industry: trackIndustry,
            company: trackCompany,
            status: "saved",
            copilot_payload: copilotResult,
            auth_token: authToken,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Saving job track is taking longer than expected. Please try again.",
      });
      const nextTrack = payload.job_track;
      setJobTracks((prev) => {
        const deduped = prev.filter((track) => track.id !== nextTrack.id);
        return [nextTrack, ...deduped];
      });
      setOutputTab("tracks");
      setTrackActionMessage("Job Track saved successfully.");
    } catch (error) {
      setTrackActionError(error instanceof Error ? error.message : "Unable to save Job Track right now.");
    } finally {
      setSavingTrack(false);
    }
  };

  const handleTrackStatusChange = async (trackId: number, status: string) => {
    if (!authToken || !authHeader) return;
    setTrackActionError("");
    setTrackActionMessage("");
    setUpdatingTrackId(trackId);
    try {
      const payload = await fetchJsonWithWakeAndRetry<JobTrackUpsertPayload>({
        apiUrl,
        path: `/application-copilot/job-tracks/${trackId}/status`,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            status,
            auth_token: authToken,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Updating track status is taking longer than expected. Please try again.",
      });
      const nextTrack = payload.job_track;
      setJobTracks((prev) => prev.map((track) => (track.id === nextTrack.id ? nextTrack : track)));
      setTrackActionMessage(`Track updated to ${statusDisplay(nextTrack.status)}.`);
    } catch (error) {
      setTrackActionError(error instanceof Error ? error.message : "Unable to update track status right now.");
    } finally {
      setUpdatingTrackId(null);
    }
  };

  const canRunCopilot =
    Boolean(authToken) &&
    resumeText.trim().length >= 24 &&
    jdInput.trim().length >= 24 &&
    !resumeFileUploading &&
    !jdFileUploading &&
    !copilotLoading;
  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const track of jobTracks) {
      counts[track.status] = (counts[track.status] || 0) + 1;
    }
    return counts;
  }, [jobTracks]);
  const metricBars = [
    { label: "Role Match", value: copilotResult?.match_percentage || 0 },
    { label: "Critical Coverage", value: copilotResult?.jd_match?.critical_coverage || 0 },
    { label: "Must-Have", value: copilotResult?.jd_match?.must_have_coverage || 0 },
    { label: "JD Relevance", value: copilotResult?.jd_match?.jd_relevance || 0 },
  ];
  const whyScoreNotes = useMemo(() => {
    if (!copilotResult) return [];
    const notes: string[] = [];
    const roleMatch = Math.max(0, Math.min(100, Math.round(copilotResult.match_percentage || 0)));
    const mustHave = Math.max(0, Math.min(100, Math.round(copilotResult.jd_match?.must_have_coverage || 0)));
    const critical = Math.max(0, Math.min(100, Math.round(copilotResult.jd_match?.critical_coverage || 0)));
    const jdRelevance = Math.max(0, Math.min(100, Math.round(copilotResult.jd_match?.jd_relevance || 0)));
    notes.push(`Role match is ${roleMatch}% based on your current resume evidence against this JD.`);
    notes.push(`Must-have coverage is ${mustHave}% and critical coverage is ${critical}%, which drive shortlist confidence most.`);
    notes.push(`JD relevance is ${jdRelevance}%, indicating how close your profile narrative is to the job intent.`);
    return notes.slice(0, 3);
  }, [copilotResult]);
  const topThreeFixes = useMemo(() => {
    if (!copilotResult) return [];
    const fixes: string[] = [];
    for (const item of copilotResult.resume_improvements || []) {
      const clean = safeTrim(item);
      if (clean) fixes.push(clean);
      if (fixes.length >= 3) break;
    }
    for (const skill of copilotResult.missing_skills || []) {
      const cleanSkill = safeTrim(skill);
      if (!cleanSkill) continue;
      fixes.push(`Add evidence for ${cleanSkill} in your latest role/project bullets.`);
      if (fixes.length >= 3) break;
    }
    return fixes.slice(0, 3);
  }, [copilotResult]);
  const expectedImpact = useMemo(() => {
    if (!copilotResult) return null;
    const roleMatch = Math.max(0, Math.min(100, Math.round(copilotResult.match_percentage || 0)));
    const mustHave = Math.max(0, Math.min(100, Math.round(copilotResult.jd_match?.must_have_coverage || 0)));
    const critical = Math.max(0, Math.min(100, Math.round(copilotResult.jd_match?.critical_coverage || 0)));
    const improvementPotential = Math.max(6, Math.min(22, Math.round(((100 - roleMatch) * 0.08) + ((100 - mustHave) * 0.06) + ((100 - critical) * 0.06))));
    return {
      minLift: Math.max(3, Math.round(improvementPotential * 0.6)),
      maxLift: improvementPotential,
    };
  }, [copilotResult]);

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

      <section className="mx-auto max-w-[1320px] rounded-[2rem] border border-cyan-100/22 bg-[linear-gradient(150deg,rgba(8,26,48,0.94),rgba(4,14,30,0.96)_52%,rgba(9,34,54,0.92))] p-6 shadow-[0_24px_64px_rgba(2,8,22,0.5)] sm:p-8">
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/76">Major Upgrade</p>
            <h1 className="mt-3 text-3xl font-semibold text-cyan-50 sm:text-5xl">Application Copilot</h1>
            <p className="mt-3 max-w-3xl text-sm text-cyan-50/78 sm:text-base">
              One run combines JD matching, resume tailoring, interview preparation, and a clear 7-day execution plan.
            </p>
            <p className="mt-4 rounded-xl border border-cyan-100/24 bg-cyan-100/8 px-3 py-2 text-xs text-cyan-100/80">
              Required input: Resume + JD text. Upload PDF/TXT/image files or paste the content directly.
            </p>
          </div>

          <div className="rounded-2xl border border-cyan-100/22 bg-[#061a32]/72 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/72">Session Status</p>
            <p className="mt-2 text-sm text-cyan-50/84">{authEmail ? `Signed in as ${authEmail}` : "Not signed in"}</p>
            <p className="mt-1 text-xs text-cyan-100/74">{wallet ? `Wallet: ${wallet.credits} credits` : "Wallet unavailable"}</p>
            <p className="mt-1 text-xs text-cyan-100/74">
              Run cost: {wallet?.pricing.jd_match ?? wallet?.pricing.analyze ?? 0} credits
            </p>
            {authError ? (
              <div className="mt-3 rounded-xl border border-amber-100/34 bg-amber-100/12 p-3">
                <p className="text-xs text-amber-50">{authError}</p>
                <TrackedLink
                  href={openAnalysisHref}
                  eventName="cta_check_my_score_click"
                  eventParams={{ cta_location: "application_copilot_page", cta_label: "Go To Analysis + Login" }}
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
        <aside className="space-y-4 xl:col-span-4">
          <div className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(165deg,rgba(7,22,43,0.9),rgba(4,14,29,0.95))] p-5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Input Control</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="Industry" className={fieldClass} />
              <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Role" className={fieldClass} />
            </div>
            <input
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              placeholder="Target company (optional)"
              className={`${fieldClass} mt-3`}
            />
            <textarea
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              placeholder="Resume text (required). Upload file or paste content."
              className={`${textAreaClass} mt-3`}
            />
            <textarea
              value={jdInput}
              onChange={(event) => setJdInput(event.target.value)}
              placeholder="JD text (required). Upload file or paste content."
              className={`${textAreaClass} mt-3`}
            />

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => resumeFileInputRef.current?.click()}
                disabled={resumeFileUploading || copilotLoading}
                className="rounded-xl border border-cyan-100/34 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resumeFileUploading ? "Extracting Resume..." : "Upload Resume"}
              </button>
              <button
                type="button"
                onClick={() => jdFileInputRef.current?.click()}
                disabled={jdFileUploading || copilotLoading}
                className="rounded-xl border border-cyan-100/34 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {jdFileUploading ? "Extracting JD..." : "Upload JD"}
              </button>
              <button
                type="button"
                onClick={() => void handleRunCopilot()}
                disabled={!canRunCopilot}
                className="rounded-xl border border-cyan-100/34 bg-gradient-to-r from-cyan-200/24 via-cyan-200/18 to-emerald-200/18 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {copilotLoading ? "Running Application Copilot..." : `Run Application Copilot (${wallet?.pricing.jd_match ?? wallet?.pricing.analyze ?? 0} credits)`}
              </button>
            </div>
            {resumeUploadedFileName ? <p className="mt-2 text-xs text-cyan-100/78">Resume: {resumeUploadedFileName}</p> : null}
            {jdUploadedFileName ? <p className="mt-1 text-xs text-cyan-100/78">JD: {jdUploadedFileName}</p> : null}
            {copilotError ? <p className="mt-2 text-xs text-amber-100">{copilotError}</p> : null}
          </div>
        </aside>

        <section className="xl:col-span-8">
          <article className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(8,24,44,0.88),rgba(5,16,31,0.94))] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Copilot Output</p>
              <div className="inline-flex rounded-xl border border-cyan-100/22 bg-cyan-100/8 p-1">
                <button
                  type="button"
                  onClick={() => setOutputTab("overview")}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    outputTab === "overview" ? "bg-cyan-200/24 text-cyan-50" : "text-cyan-100/72"
                  }`}
                >
                  Overview
                </button>
                <button
                  type="button"
                  onClick={() => setOutputTab("plan")}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    outputTab === "plan" ? "bg-cyan-200/24 text-cyan-50" : "text-cyan-100/72"
                  }`}
                >
                  Action Plan
                </button>
                <button
                  type="button"
                  onClick={() => setOutputTab("tracks")}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    outputTab === "tracks" ? "bg-cyan-200/24 text-cyan-50" : "text-cyan-100/72"
                  }`}
                >
                  Job Tracks
                </button>
              </div>
            </div>

            {copilotLoading ? (
              <div className="mt-4 rounded-2xl border border-cyan-100/18 bg-cyan-100/8 p-4">
                <div className="mx-auto relative h-24 w-24">
                  <div className="absolute inset-0 rounded-full border-2 border-cyan-100/24" />
                  <div className="absolute inset-2 animate-spin rounded-full border-2 border-cyan-200/45 border-t-transparent" />
                  <div className="absolute inset-6 animate-pulse rounded-full border border-emerald-200/45" />
                </div>
                <p className="mt-3 text-center text-sm font-semibold text-cyan-50">Compiling your full job-winning strategy...</p>
                <div className="mt-3 space-y-2">
                  <div className="h-2 overflow-hidden rounded-full border border-cyan-100/22 bg-cyan-100/10">
                    <div className="h-full w-[85%] animate-pulse rounded-full bg-gradient-to-r from-cyan-300/70 via-sky-300/75 to-emerald-200/80" />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full border border-cyan-100/22 bg-cyan-100/10">
                    <div className="h-full w-[72%] animate-pulse rounded-full bg-gradient-to-r from-cyan-300/70 via-sky-300/75 to-emerald-200/80" />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full border border-cyan-100/22 bg-cyan-100/10">
                    <div className="h-full w-[92%] animate-pulse rounded-full bg-gradient-to-r from-cyan-300/70 via-sky-300/75 to-emerald-200/80" />
                  </div>
                </div>
              </div>
            ) : outputTab !== "tracks" && !copilotResult ? (
              <p className="mt-4 text-sm text-cyan-50/72">Run Application Copilot to get match %, resume improvements, and execution steps.</p>
            ) : null}

            {outputTab === "overview" && copilotResult ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Match Percentage</p>
                      <p className="mt-1 text-4xl font-semibold text-cyan-50">{Math.max(0, Math.min(100, copilotResult.match_percentage || 0))}%</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveJobTrack()}
                      disabled={savingTrack}
                      className="rounded-lg border border-cyan-100/30 bg-cyan-100/12 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/20 disabled:opacity-60"
                    >
                      {savingTrack ? "Saving..." : "Save as Job Track"}
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-cyan-100/84">{copilotResult.jd_match?.alignment_summary || "AI generated role-fit summary ready."}</p>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3 lg:col-span-2">
                    <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Why This Score</p>
                    <ul className="mt-2 space-y-1 text-sm text-cyan-50/84">
                      {whyScoreNotes.map((note, index) => (
                        <li key={`why-score-${index}`}>- {note}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Expected Impact</p>
                    {expectedImpact ? (
                      <>
                        <p className="mt-2 text-2xl font-semibold text-cyan-50">+{expectedImpact.minLift}% to +{expectedImpact.maxLift}%</p>
                        <p className="mt-2 text-xs text-cyan-100/78">
                          Estimated shortlist lift if top fixes are applied before your next application batch.
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-cyan-50/72">Run copilot to estimate impact.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Performance Graphs</p>
                  <div className="mt-3 space-y-2.5">
                    {metricBars.map((metric) => (
                      <div key={metric.label}>
                        <div className="flex items-center justify-between text-xs text-cyan-100/80">
                          <span>{metric.label}</span>
                          <span>{metric.value}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full border border-cyan-100/18 bg-[#061a34]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-300 to-emerald-200 transition-all duration-700"
                            style={{ width: `${Math.max(0, Math.min(100, metric.value || 0))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3 lg:col-span-2">
                    <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Top 3 Fixes</p>
                    <ol className="mt-2 space-y-1 text-sm text-cyan-50/84">
                      {topThreeFixes.length ? (
                        topThreeFixes.map((fix, index) => (
                          <li key={`top-fix-${index}`}>
                            {index + 1}. {fix}
                          </li>
                        ))
                      ) : (
                        <li>Run copilot to generate high-impact fixes.</li>
                      )}
                    </ol>
                  </div>
                  <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Matched Skills</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(copilotResult.matched_skills || []).slice(0, 14).map((skill) => (
                        <span key={`match-${skill}`} className="rounded-full border border-emerald-100/36 bg-emerald-200/18 px-2.5 py-1 text-xs text-emerald-50">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Missing Skills</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(copilotResult.missing_skills || []).slice(0, 14).map((skill) => (
                        <span key={`missing-${skill}`} className="rounded-full border border-amber-100/36 bg-amber-200/16 px-2.5 py-1 text-xs text-amber-50">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {outputTab === "plan" && copilotResult ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Resume Improvements</p>
                  <ol className="mt-2 space-y-1 text-sm text-cyan-50/84">
                    {(copilotResult.resume_improvements || []).slice(0, 8).map((line, index) => (
                      <li key={`improve-${index}`}>
                        {index + 1}. {line}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">7-Day Action Plan</p>
                  <ol className="mt-2 space-y-1 text-sm text-cyan-50/84">
                    {(copilotResult.next_steps_7_day || []).slice(0, 7).map((step, index) => (
                      <li key={`step-${index}`}>{step}</li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Interview Questions</p>
                  <ol className="mt-2 space-y-1 text-sm text-cyan-50/84">
                    {(copilotResult.interview_questions || []).slice(0, 6).map((question, index) => (
                      <li key={`question-${index}`}>
                        {index + 1}. {question}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ) : null}

            {outputTab === "tracks" ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Pipeline Snapshot</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {statusOptions.map((status) => (
                      <span key={status} className="rounded-full border border-cyan-100/24 bg-cyan-100/10 px-2.5 py-1 text-[11px] text-cyan-100/84">
                        {statusDisplay(status)}: {statusBreakdown[status] || 0}
                      </span>
                    ))}
                  </div>
                </div>

                {tracksLoading ? (
                  <p className="text-sm text-cyan-50/72">Loading job tracks...</p>
                ) : jobTracks.length === 0 ? (
                  <p className="text-sm text-cyan-50/72">No job tracks yet. Run Copilot and save your first track.</p>
                ) : (
                  <div className="space-y-2">
                    {jobTracks.slice(0, 14).map((track) => (
                      <div key={track.id} className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-cyan-50">{track.role}</p>
                            <p className="text-xs text-cyan-100/72">
                              {track.industry}
                              {track.company ? ` | ${track.company}` : ""}
                            </p>
                            <p className="mt-1 text-xs text-cyan-100/70">Match: {track.match_percentage}%</p>
                          </div>
                          <select
                            value={track.status}
                            onChange={(event) => void handleTrackStatusChange(track.id, event.target.value)}
                            disabled={updatingTrackId === track.id}
                            className="rounded-lg border border-cyan-100/28 bg-[#08233f]/72 px-2.5 py-1.5 text-xs text-cyan-50 outline-none"
                          >
                            {statusOptions.map((status) => (
                              <option key={`${track.id}-${status}`} value={status}>
                                {statusDisplay(status)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="mt-2 text-xs text-cyan-100/78">
                          Missing: {(track.missing_skills || []).slice(0, 5).join(", ") || "None"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {trackActionMessage ? <p className="mt-3 text-xs text-emerald-100">{trackActionMessage}</p> : null}
            {trackActionError ? <p className="mt-2 text-xs text-amber-100">{trackActionError}</p> : null}
          </article>
        </section>
      </section>
    </main>
  );
}
