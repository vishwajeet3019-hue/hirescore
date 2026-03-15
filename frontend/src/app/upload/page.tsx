"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { addUtmParams } from "@/lib/utm";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { renderGoogleSignInButton } from "@/lib/google-sso";
import { trackAnalyzeComplete, trackAnalyzeStart, trackEvent, trackSignup } from "@/lib/analytics";
import { addAuthChangeListener, clearStoredAuthToken, resolveAuthSession, setStoredAuthToken } from "@/lib/public-access";
import TrackedLink from "@/app/components/tracked-link";

type ImprovementArea = {
  category: string;
  details: string[];
};

type CreditWallet = {
  credits: number;
  welcome_credits: number;
  free_analysis_included: number;
  pricing: {
    analyze: number;
    jd_match: number;
    ai_resume_generation: number;
    template_pdf_download: number;
  };
};

type AuthUser = {
  id: number;
  email: string;
  created_at: string;
};

type AuthPayload = {
  auth_token?: string;
  user?: AuthUser;
  wallet?: CreditWallet;
  feedback_required?: boolean;
  guest_mode?: boolean;
  otp_required?: boolean;
  message?: string;
  otp_expires_minutes?: number;
};

type FeatureFlags = {
  onboarding_copy_variant?: "A" | "B";
  roadmap_prompt_variant?: "A" | "B";
  pricing_cta_variant?: "A" | "B";
};

type SalaryBoosterOption = {
  id: string;
  label: string;
  description: string;
  uplift_lpa: number;
};

type SalaryInsight = {
  market_scope: string;
  market_segment: string;
  target_role: string;
  target_industry: string;
  experience_band: string;
  experience_years_used?: number | null;
  currency: string;
  base_range_lpa: {
    low: number;
    mid: number;
    high: number;
  };
  selected_boosters: string[];
  booster_uplift_lpa: number;
  projected_range_lpa: {
    low: number;
    mid: number;
    high: number;
  };
  salary_booster_options: SalaryBoosterOption[];
  market_data_refresh_note?: string;
};

type NinetyPlusAction = {
  priority?: string;
  step_label?: string;
  title?: string;
  action: string;
  why_it_matters?: string;
  how_to_execute?: string[];
  estimated_score_lift: number;
  timeline_weeks: string;
};

type NinetyPlusStrategy = {
  target_score: number;
  current_score: number;
  gap_to_90: number;
  projected_score_after_execution: number;
  execution_window_weeks: string;
  plan_status: string;
  actions: NinetyPlusAction[];
};

type InterviewCallLikelihood = {
  level: "low" | "medium" | "high";
  label: string;
  score: number;
};

type PositioningRole = {
  role: string;
  fit_score: number;
  fit_signal: "higher_fit" | "comparable_fit";
  why: string;
};

type PositioningStrategy = {
  target_role: string;
  target_fit_score: number;
  target_role_examples: string[];
  higher_probability_roles: PositioningRole[];
  summary: string;
};

type LearningRoadmapPhase = {
  phase: string;
  duration_weeks: string;
  focus: string[];
  outcome: string;
  deliverables?: string[];
};

type LearningRoadmap = {
  target_role: string;
  target_industry?: string;
  experience_band?: string;
  total_duration_weeks: string;
  phases: LearningRoadmapPhase[];
};

type HiringMarketInsights = {
  best_months_to_apply: string[];
  hiring_peak_windows: string[];
  layoff_risk_level: "low" | "medium" | "high";
  layoff_risk_note: string;
  higher_layoff_risk_industries: string[];
  application_timing_tip: string;
};

type CallbackForecast = {
  applications_input: number;
  analysis_window_weeks?: number;
  applications_per_week?: number;
  estimated_callback_rate: number;
  expected_callbacks: number;
  expected_callbacks_per_week?: number;
  improved_callback_rate: number;
  expected_callbacks_after_improvements: number;
  expected_callbacks_after_improvements_per_week?: number;
  weekly_note?: string;
  improvement_actions: string[];
};

type AnalysisResult = {
  overall_score: number;
  skill_match: number;
  areas_to_improve: ImprovementArea[];
  shortlist_prediction?: string;
  confidence?: number;
  quick_wins?: string[];
  likely_interview_call?: InterviewCallLikelihood;
  ninety_plus_strategy?: NinetyPlusStrategy;
  salary_insight?: SalaryInsight;
  positioning_strategy?: PositioningStrategy;
  learning_roadmap?: LearningRoadmap;
  hiring_market_insights?: HiringMarketInsights;
  callback_forecast?: CallbackForecast;
  is_fresher_profile?: boolean;
  source?: string;
  extracted_chars?: number;
  role_universe_mode?: string;
  age_years_used?: number | null;
  age_opinions?: string[];
  career_stage?: string;
  experience_expectation_years?: {
    low: number;
    high: number;
  } | null;
  wallet?: CreditWallet;
  credit_transaction_id?: number;
  feedback_required?: boolean;
  report_id?: number;
};

type AnalysisSnapshot = {
  id: number;
  created_at: string;
  source: string;
  industry: string;
  role: string;
  overall_score: number;
  confidence: number;
  critical_missing_count: number;
  estimated_callback_rate: number;
  shortlist_prediction: string;
};

type AnalysisComparison = {
  latest?: AnalysisSnapshot | null;
  previous?: AnalysisSnapshot | null;
  delta?: {
    overall_score: number;
    confidence: number;
    critical_missing_count: number;
    estimated_callback_rate: number;
  } | null;
};

type RoleBenchmark = {
  role: string;
  industry: string;
  score: number;
  peer_count: number;
  percentile: number;
  band_label: string;
  benchmarks?: {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
};

type GoalRoadmapMilestone = {
  id: string;
  title: string;
  detail: string;
  category?: string | null;
  priority?: "critical" | "high" | "medium" | "low" | string | null;
  timeframe?: string | null;
  why?: string | null;
  done_when?: string | null;
  focus_skills?: string[];
  completed: boolean;
  completed_at?: string | null;
  evidence_note?: string | null;
  evidence_link?: string | null;
  evidence_updated_at?: string | null;
};

type GoalRoadmap = {
  id: number;
  goal_title: string;
  goal_context: string;
  target_role: string;
  target_industry: string;
  target_score?: number | null;
  current_score?: number | null;
  total_milestones: number;
  completed_milestones: number;
  progress_percent: number;
  milestones: GoalRoadmapMilestone[];
  created_at: string;
  updated_at: string;
};

type GoalRoadmapPayload = {
  roadmap?: GoalRoadmap | null;
  roadmaps?: GoalRoadmap[];
  action?: string;
  created_new_track?: boolean;
  added_milestones?: number;
  count?: number;
  message?: string;
};

type RoadmapPreviewPayload = {
  action?: string;
  created_new_track?: boolean;
  matched_roadmap_id?: number | null;
  matched_track_title?: string | null;
  incoming_milestones?: number;
  added_milestones?: number;
  resulting_total_milestones?: number;
  similarity_score?: number;
  added_titles?: string[];
  summary?: string;
};

type JdMatchPayload = {
  role_track: string;
  match_score: number;
  match_percentage?: number;
  matched_skills?: string[];
  missing_skills?: string[];
  matched_must_have_skills?: string[];
  missing_must_have_skills?: string[];
  matched_good_to_have_skills?: string[];
  missing_good_to_have_skills?: string[];
  skill_breakdown?: {
    must_have_coverage?: number;
    good_to_have_coverage?: number;
    gap_severity?: string;
  };
  matched_keywords: string[];
  missing_keywords: string[];
  jd_keyword_count: number;
  resume_keyword_count: number;
  critical_coverage: number;
  suggested_bullets: string[];
  alignment_summary: string;
  feedback?: string[];
  improvements?: string[];
  next_steps?: string[];
  wallet?: CreditWallet;
  credit_transaction_id?: number;
  role_profile?: {
    core: string[];
    critical: string[];
  };
};

type JdExtractPayload = {
  job_description: string;
  extracted_chars: number;
  file_name: string;
  file_type?: string;
};

type InterviewPrepPayload = {
  role: string;
  industry: string;
  focus_skills: string[];
  coach_note: string;
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
  wallet?: CreditWallet;
  credit_transaction_id?: number;
};

type JobTrackUpsertPayload = {
  job_track: {
    id: number;
    role: string;
    industry: string;
    status: string;
    updated_at: string;
  };
};

type ApiErrorDetail = {
  message?: string;
  wallet?: CreditWallet;
  feedback_required?: boolean;
};

type ApiErrorPayload = {
  detail?: string | ApiErrorDetail;
  wallet?: CreditWallet;
  auth_token?: string;
  user?: AuthUser;
  feedback_required?: boolean;
};

const ROLE_EXAMPLE_TITLES = [
  "Product Manager",
  "Product Analyst",
  "Growth Analyst",
  "Business Analyst",
  "Marketing Associate",
  "SEO Specialist",
  "Account Executive",
  "Customer Success Manager",
  "Backend Engineer",
  "Frontend Developer",
  "Data Analyst",
  "DevOps Engineer",
  "QA Engineer",
  "Finance Analyst",
] as const;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || "";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const parseSkillTokens = (value: string) => {
  return value
    .replace(/\s+&\s+/g, ",")
    .replace(/\s+\band\b\s+/gi, ",")
    .split(/[,\n;/|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
};

const MAX_RESUME_UPLOAD_BYTES = 12 * 1024 * 1024;

const validateResumeUploadFile = (file: File | null) => {
  if (!file) return "Upload your resume file first.";
  const normalizedName = file.name.toLowerCase();
  const fileType = (file.type || "").toLowerCase();
  const isPdf = fileType === "application/pdf" || normalizedName.endsWith(".pdf");
  const isText = fileType.startsWith("text/") || normalizedName.endsWith(".txt");
  const isDocx =
    fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || normalizedName.endsWith(".docx");
  const isImage = fileType.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(normalizedName);

  if (!isPdf && !isText && !isDocx && !isImage) {
    return "Upload resume as PDF, DOCX, TXT, or image (JPG/PNG/WebP).";
  }
  if (file.size > MAX_RESUME_UPLOAD_BYTES) {
    return "Resume file is too large. Keep it under 12 MB.";
  }
  return "";
};

const fileExtension = (fileName: string) => {
  const normalized = fileName.toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex < 0) return "unknown";
  return normalized.slice(dotIndex + 1) || "unknown";
};

const rounded = (value: number) => Math.round(value * 10) / 10;
const formatDeltaValue = (value: number, suffix = "") => {
  const normalized = Number.isFinite(value) ? rounded(value) : 0;
  const sign = normalized > 0 ? "+" : "";
  return `${sign}${normalized}${suffix}`;
};
const ANALYSIS_LOADING_STEPS = [
  "Parsing profile and role intent",
  "Calibrating shortlist probability model",
  "Building salary and callback forecasts",
  "Generating strategy and roadmap insights",
] as const;
const AUTH_LIVE_LOADING_STEPS = [
  "Verifying identity handshake",
  "Securing session tunnel",
  "Provisioning your dashboard state",
  "Finalizing account access",
] as const;
const MIN_ANALYSIS_LOADING_MS = 6000;
const MIN_AUTH_LIVE_LOADING_MS = 5600;
const ANALYSIS_LIVE_START_PROGRESS = 12;
const ANALYSIS_LIVE_END_PROGRESS = 94;
const AUTH_LIVE_START_PROGRESS = 10;
const AUTH_LIVE_END_PROGRESS = 95;
const AUTH_LIVE_COMPLETE_PAUSE_MS = 220;
const AUTH_REQUEST_TIMEOUT_MS = 70000;

type ResultTabId = "summary" | "strategy" | "salary" | "market" | "improvements";

const RESULT_STEPS: { id: ResultTabId; label: string; description: string }[] = [
  { id: "summary", label: "Summary", description: "Start with your score and immediate wins." },
  { id: "strategy", label: "90% Strategy", description: "Follow this execution plan to increase shortlist odds." },
  { id: "salary", label: "Salary + Callback", description: "See salary lift and callback simulation clearly." },
  { id: "market", label: "Hiring Timing", description: "Apply at the right windows and reduce market risk." },
  { id: "improvements", label: "Improvements", description: "Track final fix list and turn weak areas into strengths." },
];

type TimedLoadingProgressOptions = {
  totalMs: number;
  stepCount: number;
  startProgress: number;
  endProgress: number;
};

const useTimedLoadingProgress = ({
  totalMs,
  stepCount,
  startProgress,
  endProgress,
}: TimedLoadingProgressOptions) => {
  const [progress, setProgress] = useState(startProgress);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    let frameId = 0;
    let startedAt: number | null = null;
    const stepDuration = totalMs / Math.max(1, stepCount);

    const tick = (now: number) => {
      if (startedAt === null) {
        startedAt = now;
      }

      const elapsed = Math.min(now - startedAt, totalMs);
      const nextProgress = startProgress + (elapsed / totalMs) * (endProgress - startProgress);
      const nextStepIndex = Math.min(stepCount - 1, Math.floor(elapsed / stepDuration));

      setProgress((previous) => (Math.abs(previous - nextProgress) < 0.15 ? previous : nextProgress));
      setStepIndex((previous) => (previous === nextStepIndex ? previous : nextStepIndex));

      if (elapsed < totalMs) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [endProgress, startProgress, stepCount, totalMs]);

  return {
    progress,
    stepIndex,
  };
};

function AuthLiveOverlay({ completionTick }: { completionTick: number }) {
  const { progress, stepIndex } = useTimedLoadingProgress({
    totalMs: MIN_AUTH_LIVE_LOADING_MS,
    stepCount: AUTH_LIVE_LOADING_STEPS.length,
    startProgress: AUTH_LIVE_START_PROGRESS,
    endProgress: AUTH_LIVE_END_PROGRESS,
  });
  const [initialCompletionTick] = useState(completionTick);
  const isCompleting = completionTick > initialCompletionTick;
  const resolvedProgress = isCompleting ? 100 : progress;
  const resolvedStepIndex = isCompleting ? AUTH_LIVE_LOADING_STEPS.length - 1 : stepIndex;
  const progressScale = Math.min(1, Math.max(0, resolvedProgress / 100));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[320] flex items-center justify-center bg-[#02040f]/78 px-4"
    >
      <div className="auth-live-shell w-full max-w-md rounded-[1.8rem] p-6 sm:p-7">
        <div className="auth-live-stage relative flex items-center justify-center">
          <div className="auth-live-halo" />
          <div className="auth-live-wave" />
          <div className="auth-live-orb auth-live-orb-outer" />
          <div className="auth-live-orb auth-live-orb-mid" />
          <div className="auth-live-orb auth-live-orb-inner" />
          <div className="auth-live-arc auth-live-arc-a" />
          <div className="auth-live-arc auth-live-arc-b" />
          <div className="auth-live-spark auth-live-spark-a" />
          <div className="auth-live-spark auth-live-spark-b" />
          <div className="auth-live-spark auth-live-spark-c" />
          <div className="auth-live-core-dot" />
        </div>

        <p className="mt-6 text-center text-[11px] uppercase tracking-[0.18em] text-cyan-100/78">Authenticating</p>
        <p className="mt-2 text-center text-sm font-semibold text-cyan-50">{AUTH_LIVE_LOADING_STEPS[resolvedStepIndex]}</p>

        <div className="mt-5 h-2 overflow-hidden rounded-full border border-cyan-100/40 bg-cyan-100/10">
          <div
            className="auth-live-progress-fill h-full rounded-full bg-gradient-to-r from-cyan-200 via-fuchsia-200 to-amber-200"
            style={{ transform: `scaleX(${progressScale})` }}
          />
        </div>
        <p className="mt-2 text-center text-xs text-cyan-100/76">{Math.round(resolvedProgress)}%</p>
      </div>
    </motion.div>
  );
}

function AnalysisLiveOverlay() {
  const { progress, stepIndex } = useTimedLoadingProgress({
    totalMs: MIN_ANALYSIS_LOADING_MS,
    stepCount: ANALYSIS_LOADING_STEPS.length,
    startProgress: ANALYSIS_LIVE_START_PROGRESS,
    endProgress: ANALYSIS_LIVE_END_PROGRESS,
  });

  const progressScale = Math.min(1, Math.max(0, progress / 100));
  const displayProgress = Math.round(progress);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[#010613]/88 px-4"
    >
      <div className="analysis-live-shell w-full max-w-3xl rounded-[2rem] p-6 sm:p-8">
        <div className="analysis-live-stage relative flex items-center justify-center">
          <div className="analysis-live-grid" />
          <div className="analysis-live-wave analysis-live-wave-a" />
          <div className="analysis-live-wave analysis-live-wave-b" />
          <div className="analysis-live-ring analysis-live-ring-outer" />
          <div className="analysis-live-ring analysis-live-ring-mid" />
          <div className="analysis-live-ring analysis-live-ring-inner" />
          <div className="analysis-live-beam" />
          <div className="analysis-live-orbit analysis-live-orbit-a" />
          <div className="analysis-live-orbit analysis-live-orbit-b" />
          <div className="analysis-live-orbit analysis-live-orbit-c" />
          <div className="analysis-live-core">
            <span className="analysis-live-core-value">{displayProgress}%</span>
          </div>
        </div>

        <div className="relative mt-3">
          <p className="text-center text-xs uppercase tracking-[0.2em] text-cyan-100/72">Analysis In Progress</p>
          <h3 className="mt-2 text-center text-2xl font-semibold text-cyan-50 sm:text-3xl">Building Your Shortlist Intelligence Report</h3>
          <p className="mt-3 text-center text-sm text-cyan-50/74">{ANALYSIS_LOADING_STEPS[stepIndex]}</p>

          <div className="mt-5 h-2 overflow-hidden rounded-full border border-cyan-100/24 bg-cyan-100/8">
            <div
              className="analysis-live-progress-fill h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200"
              style={{ transform: `scaleX(${progressScale})` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-cyan-100/66">
            <span>{ANALYSIS_LOADING_STEPS[stepIndex]}</span>
            <span>{displayProgress}%</span>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {ANALYSIS_LOADING_STEPS.map((step, index) => {
              const activeStep = index === stepIndex;
              return (
                <div
                  key={step}
                  className={`analysis-live-step rounded-xl border px-3 py-2.5 text-sm ${
                    activeStep ? "analysis-live-step-active border-cyan-100/52 bg-cyan-200/18 text-cyan-50" : "border-cyan-100/16 bg-cyan-100/5 text-cyan-50/72"
                  }`}
                >
                  {step}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const buyCreditsHref = addUtmParams("/pricing", {
    source: "upload",
    medium: "toolbar",
    campaign: "upload_credits",
  });
  const [analysisMode, setAnalysisMode] = useState<"manual" | "upload">("manual");
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({});
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [ageYears, setAgeYears] = useState("");
  const [applicationsCount, setApplicationsCount] = useState("60");
  const [analysisSkills, setAnalysisSkills] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisComparison, setAnalysisComparison] = useState<AnalysisComparison | null>(null);
  const [roleBenchmark, setRoleBenchmark] = useState<RoleBenchmark | null>(null);
  const [analysisTrendLoading, setAnalysisTrendLoading] = useState(false);
  const [analysisTrendError, setAnalysisTrendError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState<ResultTabId>("summary");
  const [showRoadmapModal, setShowRoadmapModal] = useState(false);
  const [showRoadmapDecisionModal, setShowRoadmapDecisionModal] = useState(false);
  const [roadmapDecisionMode, setRoadmapDecisionMode] = useState<"first" | "update">("first");
  const [roadmapTracksCount, setRoadmapTracksCount] = useState(0);
  const [roadmapDecisionLoading, setRoadmapDecisionLoading] = useState(false);
  const [roadmapDecisionSubmitting, setRoadmapDecisionSubmitting] = useState(false);
  const [roadmapServerAction, setRoadmapServerAction] = useState("");
  const [roadmapPreviewMeta, setRoadmapPreviewMeta] = useState<RoadmapPreviewPayload | null>(null);
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [roadmapError, setRoadmapError] = useState("");
  const [roadmapPreview, setRoadmapPreview] = useState<GoalRoadmap | null>(null);
  const [jdInput, setJdInput] = useState("");
  const [jdMatch, setJdMatch] = useState<JdMatchPayload | null>(null);
  const [jdMatchLoading, setJdMatchLoading] = useState(false);
  const [jdFileUploading, setJdFileUploading] = useState(false);
  const [jdUploadedFileName, setJdUploadedFileName] = useState("");
  const [showJdScanner, setShowJdScanner] = useState(false);
  const [jdMatchError, setJdMatchError] = useState("");
  const [interviewPrep, setInterviewPrep] = useState<InterviewPrepPayload | null>(null);
  const [interviewPrepLoading, setInterviewPrepLoading] = useState(false);
  const [applicationPack, setApplicationPack] = useState<ApplicationPackPayload | null>(null);
  const [applicationPackLoading, setApplicationPackLoading] = useState(false);
  const [applicationCopilot, setApplicationCopilot] = useState<ApplicationCopilotPayload | null>(null);
  const [applicationCopilotLoading, setApplicationCopilotLoading] = useState(false);
  const [jobTrackSaving, setJobTrackSaving] = useState(false);
  const [jobTrackSaveMessage, setJobTrackSaveMessage] = useState("");
  const [applicationCopilotError, setApplicationCopilotError] = useState("");
  const [prepPackError, setPrepPackError] = useState("");

  const [selectedSalaryBoosters, setSelectedSalaryBoosters] = useState<string[]>([]);
  const [callbackSimulationApps, setCallbackSimulationApps] = useState("60");

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authUserEmail, setAuthUserEmail] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [authLiveLoading, setAuthLiveLoading] = useState(false);
  const [authLiveCompletionTick, setAuthLiveCompletionTick] = useState(0);
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [signupOtp, setSignupOtp] = useState("");
  const [signupOtpRequired, setSignupOtpRequired] = useState(false);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [forgotOtpRequested, setForgotOtpRequested] = useState(false);
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [feedbackRequired, setFeedbackRequired] = useState(false);
  const [deferredFeedbackPrompt, setDeferredFeedbackPrompt] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [queuedAnalyzeMode, setQueuedAnalyzeMode] = useState<"manual" | "upload" | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);
  const closeResultModalRef = useRef<() => void>(() => {});
  const authIntentHandledRef = useRef(false);

  const authHeader = useMemo(
    () => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined),
    [authToken]
  );

  const applyAuthPayload = (payload: AuthPayload | null | undefined) => {
    if (payload?.wallet) {
      setWallet(payload.wallet);
    }
    if (payload?.user?.email) {
      setAuthUserEmail(payload.user.email);
    }
    if (payload?.auth_token) {
      setAuthToken(payload.auth_token);
      setStoredAuthToken(payload.auth_token);
    }
    if (payload?.message) {
      setAuthInfo(payload.message);
    }
    if (payload?.otp_required) {
      setSignupOtpRequired(true);
    }
    if (typeof payload?.feedback_required === "boolean") {
      setFeedbackRequired(payload.feedback_required);
    }
    if (typeof payload?.guest_mode === "boolean") {
      setGuestMode(payload.guest_mode);
    }
  };

  useEffect(() => {
    const clearSessionState = () => {
      setAuthToken("");
      setWallet(null);
      setAuthUserEmail("");
      setGuestMode(false);
      setFeedbackRequired(false);
      setShowFeedbackModal(false);
    };

    let cancelled = false;
    const syncAuth = async () => {
      const session = await resolveAuthSession<AuthPayload>();
      if (cancelled) return;
      if (session.error) {
        if (!session.token) {
          clearSessionState();
        }
        return;
      }
      if (!session.payload) {
        clearSessionState();
        return;
      }
      setAuthToken(session.token);
      applyAuthPayload(session.payload);
    };
    void syncAuth();
    const unsubscribe = addAuthChangeListener(() => {
      void syncAuth();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void warmBackend(apiUrl);
  }, []);

  useEffect(() => {
    if (authIntentHandledRef.current) return;
    if (typeof window === "undefined") return;
    const authIntent = (new URLSearchParams(window.location.search).get("auth") || "").trim().toLowerCase();
    if (!authIntent) return;
    authIntentHandledRef.current = true;
    if (authToken && !guestMode) return;
    if (authIntent === "signup") {
      setAuthMode("signup");
    } else {
      setAuthMode("login");
    }
    setAuthError("");
    setAuthInfo("");
    setShowAuthModal(true);
  }, [authToken, guestMode]);

  useEffect(() => {
    let cancelled = false;
    const loadFeatureFlags = async () => {
      try {
        const response = await fetch(apiUrl("/feature-flags"), {
          headers: authHeader,
        });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as { feature_flags?: FeatureFlags } | null;
        if (!cancelled) {
          setFeatureFlags(payload?.feature_flags || {});
        }
      } catch {
        if (!cancelled) {
          setFeatureFlags({});
        }
      }
    };
    void loadFeatureFlags();
    return () => {
      cancelled = true;
    };
  }, [authHeader]);

  useEffect(() => {
    if (!loading && !showResultModal && !showRoadmapModal && !showRoadmapDecisionModal && !showFeedbackModal && !showAuthModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [loading, showResultModal, showRoadmapModal, showRoadmapDecisionModal, showFeedbackModal, showAuthModal]);

  useEffect(() => {
    if (!showResultModal) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeResultModalRef.current();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [showResultModal]);

  const remainingAnalyze = wallet ? Math.floor(wallet.credits / Math.max(1, wallet.pricing.analyze)) : 0;

  const metricCards = result
    ? [
        { label: "Role Match", value: result.skill_match },
        ...(typeof result.confidence === "number" ? [{ label: "Prediction Confidence", value: result.confidence }] : []),
      ]
    : [];

  const parseApiError = async (response: Response) => {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;

    if (payload?.wallet) {
      setWallet(payload.wallet);
    }
    if (payload?.auth_token || payload?.user) {
      applyAuthPayload(payload);
    }
    if (typeof payload?.feedback_required === "boolean") {
      setFeedbackRequired(payload.feedback_required);
    }

    if (payload?.detail && typeof payload.detail === "object") {
      if (payload.detail.wallet) {
        setWallet(payload.detail.wallet);
      }
      if (payload.detail.feedback_required) {
        setFeedbackRequired(true);
      }
      return payload.detail.message || `Request failed (${response.status})`;
    }

    if (typeof payload?.detail === "string") {
      return payload.detail;
    }

    return `Request failed (${response.status})`;
  };

  const submitAuthRequest = async (mode: "login" | "signup", email: string, password: string) => {
    return fetchJsonWithWakeAndRetry<AuthPayload>({
      apiUrl,
      path: mode === "signup" ? "/auth/signup/request-otp" : "/auth/login",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: parseApiError,
      abortErrorMessage: "Server wake-up is taking longer than expected. Please wait 10-20 seconds and try again.",
    });
  };

  const verifySignupOtp = async (email: string, otp: string) => {
    return fetchJsonWithWakeAndRetry<AuthPayload>({
      apiUrl,
      path: "/auth/signup/verify-otp",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          otp,
        }),
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: parseApiError,
      abortErrorMessage: "Server wake-up is taking longer than expected. Please wait 10-20 seconds and try again.",
    });
  };

  const requestForgotPasswordOtp = async (email: string) => {
    return fetchJsonWithWakeAndRetry<AuthPayload>({
      apiUrl,
      path: "/auth/forgot-password/request-otp",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: parseApiError,
      abortErrorMessage: "Server wake-up is taking longer than expected. Please wait 10-20 seconds and try again.",
    });
  };

  const resetForgottenPassword = async (email: string, otp: string, newPassword: string) => {
    return fetchJsonWithWakeAndRetry<AuthPayload>({
      apiUrl,
      path: "/auth/forgot-password/reset",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          otp,
          new_password: newPassword,
        }),
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: parseApiError,
      abortErrorMessage: "Server wake-up is taking longer than expected. Please wait 10-20 seconds and try again.",
    });
  };

  useEffect(() => {
    if (!result || showResultModal || !deferredFeedbackPrompt || !feedbackRequired) return;
    setShowFeedbackModal(true);
    setDeferredFeedbackPrompt(false);
  }, [result, showResultModal, deferredFeedbackPrompt, feedbackRequired]);

  const runWithMinimumLoading = async <T,>(task: () => Promise<T>) => {
    const startedAt = Date.now();
    setLoading(true);
    try {
      return await task();
    } finally {
      const elapsed = Date.now() - startedAt;
      const waitMs = Math.max(0, MIN_ANALYSIS_LOADING_MS - elapsed);
      if (waitMs > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), waitMs);
        });
      }
      setLoading(false);
    }
  };

  const runWithMinimumAuthLiveLoading = async <T,>(task: () => Promise<T>) => {
    const startedAt = performance.now();
    setAuthLiveLoading(true);

    try {
      return await task();
    } finally {
      const elapsed = performance.now() - startedAt;
      const waitMs = Math.max(0, MIN_AUTH_LIVE_LOADING_MS - elapsed);
      if (waitMs > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), waitMs);
        });
      }
      setAuthLiveCompletionTick((previous) => previous + 1);
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), AUTH_LIVE_COMPLETE_PAUSE_MS);
      });
      setAuthLiveLoading(false);
    }
  };

  useEffect(() => {
    const container = googleButtonRef.current;
    if (!container) return;
    if (!showAuthModal || (authToken && !guestMode) || signupOtpRequired || forgotPasswordMode || authLiveLoading) {
      container.innerHTML = "";
      return;
    }

    let cancelled = false;
    const submitGoogleAuthRequest = async (credential: string) => {
      return fetchJsonWithWakeAndRetry<AuthPayload>({
        apiUrl,
        path: "/auth/google",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ credential }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Google sign-in is taking longer than expected. Please try again.",
      });
    };

    const handleGoogleAuthCredential = async (credential: string) => {
      setAuthError("");
      setAuthInfo("");
      setGoogleAuthLoading(true);
      try {
        const payload = await runWithMinimumAuthLiveLoading(() => submitGoogleAuthRequest(credential));
        applyAuthPayload(payload);
        if (authMode === "signup") {
          trackSignup("google");
        }
        setAuthMode("login");
        setAuthPassword("");
        setSignupOtpRequired(false);
        setSignupOtp("");
        setForgotPasswordMode(false);
        setForgotOtpRequested(false);
        setForgotOtp("");
        setForgotNewPassword("");
        setAuthInfo("Signed in with Google.");
        const consumed = await runQueuedAnalyzeAfterAuth(payload.auth_token);
        if (!consumed) router.push("/dashboard");
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Unable to sign in with Google.");
      } finally {
        setGoogleAuthLoading(false);
      }
    };

    void renderGoogleSignInButton({
      container,
      clientId: GOOGLE_CLIENT_ID,
      width: Math.min(360, Math.max(220, Math.round(container.getBoundingClientRect().width || 360))),
      text: authMode === "signup" ? "signup_with" : "continue_with",
      onCredential: (credential) => {
        if (cancelled) return;
        void handleGoogleAuthCredential(credential);
      },
      onError: (message) => {
        if (cancelled) return;
        setAuthError((prev) => prev || message);
      },
    });

    return () => {
      cancelled = true;
      container.innerHTML = "";
    };
  }, [showAuthModal, authToken, guestMode, signupOtpRequired, forgotPasswordMode, authMode, authLiveLoading, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPostAnalysisInsights = async (analysisResult: AnalysisResult, tokenOverride?: string) => {
    const headers = tokenOverride ? { Authorization: `Bearer ${tokenOverride}` } : authHeader;
    if (!headers) return;

    setAnalysisTrendLoading(true);
    setAnalysisTrendError("");
    try {
      const reportIdQuery = typeof analysisResult.report_id === "number" ? `?report_id=${analysisResult.report_id}` : "";
      const fallbackRole = role.trim() || analysisResult.positioning_strategy?.target_role || "";
      const fallbackIndustry = industry.trim() || analysisResult.salary_insight?.target_industry || "";
      const benchmarkParams = new URLSearchParams();
      if (fallbackRole) benchmarkParams.set("role", fallbackRole);
      if (fallbackIndustry) benchmarkParams.set("industry", fallbackIndustry);
      if (Number.isFinite(analysisResult.overall_score)) benchmarkParams.set("score", String(analysisResult.overall_score));
      const benchmarkQuery = reportIdQuery || (benchmarkParams.toString() ? `?${benchmarkParams.toString()}` : "");

      const [comparisonPayload, benchmarkPayload] = await Promise.all([
        fetchJsonWithWakeAndRetry<AnalysisComparison>({
          apiUrl,
          path: "/analysis/reports/compare",
          init: {
            headers: {
              ...headers,
            },
          },
          timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
          parseError: parseApiError,
          abortErrorMessage: "Trend insights are taking longer than expected. Please try again.",
        }),
        fetchJsonWithWakeAndRetry<RoleBenchmark>({
          apiUrl,
          path: `/analysis/role-benchmark${benchmarkQuery}`,
          init: {
            headers: {
              ...headers,
            },
          },
          timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
          parseError: parseApiError,
          abortErrorMessage: "Role benchmark is taking longer than expected. Please try again.",
        }),
      ]);

      setAnalysisComparison(comparisonPayload || null);
      setRoleBenchmark(benchmarkPayload || null);
    } catch (error) {
      setAnalysisComparison(null);
      setRoleBenchmark(null);
      setAnalysisTrendError(error instanceof Error ? error.message : "Unable to load comparison insights right now.");
    } finally {
      setAnalysisTrendLoading(false);
    }
  };

  const handleAnalyzeSuccess = (data: AnalysisResult, tokenOverride?: string) => {
    if (data.wallet) {
      setWallet(data.wallet);
    }
    if (data.feedback_required) {
      setFeedbackRequired(true);
      setDeferredFeedbackPrompt(true);
    }
    setResult(data);
    setActiveResultTab("summary");
    setShowResultModal(true);
    setShowRoadmapDecisionModal(false);
    setRoadmapDecisionMode("first");
    setRoadmapTracksCount(0);
    setRoadmapDecisionLoading(false);
    setRoadmapDecisionSubmitting(false);
    setRoadmapServerAction("");
    setShowRoadmapModal(false);
    setRoadmapLoading(false);
    setRoadmapError("");
    setRoadmapPreview(null);
    setRoadmapPreviewMeta(null);
    setJdInput("");
    setJdMatch(null);
    setJdUploadedFileName("");
    setShowJdScanner(false);
    setJdMatchError("");
    setInterviewPrep(null);
    setApplicationPack(null);
    setApplicationCopilot(null);
    setApplicationCopilotError("");
    setJobTrackSaveMessage("");
    setJobTrackSaving(false);
    setPrepPackError("");
    setAnalysisComparison(null);
    setRoleBenchmark(null);
    setAnalysisTrendLoading(false);
    setAnalysisTrendError("");
    setSelectedSalaryBoosters(data.salary_insight?.selected_boosters || []);
    if (data.callback_forecast?.applications_input) {
      setCallbackSimulationApps(String(data.callback_forecast.applications_input));
    }

    void loadPostAnalysisInsights(data, tokenOverride);

    trackAnalyzeComplete({
      score: data.overall_score,
      mode: analysisMode,
      location: "upload_page",
    });
  };

  const handleFeedbackSubmit = async () => {
    if (!authHeader || !authToken) {
      setFeedbackError("Login required to submit feedback.");
      return;
    }
    const comment = feedbackComment.trim();
    if (comment.length < 4) {
      setFeedbackError("Please add a short feedback comment.");
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackError("");
    try {
      const response = await fetch(apiUrl("/feedback"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          rating: feedbackRating,
          comment,
          source: "post_first_analysis",
          auth_token: authToken,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }
      const payload = (await response.json()) as AuthPayload;
      applyAuthPayload(payload);
      setFeedbackRequired(false);
      setShowFeedbackModal(false);
      setFeedbackComment("");
      setFeedbackRating(5);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : "Unable to submit feedback.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const feedbackRatingLabel =
    feedbackRating >= 5 ? "Excellent" : feedbackRating >= 4 ? "Good" : feedbackRating >= 3 ? "Average" : feedbackRating >= 2 ? "Needs Work" : "Poor";

  const promptAuthBeforeAnalyze = (mode: "manual" | "upload") => {
    setQueuedAnalyzeMode(mode);
    setAuthInfo("Login or signup to view your report.");
    setShowAuthModal(true);
    trackEvent("auth_modal_opened_before_analyze", {
      mode,
      location: "upload_page",
    });
  };

  const runQueuedAnalyzeAfterAuth = async (tokenOverride?: string) => {
    if (!queuedAnalyzeMode) {
      setShowAuthModal(false);
      return false;
    }
    const modeToRun = queuedAnalyzeMode;
    setQueuedAnalyzeMode(null);
    setShowAuthModal(false);
    if (modeToRun === "manual") {
      await executeManualAnalyze(tokenOverride);
      return true;
    }
    await executeUploadAnalyze(tokenOverride);
    return true;
  };

  const handleResendSignupOtp = async () => {
    const email = authEmail.trim();
    const password = authPassword.trim();
    if (!email || !password) {
      setAuthError("Enter email and password to resend signup OTP.");
      return;
    }

    setAuthError("");
    setAuthInfo("");
    setAuthLoading(true);
    const loadingGuard = window.setTimeout(() => {
      setAuthLoading(false);
      setAuthError((prev) => prev || "OTP resend timed out. Please try again.");
    }, AUTH_REQUEST_TIMEOUT_MS + 2500);
    try {
      const payload = await runWithMinimumAuthLiveLoading(() => submitAuthRequest("signup", email, password));
      setSignupOtpRequired(Boolean(payload.otp_required ?? true));
      setAuthInfo(payload.message || "Signup OTP sent again.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to resend signup OTP.");
    } finally {
      window.clearTimeout(loadingGuard);
      setAuthLoading(false);
    }
  };

  const handleAuthSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const email = authEmail.trim();
    const password = authPassword.trim();
    setAuthError("");
    setAuthInfo("");
    setAuthLoading(true);
    const loadingGuard = window.setTimeout(() => {
      setAuthLoading(false);
      setAuthError((prev) => prev || "Login request timed out. Please try again.");
    }, AUTH_REQUEST_TIMEOUT_MS + 2500);
    try {
      if (forgotPasswordMode) {
        if (!forgotOtpRequested) {
          if (!email) throw new Error("Enter your email first.");
          const payload = await runWithMinimumAuthLiveLoading(() => requestForgotPasswordOtp(email));
          setForgotOtpRequested(true);
          setAuthInfo(payload.message || "Reset OTP sent. Enter OTP and new password.");
          setAuthError("");
        } else {
          if (!email || !forgotOtp.trim() || !forgotNewPassword.trim()) {
            throw new Error("Enter email, OTP, and new password.");
          }
          const payload = await runWithMinimumAuthLiveLoading(() =>
            resetForgottenPassword(email, forgotOtp.trim(), forgotNewPassword.trim())
          );
          applyAuthPayload(payload);
          setForgotPasswordMode(false);
          setForgotOtpRequested(false);
          setForgotOtp("");
          setForgotNewPassword("");
          setAuthPassword("");
          setAuthInfo("Password reset successful. You are now logged in.");
          const consumed = await runQueuedAnalyzeAfterAuth(payload.auth_token);
          if (!consumed) router.push("/dashboard");
        }
      } else if (authMode === "signup" && signupOtpRequired) {
        if (!email || !signupOtp.trim()) {
          throw new Error("Enter email and OTP.");
        }
        const payload = await runWithMinimumAuthLiveLoading(() => verifySignupOtp(email, signupOtp.trim()));
        applyAuthPayload(payload);
        trackSignup("email_otp");
        setSignupOtpRequired(false);
        setSignupOtp("");
        setAuthPassword("");
        setAuthInfo("Signup complete. Welcome to HireScore.");
        const consumed = await runQueuedAnalyzeAfterAuth(payload.auth_token);
        if (!consumed) router.push("/upload");
      } else {
        if (!email || !password) {
          throw new Error("Enter email and password.");
        }
        const payload = await runWithMinimumAuthLiveLoading(() => submitAuthRequest(authMode, email, password));
        if (authMode === "signup") {
          if (!payload.otp_required) {
            trackSignup("email_password");
          }
          setSignupOtpRequired(Boolean(payload.otp_required));
          setAuthInfo(payload.message || "OTP sent to your email.");
          setAuthError("");
        } else {
          applyAuthPayload(payload);
          setAuthPassword("");
          setAuthError("");
          const consumed = await runQueuedAnalyzeAfterAuth(payload.auth_token);
          if (!consumed) router.push("/dashboard");
        }
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to authenticate right now.");
    } finally {
      window.clearTimeout(loadingGuard);
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    setAuthToken("");
    setAuthUserEmail("");
    setWallet(null);
    setGuestMode(false);
    setResult(null);
    setShowRoadmapDecisionModal(false);
    setRoadmapDecisionMode("first");
    setRoadmapTracksCount(0);
    setRoadmapDecisionLoading(false);
    setRoadmapDecisionSubmitting(false);
    setRoadmapServerAction("");
    setShowRoadmapModal(false);
    setRoadmapLoading(false);
    setRoadmapError("");
    setRoadmapPreview(null);
    setFeedbackRequired(false);
    setShowFeedbackModal(false);
    setFeedbackComment("");
    setFeedbackError("");
    setAuthInfo("");
    setApplicationCopilot(null);
    setApplicationCopilotError("");
    setJobTrackSaveMessage("");
    setJobTrackSaving(false);
    setAnalysisComparison(null);
    setRoleBenchmark(null);
    setAnalysisTrendLoading(false);
    setAnalysisTrendError("");
    setSignupOtpRequired(false);
    setSignupOtp("");
    setForgotPasswordMode(false);
    setForgotOtpRequested(false);
    setForgotOtp("");
    setForgotNewPassword("");
    clearStoredAuthToken();
  };

  const toMaybeNumber = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const buildActionResumeSource = useCallback((analysisResult: AnalysisResult | null) => {
    if (!analysisResult) return "";
    return [
      analysisSkills.trim(),
      ...(analysisResult.quick_wins || []),
      ...(analysisResult.areas_to_improve || []).flatMap((item) => item.details || []),
    ]
      .filter(Boolean)
      .join("\n")
      .trim();
  }, [analysisSkills]);

  const applicationCopilotPrefillHref = useMemo(() => {
    const params = new URLSearchParams();
    const targetRole = role.trim() || result?.positioning_strategy?.target_role || "";
    const targetIndustry = industry.trim() || result?.salary_insight?.target_industry || "";
    const resumeSource = buildActionResumeSource(result);
    const jobDescription = jdInput.trim();

    if (targetRole) params.set("role", targetRole);
    if (targetIndustry) params.set("industry", targetIndustry);
    if (resumeSource) params.set("resume_text", resumeSource.slice(0, 4000));
    if (jobDescription) params.set("job_description", jobDescription.slice(0, 4000));

    const query = params.toString();
    return query ? `/application-copilot?${query}` : "/application-copilot";
  }, [buildActionResumeSource, industry, jdInput, result, role]);

  const interviewSimulatorPrefillHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("mode", "full");
    const targetRole = role.trim() || result?.positioning_strategy?.target_role || "";
    const targetIndustry = industry.trim() || result?.salary_insight?.target_industry || "";
    const resumeSource = buildActionResumeSource(result);
    const jobDescription = jdInput.trim();

    if (targetRole) params.set("role", targetRole);
    if (targetIndustry) params.set("industry", targetIndustry);
    if (resumeSource) params.set("resume_text", resumeSource.slice(0, 4000));
    if (jobDescription) params.set("job_description", jobDescription.slice(0, 4000));

    return `/interview-simulator?${params.toString()}`;
  }, [buildActionResumeSource, industry, jdInput, result, role]);

  const executeManualAnalyze = async (tokenOverride?: string) => {
    const effectiveToken = tokenOverride || authToken;
    if (!effectiveToken) {
      promptAuthBeforeAnalyze("manual");
      return;
    }
    const normalizedIndustry = industry.trim();
    const normalizedRole = role.trim();
    const normalizedSkills = analysisSkills.trim();
    const skillTokens = parseSkillTokens(normalizedSkills);
    const experienceYearsValue = toMaybeNumber(experienceYears);
    const ageYearsValue = toMaybeNumber(ageYears);
    const isFresherFlow = experienceYearsValue === undefined || experienceYearsValue <= 1;
    const fallbackFresherSkills = `${normalizedRole} fundamentals, learning agility, communication, role readiness`;
    const effectiveSkills = normalizedSkills || fallbackFresherSkills;

    if (!normalizedIndustry || !normalizedRole) {
      setAnalysisError("Enter both target industry and target role.");
      setResult(null);
      trackEvent("analyze_validation_error", {
        mode: "manual",
        reason: "missing_role_or_industry",
        location: "upload_page",
      });
      return;
    }

    if (!isFresherFlow && skillTokens.length < 3) {
      setAnalysisError("Add at least 3 concrete skills/tools for meaningful prediction. If you are a fresher, keep experience at 0-1 years.");
      setResult(null);
      trackEvent("analyze_validation_error", {
        mode: "manual",
        reason: "insufficient_skills",
        location: "upload_page",
      });
      return;
    }

    trackAnalyzeStart("manual", "upload_page");

    setAnalysisError("");
    setResult(null);
    setShowResultModal(false);

    try {
      const authHeaders = tokenOverride ? { Authorization: `Bearer ${tokenOverride}` } : (authHeader || {});
      const data = await runWithMinimumLoading(async () => {
        const response = await fetch(apiUrl("/analyze"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            industry: normalizedIndustry,
            role: normalizedRole,
            skills: effectiveSkills,
            description: effectiveSkills,
            experience_years: experienceYearsValue,
            age_years: ageYearsValue,
            applications_count: toMaybeNumber(applicationsCount),
            salary_boost_toggles: selectedSalaryBoosters,
          }),
        });

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        const payload = (await response.json()) as AnalysisResult;
        if (typeof payload.overall_score !== "number") {
          throw new Error("Invalid analysis response");
        }
        return payload;
      });
      handleAnalyzeSuccess(data, effectiveToken);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Unable to analyze right now.");
      trackEvent("analyze_error", {
        mode: "manual",
        location: "upload_page",
      });
    }
  };

  const executeUploadAnalyze = async (tokenOverride?: string) => {
    const effectiveToken = tokenOverride || authToken;
    if (!effectiveToken) {
      promptAuthBeforeAnalyze("upload");
      return;
    }
    const normalizedIndustry = industry.trim();
    const normalizedRole = role.trim();

    if (!normalizedIndustry || !normalizedRole) {
      setAnalysisError("Enter both target industry and target role.");
      setResult(null);
      trackEvent("analyze_validation_error", {
        mode: "upload",
        reason: "missing_role_or_industry",
        location: "upload_page",
      });
      return;
    }

    trackAnalyzeStart("upload", "upload_page");

    const fileToUpload = uploadedFile;
    const uploadValidationError = validateResumeUploadFile(uploadedFile);
    if (uploadValidationError || !fileToUpload) {
      setAnalysisError(uploadValidationError);
      setResult(null);
      trackEvent("analyze_validation_error", {
        mode: "upload",
        reason: "invalid_resume_file",
        location: "upload_page",
      });
      return;
    }

    setAnalysisError("");
    setResult(null);
    setShowResultModal(false);

    try {
      const authHeaders = tokenOverride ? { Authorization: `Bearer ${tokenOverride}` } : (authHeader || {});
      const data = await runWithMinimumLoading(async () => {
        const formData = new FormData();
        formData.append("file", fileToUpload);
        formData.append("industry", normalizedIndustry);
        formData.append("role", normalizedRole);
        if (experienceYears.trim()) formData.append("experience_years", experienceYears.trim());
        if (ageYears.trim()) formData.append("age_years", ageYears.trim());
        if (applicationsCount.trim()) formData.append("applications_count", applicationsCount.trim());
        if (selectedSalaryBoosters.length > 0) formData.append("salary_boost_toggles", selectedSalaryBoosters.join(","));

        const response = await fetch(apiUrl("/analyze-resume-file"), {
          method: "POST",
          headers: {
            ...authHeaders,
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        const payload = (await response.json()) as AnalysisResult;
        if (typeof payload.overall_score !== "number") {
          throw new Error("Invalid upload analysis response");
        }
        return payload;
      });
      handleAnalyzeSuccess(data, effectiveToken);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Unable to analyze uploaded resume right now.");
      trackEvent("analyze_error", {
        mode: "upload",
        location: "upload_page",
      });
    }
  };

  const handleManualAnalyze = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authToken) {
      promptAuthBeforeAnalyze("manual");
      return;
    }
    await executeManualAnalyze();
  };

  const handleUploadAnalyze = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authToken) {
      promptAuthBeforeAnalyze("upload");
      return;
    }
    await executeUploadAnalyze();
  };

  const scoreInsight = result
    ? result.overall_score < 50
      ? "Signal weak: major rewrite needed for shortlist readiness."
      : result.overall_score < 70
        ? "Signal fair: tighten positioning and role-specific keywords."
        : result.overall_score < 85
          ? "Signal strong: polish impact statements and quantified outcomes."
          : "Signal elite: highly competitive profile for this target role."
    : "";

  const salaryProjection = useMemo(() => {
    if (!result?.salary_insight) return null;
    const insight = result.salary_insight;
    const selected = new Set(selectedSalaryBoosters);
    const selectedUplift = insight.salary_booster_options
      .filter((item) => selected.has(item.id))
      .reduce((sum, item) => sum + item.uplift_lpa, 0);

    const projectedLow = rounded(insight.base_range_lpa.low + selectedUplift * 0.72);
    const projectedHigh = rounded(insight.base_range_lpa.high + selectedUplift);

    return {
      selectedUplift: rounded(selectedUplift),
      projectedLow,
      projectedMid: rounded((projectedLow + projectedHigh) / 2),
      projectedHigh,
    };
  }, [result, selectedSalaryBoosters]);

  const callbackSimulation = useMemo(() => {
    if (!result?.callback_forecast) return null;
    const applications = Math.max(1, Number(callbackSimulationApps) || result.callback_forecast.applications_input || 60);
    const weeks = Math.max(1, result.callback_forecast.analysis_window_weeks || 4);
    const current = rounded((applications * result.callback_forecast.estimated_callback_rate) / 100);
    const improved = rounded((applications * result.callback_forecast.improved_callback_rate) / 100);
    const currentPerWeek = rounded(current / weeks);
    const improvedPerWeek = rounded(improved / weeks);
    return {
      applications,
      weeks,
      current,
      improved,
      currentPerWeek,
      improvedPerWeek,
    };
  }, [result, callbackSimulationApps]);

  const resultStepIndex = useMemo(() => {
    const foundIndex = RESULT_STEPS.findIndex((step) => step.id === activeResultTab);
    return foundIndex >= 0 ? foundIndex : 0;
  }, [activeResultTab]);

  const resultProgress = Math.round(((resultStepIndex + 1) / RESULT_STEPS.length) * 100);
  const activeResultStep = RESULT_STEPS[resultStepIndex] || RESULT_STEPS[0];
  const nextResultStep = RESULT_STEPS[Math.min(RESULT_STEPS.length - 1, resultStepIndex + 1)] || RESULT_STEPS[RESULT_STEPS.length - 1];
  const nextRoadmapPreviewMilestone = useMemo(
    () => roadmapPreview?.milestones.find((milestone) => !milestone.completed) || null,
    [roadmapPreview]
  );
  const roadmapServerActionLabel = useMemo(() => {
    if (!roadmapServerAction) return "";
    if (roadmapServerAction === "created_first_track") return "Your first roadmap track is now created.";
    if (roadmapServerAction === "created_new_track") return "New analysis direction detected. A separate roadmap track was created.";
    if (roadmapServerAction === "merged_missing_skills") return "Roadmap updated by adding only missing skill milestones.";
    if (roadmapServerAction === "no_new_missing_skills") return "Roadmap already covered this direction. Existing milestones were kept.";
    return "Roadmap updated successfully.";
  }, [roadmapServerAction]);
  const roadmapDecisionTitle =
    featureFlags.roadmap_prompt_variant === "B"
      ? roadmapDecisionMode === "first"
        ? "Create your first execution roadmap?"
        : "Apply smart roadmap update?"
      : roadmapDecisionMode === "first"
        ? "Add this analysis to your roadmap?"
        : "Update your roadmap with this analysis?";
  const roadmapDecisionDescription =
    featureFlags.roadmap_prompt_variant === "B"
      ? roadmapDecisionMode === "first"
        ? "We will convert this report into an execution track you can mark complete milestone by milestone."
        : "We will compare this run with existing tracks, keep overlaps clean, and only add new missing-skill milestones."
      : roadmapDecisionMode === "first"
        ? "This creates your first milestone track based on the analysis you just completed."
        : "We will smartly compare against existing roadmap tracks, add only missing-skill milestones, and create a separate track if this direction is different.";

  const navigateResultStep = (direction: "next" | "back") => {
    const delta = direction === "next" ? 1 : -1;
    const nextIndex = Math.min(RESULT_STEPS.length - 1, Math.max(0, resultStepIndex + delta));
    setActiveResultTab(RESULT_STEPS[nextIndex].id);
  };

  const buildRoadmapMilestones = (analysisResult: AnalysisResult) => {
    type DraftMilestone = Omit<GoalRoadmapMilestone, "completed" | "completed_at">;
    const milestoneMap = new Map<string, DraftMilestone>();
    const roleLabel = role.trim() || analysisResult.positioning_strategy?.target_role || "your target role";
    const userSkillSignals = parseSkillTokens(analysisSkills).slice(0, 14);

    const toTimeframe = (value?: string | null) => {
      const token = value?.trim();
      if (!token) return "";
      return /week|month|day/i.test(token) ? token : `${token} weeks`;
    };

    const matchSkillSignals = (text: string) => {
      const haystack = text.toLowerCase();
      return userSkillSignals.filter((skill) => haystack.includes(skill.toLowerCase())).slice(0, 4);
    };

    const priorityWeight = (value?: string | null) => {
      const token = (value || "").toLowerCase();
      if (token === "critical") return 0;
      if (token === "high") return 1;
      if (token === "medium") return 2;
      if (token === "low") return 3;
      return 4;
    };

    const registerMilestone = (draft: Partial<DraftMilestone>, fallbackIndex: number) => {
      const title = (draft.title || "").trim();
      const detail = (draft.detail || "").trim();
      if (!title || !detail) return;
      const idBase = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 44);
      const id = idBase ? `milestone-${idBase}` : `milestone-${fallbackIndex}`;
      if (milestoneMap.has(id)) return;
      milestoneMap.set(id, {
        id,
        title,
        detail,
        category: draft.category || "Execution",
        priority: draft.priority || "medium",
        timeframe: draft.timeframe || null,
        why: draft.why || null,
        done_when: draft.done_when || null,
        focus_skills: (draft.focus_skills || []).slice(0, 5),
      });
    };

    analysisResult.ninety_plus_strategy?.actions?.slice(0, 4).forEach((action, index) => {
      const actionText = `${action.action || ""} ${action.why_it_matters || ""}`;
      registerMilestone(
        {
          title: action.title || action.step_label || `Execution Action ${index + 1}`,
          detail: action.action || action.why_it_matters || "Complete this action to improve shortlist score.",
          category: "Execution",
          priority: index === 0 ? "critical" : index === 1 ? "high" : "medium",
          timeframe: toTimeframe(action.timeline_weeks),
          why: action.why_it_matters || `Improves shortlist readiness for ${roleLabel}.`,
          done_when:
            action.how_to_execute?.[0] ||
            `You can show one measurable ${roleLabel} result tied to this action in your resume.`,
          focus_skills: matchSkillSignals(actionText),
        },
        index + 1
      );
    });

    analysisResult.learning_roadmap?.phases?.slice(0, 3).forEach((phase, index) => {
      registerMilestone(
        {
          title: `${phase.phase}`,
          detail: phase.outcome || phase.focus.join(", "),
          category: "Capability Build",
          priority: index === 0 ? "high" : "medium",
          timeframe: toTimeframe(phase.duration_weeks),
          why: `Hiring teams evaluate ${roleLabel} candidates on these capability signals.`,
          done_when:
            phase.deliverables?.[0] ||
            `You can demonstrate at least one concrete proof story for ${phase.phase.toLowerCase()}.`,
          focus_skills: (phase.focus || []).slice(0, 4),
        },
        index + 11
      );
    });

    (analysisResult.quick_wins || []).slice(0, 2).forEach((win, index) => {
      registerMilestone(
        {
          title: `Quick Win ${index + 1}`,
          detail: win,
          category: "Quick Win",
          priority: "high",
          timeframe: "This week",
          why: `Fast wins increase recruiter trust and callback quality for ${roleLabel}.`,
          done_when: `You have added one quantified resume bullet proving this quick win.`,
          focus_skills: matchSkillSignals(win),
        },
        index + 21
      );
    });

    (analysisResult.areas_to_improve || []).slice(0, 2).forEach((area, index) => {
      registerMilestone(
        {
          title: area.category || `Improvement ${index + 1}`,
          detail: area.details?.[0] || "Address this area to improve profile quality.",
          category: "Profile Optimization",
          priority: "medium",
          timeframe: "1 week sprint",
          why: area.details?.[1] || `This removes friction during recruiter screening for ${roleLabel}.`,
          done_when: area.details?.[2] || `This section is reflected clearly in your updated resume.`,
          focus_skills: matchSkillSignals((area.details || []).join(" ")),
        },
        index + 31
      );
    });

    if (milestoneMap.size === 0) {
      registerMilestone(
        {
          title: "Improve role-fit alignment",
          detail: "Refine your resume bullets around role-specific outcomes and metrics.",
          category: "Baseline",
          priority: "high",
          timeframe: "Week 1",
          why: "Role-fit clarity increases initial screening success.",
          done_when: "Top 5 bullets are rewritten with role-specific language and measurable outcomes.",
          focus_skills: [],
        },
        41
      );
      registerMilestone(
        {
          title: "Strengthen keyword precision",
          detail: "Add target-role keywords naturally across summary, skills, and project lines.",
          category: "Optimization",
          priority: "medium",
          timeframe: "Week 1-2",
          why: "Keyword precision improves ATS and recruiter scanning outcomes.",
          done_when: "Resume sections include role keywords without keyword stuffing.",
          focus_skills: [],
        },
        42
      );
      registerMilestone(
        {
          title: "Quantify impact",
          detail: "Convert responsibilities into measurable achievements with numbers and outcomes.",
          category: "Proof Of Work",
          priority: "high",
          timeframe: "Week 2",
          why: "Quantified impact makes your profile more credible and interview-ready.",
          done_when: "At least 3 bullets show impact metrics, ownership, and business result.",
          focus_skills: [],
        },
        43
      );
    }

    return Array.from(milestoneMap.values())
      .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority))
      .slice(0, 8);
  };

  const fetchRoadmapTracksMeta = async () => {
    if (!authToken || !authHeader) return { count: 0, roadmaps: [] as GoalRoadmap[] };
    const payload = await fetchJsonWithWakeAndRetry<GoalRoadmapPayload>({
      apiUrl,
      path: "/roadmap/list?limit=24",
      init: {
        headers: {
          ...authHeader,
        },
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: parseApiError,
      abortErrorMessage: "Roadmap lookup is taking longer than expected. Please try again.",
    });
    const tracks = Array.isArray(payload.roadmaps) ? payload.roadmaps : [];
    return { count: payload.count ?? tracks.length, roadmaps: tracks };
  };

  const buildRoadmapUpsertBody = (analysisResult: AnalysisResult) => {
    const milestones = buildRoadmapMilestones(analysisResult);
    const targetRole =
      analysisResult.positioning_strategy?.target_role ||
      analysisResult.learning_roadmap?.target_role ||
      analysisResult.salary_insight?.target_role ||
      role.trim() ||
      "your target role";
    const targetIndustry =
      analysisResult.learning_roadmap?.target_industry || analysisResult.salary_insight?.target_industry || industry.trim() || "your target industry";
    const targetScore = analysisResult.ninety_plus_strategy?.target_score || 90;

    return {
      goal_title: `Reach ${targetScore}% shortlist probability`,
      goal_context: analysisResult.shortlist_prediction || "Improve your profile for stronger interview conversion.",
      target_role: targetRole,
      target_industry: targetIndustry,
      target_score: targetScore,
      current_score: analysisResult.overall_score,
      milestones,
      auth_token: authToken,
    };
  };

  const previewRoadmapUpsertFromResult = async (analysisResult: AnalysisResult) => {
    if (!authToken || !authHeader) return null;
    const payload = await fetchJsonWithWakeAndRetry<RoadmapPreviewPayload>({
      apiUrl,
      path: "/roadmap/preview-upsert",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify(buildRoadmapUpsertBody(analysisResult)),
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: parseApiError,
      abortErrorMessage: "Roadmap preview is taking longer than expected. Please try again.",
    });
    return payload;
  };

  const upsertRoadmapFromResult = async (analysisResult: AnalysisResult) => {
    if (!authToken || !authHeader) return null;
    const payload = await fetchJsonWithWakeAndRetry<GoalRoadmapPayload>({
      apiUrl,
      path: "/roadmap/upsert",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify(buildRoadmapUpsertBody(analysisResult)),
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: parseApiError,
      abortErrorMessage: "Roadmap creation is taking longer than expected. Please try again.",
    });

    return payload;
  };

  const handleConfirmRoadmapDecision = async () => {
    if (!result) return;
    setRoadmapDecisionSubmitting(true);
    setRoadmapError("");
    setRoadmapLoading(true);
    setShowRoadmapModal(true);
    try {
      const payload = await upsertRoadmapFromResult(result);
      const nextRoadmap = payload?.roadmap || null;
      if (!nextRoadmap) {
        throw new Error("Unable to prepare roadmap right now.");
      }
      setRoadmapPreview(nextRoadmap);
      setRoadmapServerAction(payload?.action || "");
      if (Array.isArray(payload?.roadmaps)) {
        setRoadmapTracksCount(payload.roadmaps.length);
      }
      setShowRoadmapDecisionModal(false);
      setRoadmapPreviewMeta(null);
    } catch (error) {
      setRoadmapPreview(null);
      setRoadmapError(error instanceof Error ? error.message : "Unable to prepare roadmap right now.");
    } finally {
      setRoadmapLoading(false);
      setRoadmapDecisionSubmitting(false);
    }
  };

  const handleUploadJdFile = async (file: File | null) => {
    if (!file) return;
    if (!authToken || !authHeader) {
      setJdMatchError("Login required to upload a JD file.");
      return;
    }

    const normalizedName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || normalizedName.endsWith(".pdf");
    const isText = file.type.startsWith("text/") || normalizedName.endsWith(".txt");
    const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(normalizedName);
    if (!isPdf && !isText && !isImage) {
      setJdMatchError("Upload a JD as PDF, TXT, or image (JPG/PNG/WebP).");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setJdMatchError("JD file is too large. Keep it under 12 MB.");
      return;
    }

    setJdMatchError("");
    setJdMatch(null);
    setJdFileUploading(true);
    try {
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
        abortErrorMessage: "JD file extraction is taking longer than expected. Please try again.",
      });

      setJdInput(payload.job_description || "");
      setJdUploadedFileName(payload.file_name || file.name);
      setShowJdScanner(true);
    } catch (error) {
      setJdMatchError(error instanceof Error ? error.message : "Unable to extract JD text from the uploaded file.");
    } finally {
      setJdFileUploading(false);
    }
  };

  const handleRunJdMatch = async () => {
    if (!result) return;
    if (!authToken || !authHeader) {
      setJdMatchError("Login required to run JD match.");
      return;
    }
    const jobDescription = jdInput.trim();
    if (jobDescription.length < 24) {
      setJdMatchError("Paste a fuller job description (at least 24 characters).");
      return;
    }

    const resumeSource = buildActionResumeSource(result);
    if (resumeSource.length < 24) {
      setJdMatchError("Add your current skills first so JD match can evaluate role alignment.");
      return;
    }

    setJdMatchError("");
    trackEvent("jd_match_started", { location: "upload_page" });
    setJdMatchLoading(true);
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
            industry: industry.trim() || result.salary_insight?.target_industry || "General",
            role: role.trim() || result.positioning_strategy?.target_role || "Target role",
            resume_text: resumeSource,
            job_description: jobDescription,
            auth_token: authToken,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "JD match is taking longer than expected. Please try again.",
      });
      if (payload.wallet) {
        setWallet(payload.wallet);
      }
      setJdMatch(payload);
      trackEvent("jd_match_completed", {
        location: "upload_page",
        match_score: payload.match_percentage ?? payload.match_score ?? 0,
      });
    } catch (error) {
      setJdMatch(null);
      setJdMatchError(error instanceof Error ? error.message : "Unable to run JD match right now.");
    } finally {
      setJdMatchLoading(false);
    }
  };

  const handleGenerateInterviewPrep = async () => {
    if (!result) return;
    if (!authToken || !authHeader) {
      setPrepPackError("Login required to generate interview prep.");
      return;
    }
    setPrepPackError("");
    trackEvent("interview_prep_started", { location: "upload_page" });
    setInterviewPrepLoading(true);
    try {
      const payload = await fetchJsonWithWakeAndRetry<InterviewPrepPayload>({
        apiUrl,
        path: "/analysis/interview-prep",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            industry: industry.trim() || result.salary_insight?.target_industry || "General",
            role: role.trim() || result.positioning_strategy?.target_role || "Target role",
            job_description: jdInput.trim(),
            critical_missing_skills: (result.ninety_plus_strategy?.actions || [])
              .map((item) => item.title || item.action)
              .slice(0, 4),
            auth_token: authToken,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Interview prep generation is taking longer than expected. Please try again.",
      });
      setInterviewPrep(payload);
      trackEvent("interview_prep_generated", { location: "upload_page" });
    } catch (error) {
      setPrepPackError(error instanceof Error ? error.message : "Unable to generate interview prep right now.");
    } finally {
      setInterviewPrepLoading(false);
    }
  };

  const handleGenerateApplicationPack = async () => {
    if (!result) return;
    if (!authToken || !authHeader) {
      setPrepPackError("Login required to create your job apply kit.");
      return;
    }
    const resumeSource = buildActionResumeSource(result);
    if (resumeSource.length < 24) {
      setPrepPackError("Add your current skills first to create a personalized job apply kit.");
      return;
    }

    setPrepPackError("");
    trackEvent("application_pack_started", { location: "upload_page" });
    setApplicationPackLoading(true);
    try {
      const payload = await fetchJsonWithWakeAndRetry<ApplicationPackPayload>({
        apiUrl,
        path: "/analysis/application-pack",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            industry: industry.trim() || result.salary_insight?.target_industry || "General",
            role: role.trim() || result.positioning_strategy?.target_role || "Target role",
            resume_text: resumeSource,
            job_description: jdInput.trim(),
            auth_token: authToken,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Application pack generation is taking longer than expected. Please try again.",
      });
      setApplicationPack(payload);
      trackEvent("application_pack_generated", { location: "upload_page" });
    } catch (error) {
      setPrepPackError(error instanceof Error ? error.message : "Unable to create your job apply kit right now.");
    } finally {
      setApplicationPackLoading(false);
    }
  };

  const handleRunApplicationCopilot = async () => {
    if (!result) return;
    if (!authToken || !authHeader) {
      setApplicationCopilotError("Login required to run Application Copilot.");
      return;
    }

    const resumeSource = buildActionResumeSource(result);
    if (resumeSource.length < 24) {
      setApplicationCopilotError("Add your current skills first so Copilot can produce personalized outputs.");
      return;
    }
    const jobDescription = jdInput.trim();
    if (jobDescription.length < 24) {
      setApplicationCopilotError("Paste or upload a fuller JD first, then run Full Application Copilot.");
      return;
    }

    setApplicationCopilotError("");
    setJobTrackSaveMessage("");
    trackEvent("application_copilot_started", { location: "upload_page" });
    setApplicationCopilotLoading(true);
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
            industry: industry.trim() || result.salary_insight?.target_industry || "General",
            role: role.trim() || result.positioning_strategy?.target_role || "Target role",
            resume_text: resumeSource,
            job_description: jobDescription,
            auth_token: authToken,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Application Copilot is taking longer than expected. Please try again.",
      });
      if (payload.wallet) {
        setWallet(payload.wallet);
      }
      setApplicationCopilot(payload);
      trackEvent("application_copilot_generated", {
        location: "upload_page",
        match_percentage: payload.match_percentage || 0,
      });
    } catch (error) {
      setApplicationCopilot(null);
      setApplicationCopilotError(error instanceof Error ? error.message : "Unable to run Application Copilot right now.");
    } finally {
      setApplicationCopilotLoading(false);
    }
  };

  const handleSaveAsJobTrack = async () => {
    if (!authToken || !authHeader) {
      setApplicationCopilotError("Login required to save a Job Track.");
      return;
    }
    if (!applicationCopilot) {
      setApplicationCopilotError("Run Full Application Copilot first, then save as Job Track.");
      return;
    }

    setApplicationCopilotError("");
    setJobTrackSaveMessage("");
    setJobTrackSaving(true);
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
            role: role.trim() || applicationCopilot.role || "Target role",
            industry: industry.trim() || applicationCopilot.industry || "General",
            company: applicationCopilot.company || "",
            status: "saved",
            copilot_payload: applicationCopilot,
            auth_token: authToken,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Saving Job Track is taking longer than expected. Please try again.",
      });
      const trackId = payload.job_track?.id || 0;
      setJobTrackSaveMessage(trackId > 0 ? `Saved to Job Track #${trackId}.` : "Saved to Job Track.");
      trackEvent("job_track_saved_from_upload", {
        location: "upload_page",
        track_id: trackId,
      });
    } catch (error) {
      setApplicationCopilotError(error instanceof Error ? error.message : "Unable to save this Job Track right now.");
    } finally {
      setJobTrackSaving(false);
    }
  };

  const handleCloseResultModal = () => {
    setShowResultModal(false);
    setActiveResultTab("summary");
    if (!result || !authToken) return;
    setShowRoadmapModal(false);
    setRoadmapPreview(null);
    setRoadmapPreviewMeta(null);
    setRoadmapServerAction("");
    setShowRoadmapDecisionModal(true);
    setRoadmapDecisionLoading(true);
    setRoadmapError("");
    void (async () => {
      try {
        const [tracksPayload, previewPayload] = await Promise.all([
          fetchRoadmapTracksMeta(),
          previewRoadmapUpsertFromResult(result),
        ]);
        const totalTracks = Math.max(0, tracksPayload.count);
        setRoadmapTracksCount(totalTracks);
        if (previewPayload) {
          setRoadmapPreviewMeta(previewPayload);
          const previewAction = previewPayload.action || "";
          if (previewAction === "created_first_track") {
            setRoadmapDecisionMode("first");
          } else {
            setRoadmapDecisionMode("update");
          }
        } else {
          setRoadmapDecisionMode(totalTracks > 0 ? "update" : "first");
        }
      } catch (error) {
        setRoadmapTracksCount(0);
        setRoadmapPreviewMeta(null);
        setRoadmapDecisionMode("first");
        setRoadmapError(error instanceof Error ? error.message : "Unable to check roadmap state right now.");
      } finally {
        setRoadmapDecisionLoading(false);
      }
    })();
  };
  closeResultModalRef.current = handleCloseResultModal;

  const analysisFieldClass =
    "w-full rounded-2xl border border-amber-100/28 bg-[#1a1020]/78 px-4 py-3.5 text-amber-50 placeholder:text-amber-100/40 outline-none transition focus:border-rose-100/70 focus:shadow-[0_0_0_3px_rgba(255,186,138,0.2)]";
  const analysisTextAreaClass = `${analysisFieldClass} min-h-28 leading-relaxed`;

  const fieldClass =
    "w-full rounded-2xl border border-cyan-200/35 bg-[#021327]/92 px-4 py-3.5 text-cyan-50 placeholder:text-cyan-100/45 outline-none transition focus:border-cyan-100 focus:shadow-[0_0_0_3px_rgba(128,240,255,0.18)]";

  const textAreaClass = `${fieldClass} min-h-28 leading-relaxed`;

  return (
    <main className="relative min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-10 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="premium-panel relative overflow-hidden rounded-[2rem] p-5 sm:p-8 lg:p-10"
        >
          <div className="absolute -left-10 top-4 h-44 w-44 rounded-full bg-cyan-300/24 blur-[85px]" />
          <div className="absolute right-[-48px] top-28 h-52 w-52 rounded-full bg-amber-200/18 blur-[95px]" />

          <div className="relative z-10 grid gap-7 lg:grid-cols-[1.3fr_0.7fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-100/28 bg-cyan-100/8 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-cyan-100/86 sm:px-4 sm:text-xs sm:tracking-[0.22em]">
                <span className="live-dot" />
                Analysis First
              </p>

              <h1 className="mt-4 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">
                Know Your Shortlist Chances
                <span className="block bg-gradient-to-r from-cyan-100 via-cyan-300 to-amber-100 bg-clip-text text-transparent">
                  Before You Apply
                </span>
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-cyan-50/80 sm:text-base">
                {featureFlags.onboarding_copy_variant === "B"
                  ? "Run one focused analysis and get a guided execution flow: score clarity, callback forecast, salary direction, and roadmap actions."
                  : "Enter role details, run analysis, and get an easy report: score, interview chances, salary direction, and next-step actions."}
              </p>

              <form
                onSubmit={analysisMode === "manual" ? handleManualAnalyze : handleUploadAnalyze}
                className="analysis-orbit-card mt-6 rounded-3xl p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-amber-100/78">Step 1</p>
                    <h2 className="mt-1 text-xl font-semibold sm:text-2xl">
                      <span className="analyze-heading-prism" data-text="Fill Your Profile For Analysis">
                        Fill Your Profile For Analysis
                      </span>
                    </h2>
                    <p className="mt-1 text-xs text-amber-100/82">Use this form first. You can login/signup after clicking Analyze.</p>
                  </div>
                  <div className="inline-flex rounded-xl border border-amber-100/30 bg-rose-50/10 p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setAnalysisMode("manual");
                        setAnalysisError("");
                      }}
                      className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                        analysisMode === "manual" ? "bg-amber-200/26 text-amber-50" : "text-amber-50/70 hover:text-amber-50"
                      }`}
                    >
                      Manual Input
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAnalysisMode("upload");
                        setAnalysisError("");
                      }}
                      className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                        analysisMode === "upload" ? "bg-amber-200/26 text-amber-50" : "text-amber-50/70 hover:text-amber-50"
                      }`}
                    >
                      Upload Resume
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-amber-100/24 bg-[#24162a]/58 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {!authToken || guestMode ? (
                        <button
                          type="button"
                          onClick={() => setShowAuthModal(true)}
                          className="rounded-xl border border-amber-100/38 bg-amber-100/14 px-3 py-1.5 font-semibold text-amber-50 transition hover:bg-amber-100/20"
                        >
                          Login / Signup
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleSignOut}
                          className="rounded-xl border border-rose-100/32 bg-transparent px-3 py-1.5 font-semibold text-rose-50/88 transition hover:bg-rose-100/12"
                        >
                          Sign Out
                        </button>
                      )}
                      {authToken && (
                        <span className="rounded-full border border-amber-100/24 bg-amber-100/10 px-2.5 py-1 text-amber-50/84">
                          {guestMode ? "Public Access" : "Signed In"}
                        </span>
                      )}
                      {authToken && wallet && !guestMode && (
                        <>
                          <span className="rounded-full border border-amber-100/24 bg-amber-100/10 px-2.5 py-1 text-amber-50/84">Credits: {wallet.credits}</span>
                          <span className="rounded-full border border-amber-100/24 bg-amber-100/10 px-2.5 py-1 text-amber-50/84">Reports: {remainingAnalyze}</span>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                    <TrackedLink
                      href={buyCreditsHref}
                      eventName="cta_view_premium_plans_click"
                      eventParams={{ cta_location: "upload_toolbar", cta_label: "Buy Credits" }}
                      className="rounded-xl border border-rose-100/34 bg-rose-100/12 px-3 py-1.5 text-center font-semibold text-rose-50 transition hover:bg-rose-100/18"
                    >
                      Buy Credits
                    </TrackedLink>
                      {feedbackRequired && (
                        <button
                          type="button"
                          onClick={() => setShowFeedbackModal(true)}
                          className="rounded-xl border border-amber-100/40 bg-amber-100/12 px-3 py-1.5 font-semibold text-amber-50 transition hover:bg-amber-100/20"
                        >
                          Submit Feedback
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-amber-100/82">Flow: Fill details, click Analyze, then read your report.</p>
                  {!authToken && <p className="mt-3 text-xs text-amber-100/82">New users get 5 free credits on signup (one full analysis).</p>}
                  {authToken && !guestMode && authUserEmail && <p className="mt-2 text-xs text-amber-50/74">Signed in as: {authUserEmail}</p>}
                  {authToken && guestMode && <p className="mt-2 text-xs text-amber-50/74">Public access session active. Login anytime to save work to a real account.</p>}
                </div>

                <div className="mt-5 rounded-2xl border border-amber-100/20 bg-amber-100/[0.05] p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-amber-100/78">Role Target</p>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-amber-50/90">Target Industry</label>
                      <input
                        type="text"
                        value={industry}
                        onChange={(event) => {
                          setIndustry(event.target.value);
                          setAnalysisError("");
                        }}
                        placeholder="AI, FinTech, Product, Marketing"
                        className={analysisFieldClass}
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-amber-50/90">Target Role</label>
                      <input
                        type="text"
                        value={role}
                        list="hirescore-role-suggestions"
                        onChange={(event) => {
                          setRole(event.target.value);
                          setAnalysisError("");
                        }}
                        placeholder="Product Manager, Account Executive, Backend Engineer"
                        className={analysisFieldClass}
                        required
                      />
                      <datalist id="hirescore-role-suggestions">
                        {ROLE_EXAMPLE_TITLES.map((title) => (
                          <option key={title} value={title} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-amber-100/20 bg-amber-100/[0.05] p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-amber-100/78">Profile Signals</p>
                  <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <label className="mb-2 block min-h-[2.8rem] text-sm font-medium leading-snug text-amber-50/90">Years of Experience (optional)</label>
                      <input
                        type="number"
                        min="0"
                        max="35"
                        step="0.5"
                        value={experienceYears}
                        onChange={(event) => setExperienceYears(event.target.value)}
                        placeholder="2"
                        className={analysisFieldClass}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block min-h-[2.8rem] text-sm font-medium leading-snug text-amber-50/90">Age (optional)</label>
                      <input
                        type="number"
                        min="16"
                        max="70"
                        step="1"
                        value={ageYears}
                        onChange={(event) => setAgeYears(event.target.value)}
                        placeholder="24"
                        className={analysisFieldClass}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block min-h-[2.8rem] text-sm font-medium leading-snug text-amber-50/90">Job Applications Planned Per Week</label>
                      <input
                        type="number"
                        min="1"
                        max="2500"
                        value={applicationsCount}
                        onChange={(event) => setApplicationsCount(event.target.value)}
                        placeholder="30"
                        className={analysisFieldClass}
                      />
                    </div>
                  </div>
                </div>

                {analysisMode === "manual" ? (
                  <div className="mt-4 rounded-2xl border border-amber-100/20 bg-amber-100/[0.05] p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-amber-100/78">Skill Snapshot</p>
                    <label className="mb-2 mt-3 block text-sm font-medium text-amber-50/90">Current Skills (optional for freshers)</label>
                    <textarea
                      value={analysisSkills}
                      onChange={(event) => {
                        setAnalysisSkills(event.target.value);
                        setAnalysisError("");
                      }}
                      placeholder="SQL, Python, Tableau OR CRM, lead generation, negotiation... (freshers can leave this blank)"
                      className={`${analysisTextAreaClass} min-h-36`}
                    />
                    <p className="mt-2 text-xs text-amber-50/70">Experienced users: add at least 3 specific skills. Freshers (0-1 years): you can leave this blank.</p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-amber-100/20 bg-amber-100/[0.05] p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-amber-100/78">Resume Upload</p>
                    <label className="mb-2 mt-3 block text-sm font-medium text-amber-50/90">
                      Resume File (PDF, DOCX, TXT, or image)
                    </label>
                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setIsDragging(false);
                        const file = event.dataTransfer.files?.[0];
                        if (file) {
                          const validationError = validateResumeUploadFile(file);
                          if (validationError) {
                            setAnalysisError(validationError);
                            setUploadedFile(null);
                            trackEvent("resume_file_rejected", {
                              source: "drag_drop",
                              extension: fileExtension(file.name),
                              location: "upload_page",
                            });
                            return;
                          }
                          setUploadedFile(file);
                          setAnalysisError("");
                          trackEvent("resume_file_selected", {
                            source: "drag_drop",
                            extension: fileExtension(file.name),
                            location: "upload_page",
                          });
                        }
                      }}
                      className={`rounded-2xl border-2 border-dashed p-7 text-center transition ${
                        isDragging ? "border-amber-200/70 bg-amber-100/14" : "border-amber-100/34 bg-amber-100/7"
                      }`}
                    >
                      {!uploadedFile ? (
                        <>
                          <p className="text-base font-semibold text-amber-50">Drag and drop your resume here</p>
                          <p className="mt-1 text-sm text-amber-50/70">or select file manually</p>
                          <label className="mt-4 inline-block cursor-pointer rounded-xl border border-amber-100/36 bg-amber-100/16 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-amber-100/24">
                            Browse File
                            <input
                              type="file"
                              accept=".pdf,.txt,.docx,image/*"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0] || null;
                                if (!file) return;
                                const validationError = validateResumeUploadFile(file);
                                if (validationError) {
                                  setAnalysisError(validationError);
                                  setUploadedFile(null);
                                  trackEvent("resume_file_rejected", {
                                    source: "file_picker",
                                    extension: fileExtension(file.name),
                                    location: "upload_page",
                                  });
                                  return;
                                }
                                setUploadedFile(file);
                                setAnalysisError("");
                                trackEvent("resume_file_selected", {
                                  source: "file_picker",
                                  extension: fileExtension(file.name),
                                  location: "upload_page",
                                });
                              }}
                            />
                          </label>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-amber-50">Selected: {uploadedFile.name}</p>
                          <button
                            type="button"
                            onClick={() => setUploadedFile(null)}
                            className="text-sm text-amber-100/90 transition hover:text-amber-100"
                          >
                            Remove file
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-amber-50/70">Max file size: 12 MB.</p>
                  </div>
                )}

                <div className="mt-5 rounded-2xl border border-amber-100/20 bg-amber-100/[0.05] p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-amber-100/78">Actions</p>
                  {analysisError && (
                    <div className="mt-3 rounded-xl border border-amber-100/42 bg-amber-100/14 px-3 py-2 text-sm text-amber-50">{analysisError}</div>
                  )}
                  <div className="mt-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full rounded-2xl border border-amber-100/45 bg-gradient-to-r from-rose-500/34 via-amber-300/28 to-orange-300/28 px-5 py-3.5 text-sm font-semibold tracking-wide text-amber-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-75"
                    >
                      {loading ? "Analyzing..." : analysisMode === "manual" ? "Analyze My Profile" : "Analyze Uploaded Resume"}
                    </button>
                  </div>
                </div>

                {result && !showResultModal && (
                  <button
                    type="button"
                    onClick={() => setShowResultModal(true)}
                    className="mt-3 w-full rounded-2xl border border-amber-100/32 bg-amber-100/14 px-5 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-100/24"
                  >
                    View Last Analysis Report
                  </button>
                )}
              </form>
            </div>

            <aside className="space-y-4">
              <div className="neon-panel rounded-3xl p-5 sm:p-6">
                <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/66 sm:text-xs sm:tracking-[0.2em]">How It Works</p>
                <h3 className="mt-2 text-lg font-semibold text-cyan-50">Analysis Flow</h3>
                <div className="mt-4 space-y-3 text-sm text-cyan-50/78">
                  {[
                    "Fill details and click Analyze.",
                    "Login popup appears only if needed.",
                    "Read Summary tab first in the report.",
                    "Then check Strategy -> Salary -> Hiring Timing.",
                  ].map((item, index) => (
                    <div key={item} className="flex items-start gap-2 rounded-xl border border-cyan-100/18 bg-cyan-100/8 px-3 py-2.5">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-100/35 bg-cyan-200/18 text-[11px] font-semibold text-cyan-50">
                        {index + 1}
                      </span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="neon-panel rounded-3xl p-5 sm:p-6">
                <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/66 sm:text-xs sm:tracking-[0.2em]">Smart Role Matching</p>
                <h3 className="mt-2 text-lg font-semibold text-cyan-50">Find Your Best-Fit Job Direction Faster</h3>
                <div className="mt-4 space-y-2 text-sm text-cyan-50/76">
                  <p>- Type any target job title and get a role-fit score instantly.</p>
                  <p>- Discover nearby roles where your current profile has stronger shortlisting chances.</p>
                  <p>- Get a personalized action plan to improve interview callbacks quickly.</p>
                  <p className="text-cyan-100">Tip: users who follow the suggested plan usually improve score and callback rate in a few weeks.</p>
                </div>
              </div>
            </aside>
          </div>
        </motion.section>

        {showAuthModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[190] flex items-start justify-center overflow-y-auto bg-[#020915]/90 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm sm:items-center"
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              if (authLoading || googleAuthLoading) return;
              setShowAuthModal(false);
              setQueuedAnalyzeMode(null);
            }}
          >
            <motion.section
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              onClick={(event) => event.stopPropagation()}
              className="my-auto w-full max-w-xl overflow-y-auto rounded-[1.7rem] border border-cyan-100/26 bg-[#04172e]/96 p-6 shadow-[0_35px_100px_rgba(0,0,0,0.6)] max-h-[calc(100dvh-2rem)]"
            >
              <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/70">Login Required</p>
              <h3 className="mt-2 text-2xl font-semibold text-cyan-50">Unlock Your Analysis Report</h3>
              <p className="mt-2 text-sm text-cyan-50/72">
                {forgotPasswordMode
                  ? "Reset password via OTP."
                  : signupOtpRequired
                    ? "Enter OTP sent to your email to complete signup."
                    : authMode === "signup"
                      ? "Get 5 free credits on signup and unlock your report."
                      : "Sign in once, then your report opens automatically."}
              </p>

              <form onSubmit={handleAuthSubmit} className="mt-4 space-y-3">
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="Email"
                  className={fieldClass}
                />
                {forgotPasswordMode ? (
                  forgotOtpRequested ? (
                    <input
                      type="text"
                      value={forgotOtp}
                      onChange={(event) => setForgotOtp(event.target.value)}
                      placeholder="Reset OTP"
                      className={fieldClass}
                    />
                  ) : (
                    <input disabled value="" placeholder="OTP will be sent to this email" className={`${fieldClass} opacity-70`} />
                  )
                ) : signupOtpRequired ? (
                  <input
                    type="text"
                    value={signupOtp}
                    onChange={(event) => setSignupOtp(event.target.value)}
                    placeholder="Signup OTP"
                    className={fieldClass}
                  />
                ) : (
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    placeholder="Password"
                    className={fieldClass}
                  />
                )}
                {forgotPasswordMode && forgotOtpRequested && (
                  <input
                    type="password"
                    value={forgotNewPassword}
                    onChange={(event) => setForgotNewPassword(event.target.value)}
                    placeholder="New password"
                    className={fieldClass}
                  />
                )}
                {signupOtpRequired && !forgotPasswordMode && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleResendSignupOtp()}
                      disabled={authLoading || googleAuthLoading || authLiveLoading}
                      className="rounded-lg border border-cyan-100/28 bg-cyan-100/8 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan-100 transition hover:bg-cyan-100/14 disabled:opacity-55"
                    >
                      {authLoading || authLiveLoading ? "Resending..." : "Resend Signup OTP"}
                    </button>
                  </div>
                )}

                {!forgotPasswordMode && !signupOtpRequired && (
                  <div className="pt-1">
                    <p className="text-center text-[11px] uppercase tracking-[0.16em] text-cyan-100/62">or continue with</p>
                    <div className="mt-2 flex w-full justify-center">
                      <div ref={googleButtonRef} className="min-h-[44px] w-full max-w-[360px] rounded-full" />
                    </div>
                    {googleAuthLoading && <p className="mt-2 text-center text-xs text-cyan-100/78">Completing Google sign-in...</p>}
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                  <button
                    type="submit"
                    disabled={authLoading || googleAuthLoading}
                    className="w-full min-h-[44px] touch-manipulation rounded-xl border border-cyan-100/35 bg-cyan-200/16 px-3 py-2 text-center text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:opacity-60 sm:min-w-[120px] sm:flex-1"
                  >
                    {authLoading || googleAuthLoading
                      ? "Please wait..."
                      : forgotPasswordMode
                        ? forgotOtpRequested
                          ? "Reset Password"
                          : "Send Reset OTP"
                        : authMode === "signup"
                          ? signupOtpRequired
                            ? "Verify OTP"
                            : "Send Signup OTP"
                          : "Login"}
                  </button>
                  {!forgotPasswordMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode((prev) => (prev === "signup" ? "login" : "signup"));
                        setSignupOtpRequired(false);
                        setSignupOtp("");
                        setAuthInfo("");
                        setAuthError("");
                      }}
                      className="w-full min-h-[44px] touch-manipulation rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-center text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10 sm:min-w-[120px] sm:flex-1"
                    >
                      {authMode === "signup" ? "Use Login" : "Use Signup"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setForgotPasswordMode((prev) => !prev);
                      setForgotOtpRequested(false);
                      setForgotOtp("");
                      setForgotNewPassword("");
                      setSignupOtpRequired(false);
                      setSignupOtp("");
                      setAuthInfo("");
                      setAuthError("");
                    }}
                    className="w-full min-h-[44px] touch-manipulation rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-center text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10 sm:min-w-[120px] sm:flex-1"
                  >
                    {forgotPasswordMode ? "Back To Login" : "Forgot Password"}
                  </button>
                </div>
              </form>

              {authInfo && <p className="mt-3 text-xs text-emerald-100">{authInfo}</p>}
              {authError && <p className="mt-2 text-xs text-amber-100">{authError}</p>}
            </motion.section>
          </motion.div>
        )}

        {authLiveLoading && <AuthLiveOverlay completionTick={authLiveCompletionTick} />}

        {loading && <AnalysisLiveOverlay />}

        {showResultModal && result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[260] flex items-center justify-center bg-[#020915]/88 p-1 backdrop-blur-sm sm:p-4"
            onClick={handleCloseResultModal}
          >
            <motion.section
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              onClick={(event) => event.stopPropagation()}
              className="mx-auto my-0 flex h-[calc(100dvh-0.75rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[1rem] border border-cyan-100/22 bg-[#041427]/96 shadow-[0_35px_100px_rgba(0,0,0,0.65)] sm:h-[calc(100dvh-2rem)] sm:rounded-[2rem]"
            >
              <div className="border-b border-cyan-100/14 px-3 py-3 sm:px-6 sm:py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/72">Analysis Complete</p>
                    <h3 className="mt-1 text-lg font-semibold text-cyan-50 sm:text-2xl">{result.shortlist_prediction || "Shortlist Analysis Report"}</h3>
                    <p className="text-[13px] text-cyan-50/72 sm:text-sm">{scoreInsight}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCloseResultModal}
                    className="rounded-xl border border-cyan-100/28 bg-[#082640]/78 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-50/90 transition hover:bg-[#0d3358]"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex flex-1 flex-col lg:flex-row">
                <aside className="hidden h-full w-[290px] shrink-0 overflow-y-auto border-r border-cyan-100/12 bg-cyan-100/4 px-4 py-5 pb-24 lg:block">
                  <div className="rounded-2xl border border-cyan-100/20 bg-cyan-100/6 p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Score</p>
                    <div className="mt-2 flex items-end gap-2">
                      <p className="text-3xl font-semibold text-cyan-50">{result.overall_score}%</p>
                      {typeof result.confidence === "number" && <p className="mb-1 text-xs text-cyan-100/72">Confidence {result.confidence}%</p>}
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full border border-cyan-100/18 bg-cyan-100/8">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${result.overall_score}%` }}
                        transition={{ duration: 0.55, ease: "easeOut" }}
                        className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200"
                      />
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-cyan-100/18 bg-cyan-100/5 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/70">Sections</p>
                    <div className="mt-2 space-y-1.5">
                      {RESULT_STEPS.map((step, stepIndex) => {
                        const active = step.id === activeResultTab;
                        return (
                          <button
                            key={step.id}
                            type="button"
                            onClick={() => setActiveResultTab(step.id)}
                            className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${
                              active
                                ? "border-cyan-100/45 bg-cyan-200/18"
                                : "border-cyan-100/16 bg-cyan-100/5 hover:bg-cyan-100/12"
                            }`}
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan-100/72">Step {stepIndex + 1}</p>
                            <p className="mt-0.5 text-sm font-semibold text-cyan-50">{step.label}</p>
                            <p className="mt-0.5 text-[11px] text-cyan-50/68">{step.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </aside>

                <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24 sm:p-5 sm:pb-28">
                  <div className="mx-auto w-full max-w-5xl">
                    <div className="rounded-2xl border border-cyan-100/20 bg-cyan-100/7 p-3 sm:p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/72">
                          Step {resultStepIndex + 1} of {RESULT_STEPS.length}
                        </p>
                        <p className="text-sm font-semibold text-cyan-50">{activeResultStep.label}</p>
                      </div>
                      <p className="mt-2 text-xs text-cyan-50/74 sm:text-sm">{activeResultStep.description}</p>
                      <div className="mt-3 h-2 overflow-hidden rounded-full border border-cyan-100/20 bg-cyan-100/8">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${resultProgress}%` }}
                          transition={{ duration: 0.35, ease: "easeOut" }}
                          className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200"
                        />
                      </div>
                      <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
                        {RESULT_STEPS.map((step) => {
                          const active = activeResultTab === step.id;
                          return (
                            <button
                              key={step.id}
                              type="button"
                              onClick={() => setActiveResultTab(step.id)}
                              className={`shrink-0 rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                                active
                                  ? "border-cyan-100/46 bg-cyan-200/20 text-cyan-50"
                                  : "border-cyan-100/20 bg-cyan-100/5 text-cyan-50/75 hover:bg-cyan-100/12"
                              }`}
                            >
                              {step.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <motion.div key={activeResultTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }} className="mt-4">
                {activeResultTab === "summary" && (
                  <div className="space-y-4 sm:space-y-5">
                    <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
                      <div className="flex flex-col items-center justify-center rounded-3xl border border-cyan-100/20 bg-cyan-300/6 p-6 text-center">
                        <div
                          className="relative flex h-40 w-40 items-center justify-center rounded-full p-[12px] sm:h-44 sm:w-44"
                          style={{
                            background: `conic-gradient(#45f0df ${result.overall_score}%, rgba(93,138,168,0.2) ${result.overall_score}% 100%)`,
                          }}
                        >
                          <div className="pointer-events-none absolute inset-1 rounded-full border border-dashed border-cyan-100/24 ring-spin" />
                          <div className="relative flex h-full w-full items-center justify-center rounded-full border border-cyan-100/15 bg-[#041224]/85">
                            <span className="text-3xl font-semibold text-cyan-50 sm:text-4xl">{result.overall_score}%</span>
                          </div>
                        </div>
                        <p className="mt-4 text-xs uppercase tracking-[0.18em] text-cyan-100/65 sm:text-sm">Shortlist Probability</p>
                        {typeof result.confidence === "number" && <p className="mt-1 text-xs text-cyan-50/70">Confidence: {result.confidence}%</p>}
                        {result.likely_interview_call && (
                          <span
                            className={`mt-3 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${
                              result.likely_interview_call.level === "high"
                                ? "border-emerald-200/50 bg-emerald-200/20 text-emerald-100"
                                : result.likely_interview_call.level === "medium"
                                  ? "border-amber-200/50 bg-amber-200/20 text-amber-100"
                                  : "border-rose-200/45 bg-rose-200/20 text-rose-100"
                            }`}
                          >
                            {result.likely_interview_call.label}
                          </span>
                        )}
                      </div>

                      <div className="space-y-3">
                        {metricCards.map((item, index) => (
                          <div key={item.label} className="space-y-2">
                            <div className="flex items-center justify-between text-sm text-cyan-50/74">
                              <span>{item.label}</span>
                              <span>{item.value}%</span>
                            </div>
                            <div className="signal-line h-3 rounded-full border border-cyan-100/18 bg-cyan-100/8">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${item.value}%` }}
                                transition={{ duration: 0.8 + index * 0.2, ease: "easeOut" }}
                                className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-cyan-200 to-amber-100"
                              />
                            </div>
                          </div>
                        ))}

                        {(result.quick_wins || []).length > 0 && (
                          <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-3 sm:p-4">
                            <p className="text-sm font-semibold text-cyan-100">Immediate Quick Wins</p>
                            <ul className="mt-2 space-y-1.5 text-[13px] text-cyan-50/75 sm:mt-3 sm:space-y-2 sm:text-sm">
                              {(result.quick_wins || []).slice(0, 4).map((item, index) => (
                                <li key={`win-${index}`}>- {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-3 sm:p-4">
                          <p className="text-sm font-semibold text-cyan-100">Trend vs Previous Run</p>
                          {analysisTrendLoading && (
                            <p className="mt-2 text-xs text-cyan-50/74">Calculating score delta and role benchmark...</p>
                          )}
                          {!analysisTrendLoading && analysisTrendError && (
                            <p className="mt-2 text-xs text-amber-100">{analysisTrendError}</p>
                          )}
                          {!analysisTrendLoading && !analysisTrendError && analysisComparison?.delta && (
                            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                              <div className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-2 text-cyan-100/86">
                                Score delta: {formatDeltaValue(analysisComparison.delta.overall_score)}
                              </div>
                              <div className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-2 text-cyan-100/86">
                                Callback delta: {formatDeltaValue(analysisComparison.delta.estimated_callback_rate, "%")}
                              </div>
                            </div>
                          )}
                          {!analysisTrendLoading && !analysisTrendError && !analysisComparison?.delta && (
                            <p className="mt-2 text-xs text-cyan-50/74">No previous run found yet. Your next analysis will show progression delta.</p>
                          )}
                          {!analysisTrendLoading && roleBenchmark && (
                            <p className="mt-2 text-xs text-cyan-100/84">
                              Benchmark: {roleBenchmark.band_label} band | Percentile {roleBenchmark.percentile}% among {roleBenchmark.peer_count} peers
                            </p>
                          )}
                        </div>

                        <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-3 sm:p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-cyan-100">JD Match Scanner</p>
                              <p className="mt-1 text-xs text-cyan-50/72">Upload JD (PDF/image) or paste text when you are ready.</p>
                              <p className="mt-1 text-[11px] text-cyan-100/74">
                                Cost: {wallet?.pricing.jd_match ?? wallet?.pricing.analyze ?? 0} credits per JD match run
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowJdScanner((prev) => !prev)}
                              className="w-full rounded-xl border border-cyan-100/30 bg-cyan-100/8 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/14 sm:w-auto"
                            >
                              {showJdScanner ? "Hide Tool" : "Open Tool"}
                            </button>
                          </div>

                          {showJdScanner && (
                            <>
                              <textarea
                                value={jdInput}
                                onChange={(event) => setJdInput(event.target.value)}
                                placeholder="Paste target job description here"
                                className={`${textAreaClass} mt-3 min-h-24`}
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
                                  onClick={() => jdFileInputRef.current?.click()}
                                  disabled={jdFileUploading}
                                  className="w-full rounded-xl border border-cyan-100/34 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                                >
                                  {jdFileUploading ? "Extracting..." : "Upload PDF / Image"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleRunJdMatch()}
                                  disabled={jdMatchLoading}
                                  className="w-full rounded-xl border border-cyan-100/34 bg-cyan-200/18 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                                >
                                  {jdMatchLoading ? "Matching..." : "Run JD Match"}
                                </button>
                                {jdMatch && (
                                  <span className="text-xs text-cyan-100/78">
                                    Match score: {jdMatch.match_percentage ?? jdMatch.match_score}%
                                  </span>
                                )}
                              </div>
                              {jdUploadedFileName && <p className="mt-2 text-xs text-cyan-100/78">Imported from: {jdUploadedFileName}</p>}
                              {jdMatchError && <p className="mt-2 text-xs text-amber-100">{jdMatchError}</p>}
                              {jdMatch && (
                                <div className="mt-3 rounded-xl border border-cyan-100/20 bg-cyan-100/8 p-3">
                                  <p className="text-xs text-cyan-50/78">{jdMatch.alignment_summary}</p>
                                  <p className="mt-1 text-xs text-cyan-100/84">
                                    Must-have coverage: {Math.max(0, Math.min(100, jdMatch.skill_breakdown?.must_have_coverage ?? 0))}% |
                                    Good-to-have coverage: {Math.max(0, Math.min(100, jdMatch.skill_breakdown?.good_to_have_coverage ?? 0))}%
                                  </p>
                                  <p className="mt-2 text-xs text-cyan-100/84">
                                    Matched skills: {(jdMatch.matched_skills || jdMatch.matched_keywords || []).slice(0, 8).join(", ") || "None yet"}
                                  </p>
                                  <p className="mt-1 text-xs text-cyan-100/84">
                                    Missing skills: {(jdMatch.missing_skills || jdMatch.missing_keywords || []).slice(0, 8).join(", ") || "None"}
                                  </p>
                                  {(jdMatch.missing_must_have_skills || []).length > 0 && (
                                    <p className="mt-1 text-xs text-amber-100/90">
                                      Missing must-have: {(jdMatch.missing_must_have_skills || []).slice(0, 5).join(", ")}
                                    </p>
                                  )}
                                  {(jdMatch.feedback || []).length > 0 && (
                                    <ul className="mt-2 space-y-1 text-xs text-cyan-50/78">
                                      {(jdMatch.feedback || []).slice(0, 2).map((line, idx) => (
                                        <li key={`jd-feedback-${idx}`}>- {line}</li>
                                      ))}
                                    </ul>
                                  )}
                                  {(jdMatch.suggested_bullets || []).length > 0 && (
                                    <ul className="mt-2 space-y-1 text-xs text-cyan-50/75">
                                      {(jdMatch.suggested_bullets || []).slice(0, 3).map((line, idx) => (
                                        <li key={`jd-suggestion-${idx}`}>- {line}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeResultTab === "strategy" && (
                  <div className="space-y-4 sm:space-y-6">
                    {result.ninety_plus_strategy && (
                      <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-lg font-semibold text-cyan-50 sm:text-xl">Path To 90%+ Shortlist Chance</h3>
                          <span className="rounded-full border border-cyan-100/35 bg-cyan-200/18 px-3 py-1 text-xs font-semibold text-cyan-50">
                            Window: {result.ninety_plus_strategy.execution_window_weeks} weeks
                          </span>
                        </div>
                        <p className="mt-2 text-[13px] text-cyan-50/72 sm:text-sm">
                          Gap to 90: <span className="font-semibold text-cyan-100">{result.ninety_plus_strategy.gap_to_90} points</span> | Projected after execution:
                          <span className="font-semibold text-cyan-100"> {result.ninety_plus_strategy.projected_score_after_execution}%</span>
                        </p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {result.ninety_plus_strategy.actions.map((action, idx) => (
                            <div key={`n90-${idx}`} className="rounded-xl border border-cyan-100/18 bg-cyan-100/6 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100/82">
                                {action.step_label || `Step ${idx + 1}`}
                              </p>
                              {action.title && <p className="mt-1 text-sm font-semibold text-cyan-50">{action.title}</p>}
                              <p className="mt-1 text-sm text-cyan-50/80">{action.action}</p>
                              {action.why_it_matters && <p className="mt-2 text-xs text-cyan-50/72">Why this matters: {action.why_it_matters}</p>}
                              {(action.how_to_execute || []).length > 0 && (
                                <ul className="mt-2 space-y-1 text-xs text-cyan-50/72">
                                  {(action.how_to_execute || []).map((line, executeIndex) => (
                                    <li key={`exec-${idx}-${executeIndex}`}>- {line}</li>
                                  ))}
                                </ul>
                              )}
                              <p className="mt-2 text-xs text-cyan-50/70">Est. lift: +{action.estimated_score_lift} | Timeline: {action.timeline_weeks} weeks</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {result.positioning_strategy && !result.is_fresher_profile && (
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-4 sm:p-5">
                          <h3 className="text-lg font-semibold text-cyan-50 sm:text-xl">Your Suggested Field Matches</h3>
                          <p className="mt-2 text-[13px] text-cyan-50/72 sm:text-sm">
                            Target role fit: <span className="font-semibold text-cyan-100">{result.positioning_strategy.target_fit_score}%</span>
                          </p>
                          <p className="mt-2 text-[13px] text-cyan-50/76 sm:text-sm">{result.positioning_strategy.summary}</p>
                          <div className="mt-3 space-y-2">
                            {result.positioning_strategy.higher_probability_roles.map((alt, idx) => (
                              <div key={`alt-${idx}`} className="rounded-xl border border-cyan-100/18 bg-cyan-100/6 p-3">
                                <p className="text-sm font-semibold text-cyan-50">{alt.role} ({alt.fit_score}%)</p>
                                <p className="mt-1 text-xs text-cyan-50/72">{alt.why}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {result.learning_roadmap && (
                          <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-4 sm:p-5">
                            <h3 className="text-lg font-semibold text-cyan-50 sm:text-xl">Learning Roadmap</h3>
                            <p className="mt-2 text-[13px] text-cyan-50/72 sm:text-sm">Timeline: {result.learning_roadmap.total_duration_weeks} weeks</p>
                            {result.learning_roadmap.experience_band && (
                              <p className="mt-1 text-xs uppercase tracking-[0.12em] text-cyan-100/72">
                                Experience band: {result.learning_roadmap.experience_band}
                              </p>
                            )}
                            <div className="mt-3 space-y-2">
                              {result.learning_roadmap.phases.map((phase, idx) => (
                                <div key={`road-${idx}`} className="rounded-xl border border-cyan-100/18 bg-cyan-100/6 p-3">
                                  <p className="text-sm font-semibold text-cyan-50">{phase.phase} ({phase.duration_weeks} weeks)</p>
                                  <p className="mt-1 text-xs text-cyan-50/72">Focus: {phase.focus.join(", ")}</p>
                                  <p className="mt-1 text-xs text-cyan-50/72">Outcome: {phase.outcome}</p>
                                  {(phase.deliverables || []).length > 0 && (
                                    <ul className="mt-2 space-y-1 text-xs text-cyan-50/72">
                                      {(phase.deliverables || []).map((item, deliverableIndex) => (
                                        <li key={`deliverable-${idx}-${deliverableIndex}`}>- {item}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {result.is_fresher_profile && (
                      <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-5 text-sm text-cyan-50/78">
                        Positioning field suggestions unlock after you build initial skill signals. Focus on the roadmap and improvement actions first.
                      </div>
                    )}
                  </div>
                )}

                {activeResultTab === "salary" && (
                  <div className="space-y-4 sm:space-y-6">
                    {result.salary_insight && salaryProjection && (
                      <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-4 sm:p-5">
                        <h3 className="text-lg font-semibold text-cyan-50 sm:text-xl">India Salary Insight (Role-Aligned)</h3>
                        <p className="mt-2 text-[13px] text-cyan-50/72 sm:text-sm">
                          Base range: <span className="font-semibold text-cyan-100">₹{result.salary_insight.base_range_lpa.low}L - ₹{result.salary_insight.base_range_lpa.high}L</span>
                          {" "}per annum ({result.salary_insight.experience_band} band)
                        </p>
                        <p className="text-[13px] text-cyan-50/72 sm:text-sm">
                          With selected boosters: <span className="font-semibold text-cyan-100">₹{salaryProjection.projectedLow}L - ₹{salaryProjection.projectedHigh}L</span>
                          {" "}(+₹{salaryProjection.selectedUplift}L)
                        </p>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {result.salary_insight.salary_booster_options.map((option) => {
                            const selected = selectedSalaryBoosters.includes(option.id);
                            return (
                              <button
                                type="button"
                                key={option.id}
                                onClick={() => {
                                  setSelectedSalaryBoosters((prev) =>
                                    prev.includes(option.id) ? prev.filter((item) => item !== option.id) : [...prev, option.id]
                                  );
                                }}
                                className={`rounded-xl border p-3 text-left transition ${
                                  selected
                                    ? "border-cyan-100/50 bg-cyan-200/20"
                                    : "border-cyan-100/20 bg-cyan-100/6 hover:bg-cyan-100/10"
                                }`}
                              >
                                <p className="text-sm font-semibold text-cyan-50">{option.label}</p>
                                <p className="mt-1 text-xs text-cyan-50/72">{option.description}</p>
                                <p className="mt-2 text-xs font-semibold text-emerald-100">Potential uplift: +₹{option.uplift_lpa}L</p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {result.callback_forecast && callbackSimulation && (
                      <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-4 sm:p-5">
                        <h3 className="text-lg font-semibold text-cyan-50 sm:text-xl">Interview Callback Rate Simulator (Weekly View)</h3>
                        <p className="mt-2 text-xs text-cyan-50/65">
                          {result.callback_forecast.weekly_note || `Weekly projection shown over a ${callbackSimulation.weeks}-week cycle.`}
                        </p>
                        <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_2fr] sm:items-end">
                          <div>
                            <label className="mb-2 block text-sm text-cyan-50/82">Applications you plan to submit</label>
                            <input
                              type="number"
                              min="1"
                              max="2500"
                              value={callbackSimulationApps}
                              onChange={(event) => setCallbackSimulationApps(event.target.value)}
                              className={fieldClass}
                            />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-cyan-100/20 bg-cyan-100/6 p-3">
                              <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/70">Current</p>
                              <p className="mt-1 text-lg font-semibold text-cyan-50">{result.callback_forecast.estimated_callback_rate}%</p>
                              <p className="text-xs text-cyan-50/70">Expected calls/week: {callbackSimulation.currentPerWeek}</p>
                              <p className="text-xs text-cyan-50/55">Total in {callbackSimulation.weeks} weeks: {callbackSimulation.current}</p>
                            </div>
                            <div className="rounded-xl border border-emerald-200/26 bg-emerald-200/10 p-3">
                              <p className="text-xs uppercase tracking-[0.12em] text-emerald-100/80">With Improvements</p>
                              <p className="mt-1 text-lg font-semibold text-emerald-100">{result.callback_forecast.improved_callback_rate}%</p>
                              <p className="text-xs text-emerald-100/80">Expected calls/week: {callbackSimulation.improvedPerWeek}</p>
                              <p className="text-xs text-emerald-100/70">Total in {callbackSimulation.weeks} weeks: {callbackSimulation.improved}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeResultTab === "market" && (
                  <div className="space-y-4 sm:space-y-6">
                    {result.hiring_market_insights && (
                      <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-4 sm:p-5">
                        <h3 className="text-lg font-semibold text-cyan-50 sm:text-xl">Hiring Timing & Risk Insights (India)</h3>
                        <p className="mt-2 text-[13px] text-cyan-50/72 sm:text-sm">Best months to apply: {result.hiring_market_insights.best_months_to_apply.join(", ")}</p>
                        <p className="mt-1 text-[13px] text-cyan-50/72 sm:text-sm">Hiring peaks: {result.hiring_market_insights.hiring_peak_windows.join(" | ")}</p>
                        <p className="mt-1 text-[13px] text-cyan-50/72 sm:text-sm">
                          Layoff risk for target direction: <span className="font-semibold text-cyan-100 uppercase">{result.hiring_market_insights.layoff_risk_level}</span>
                        </p>
                        <p className="mt-1 text-[13px] text-cyan-50/72 sm:text-sm">{result.hiring_market_insights.layoff_risk_note}</p>
                        <p className="mt-2 rounded-xl border border-cyan-100/20 bg-cyan-100/8 p-2 text-[13px] text-cyan-100 sm:text-sm">
                          {result.hiring_market_insights.application_timing_tip}
                        </p>
                        <div className="mt-3 rounded-xl border border-amber-100/26 bg-amber-100/10 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-amber-100/85">Higher Layoff Risk Segments</p>
                          <ul className="mt-2 space-y-1 text-sm text-amber-50/85">
                            {result.hiring_market_insights.higher_layoff_risk_industries.map((item, idx) => (
                              <li key={`risk-${idx}`}>- {item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeResultTab === "improvements" && (
                  <div>
                    <h3 className="text-lg font-semibold text-cyan-50 sm:text-xl">Improvement Areas</h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      {result.areas_to_improve.map((item, index) => (
                        <motion.div
                          key={item.category}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.06 * index }}
                          className="rounded-2xl border border-cyan-100/18 bg-cyan-100/5 p-4"
                        >
                          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-cyan-100/82">{item.category}</p>
                          <ul className="mt-3 space-y-2 text-sm text-cyan-50/72">
                            {item.details.map((detail, detailIndex) => (
                              <li key={`${item.category}-${detailIndex}`}>- {detail}</li>
                            ))}
                          </ul>
                        </motion.div>
                      ))}
                    </div>

                    <div className="mt-5 rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-4 sm:p-5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-cyan-100">Interview Prep + Job Apply Kit + Copilot</p>
                          <p className="mt-1 text-xs text-cyan-50/72">
                            Generate role-targeted prep assets, run full application copilot, and save this as a Job Track.
                          </p>
                        </div>
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                          <button
                            type="button"
                            onClick={() => void handleGenerateInterviewPrep()}
                            disabled={interviewPrepLoading}
                            className="w-full rounded-xl border border-cyan-100/34 bg-cyan-200/16 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:opacity-60 sm:w-auto"
                          >
                            {interviewPrepLoading ? "Generating..." : "Generate Interview Prep"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleGenerateApplicationPack()}
                            disabled={applicationPackLoading}
                            className="w-full rounded-xl border border-cyan-100/34 bg-cyan-100/10 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:opacity-60 sm:w-auto"
                          >
                            {applicationPackLoading ? "Generating..." : "Create Job Apply Kit"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRunApplicationCopilot()}
                            disabled={applicationCopilotLoading}
                            className="w-full rounded-xl border border-emerald-200/34 bg-emerald-200/12 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-200/20 disabled:opacity-60 sm:w-auto"
                          >
                            {applicationCopilotLoading ? "Running..." : "Run Full Application Copilot"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSaveAsJobTrack()}
                            disabled={jobTrackSaving || !applicationCopilot}
                            className="w-full rounded-xl border border-emerald-200/30 bg-transparent px-3 py-1.5 text-xs font-semibold text-emerald-100/92 transition hover:bg-emerald-200/12 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                          >
                            {jobTrackSaving ? "Saving..." : "Save As Job Track"}
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <Link
                          href={applicationCopilotPrefillHref}
                          className="w-full rounded-xl border border-cyan-100/28 bg-cyan-100/8 px-3 py-1.5 text-center text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/14 sm:w-auto"
                        >
                          Open Copilot Workspace
                        </Link>
                        <Link
                          href={interviewSimulatorPrefillHref}
                          className="w-full rounded-xl border border-cyan-100/28 bg-cyan-100/8 px-3 py-1.5 text-center text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/14 sm:w-auto"
                        >
                          Open Interview Simulator
                        </Link>
                      </div>

                      {prepPackError && <p className="mt-3 text-xs text-amber-100">{prepPackError}</p>}
                      {applicationCopilotError && <p className="mt-2 text-xs text-amber-100">{applicationCopilotError}</p>}
                      {jobTrackSaveMessage && <p className="mt-2 text-xs text-emerald-100">{jobTrackSaveMessage}</p>}

                      {interviewPrep && (
                        <div className="mt-4 rounded-xl border border-cyan-100/20 bg-cyan-100/8 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/76">Interview Prep</p>
                          <p className="mt-1 text-xs text-cyan-50/78">{interviewPrep.coach_note}</p>
                          <ul className="mt-2 space-y-1 text-xs text-cyan-100/84">
                            {(interviewPrep.mock_questions || []).slice(0, 4).map((question, idx) => (
                              <li key={`prep-q-${idx}`}>- {question}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {applicationPack && (
                        <div className="mt-4 rounded-xl border border-cyan-100/20 bg-cyan-100/8 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/76">Job Apply Kit</p>
                          <p className="mt-2 text-xs text-cyan-50/80">Subject: {applicationPack.subject_line}</p>
                          <p className="mt-1 text-xs text-cyan-50/76">LinkedIn: {applicationPack.linkedin_message}</p>
                          {applicationPack.recruiter_follow_up && (
                            <p className="mt-1 text-xs text-cyan-50/76">Follow-up: {applicationPack.recruiter_follow_up}</p>
                          )}
                          {applicationPack.ai?.used && (
                            <p className="mt-1 text-[11px] text-cyan-100/70">AI model: {applicationPack.ai.model || "hybrid"}</p>
                          )}
                        </div>
                      )}

                      {applicationCopilot && (
                        <div className="mt-4 rounded-xl border border-emerald-100/22 bg-emerald-200/10 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-emerald-100/82">Application Copilot Snapshot</p>
                          <p className="mt-2 text-xs text-emerald-100/90">
                            Match: {applicationCopilot.match_percentage}% | Missing skills: {(applicationCopilot.missing_skills || []).length}
                          </p>
                          {(applicationCopilot.feedback || []).length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-cyan-50/80">
                              {(applicationCopilot.feedback || []).slice(0, 3).map((line, idx) => (
                                <li key={`copilot-feedback-${idx}`}>- {line}</li>
                              ))}
                            </ul>
                          )}
                          {(applicationCopilot.next_steps_7_day || []).length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-cyan-50/78">
                              {(applicationCopilot.next_steps_7_day || []).slice(0, 3).map((line, idx) => (
                                <li key={`copilot-next-${idx}`}>- {line}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                    </motion.div>
                  </div>
                </div>
              </div>
              <div className="border-t border-cyan-100/14 bg-[#031628]/96 px-3 py-3 sm:px-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-cyan-100/68">
                    {resultStepIndex >= RESULT_STEPS.length - 1 ? "Final section" : `Up next: ${nextResultStep.label}`}
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => navigateResultStep("back")}
                      disabled={resultStepIndex === 0}
                      className="rounded-xl border border-cyan-100/26 bg-cyan-100/7 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/14 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateResultStep("next")}
                      disabled={resultStepIndex >= RESULT_STEPS.length - 1}
                      className="rounded-xl border border-cyan-100/36 bg-cyan-200/18 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </motion.section>
          </motion.div>
        )}

        {showRoadmapDecisionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[264] flex items-center justify-center bg-[#020915]/86 px-4 backdrop-blur-sm"
            onClick={() => {
              if (roadmapDecisionLoading || roadmapDecisionSubmitting) return;
              setShowRoadmapDecisionModal(false);
              setRoadmapPreviewMeta(null);
              setRoadmapError("");
            }}
          >
            <motion.section
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-2xl rounded-[1.8rem] border border-cyan-100/22 bg-[#041427]/96 p-5 shadow-[0_35px_100px_rgba(0,0,0,0.65)] sm:p-7"
            >
              <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/72">Roadmap Decision</p>
              <h3 className="mt-2 text-2xl font-semibold text-cyan-50">{roadmapDecisionTitle}</h3>
              <p className="mt-2 text-sm text-cyan-50/76">{roadmapDecisionDescription}</p>
              {roadmapTracksCount > 0 && (
                <p className="mt-1 text-xs text-cyan-100/68">
                  Existing roadmap tracks: <span className="font-semibold text-cyan-50">{roadmapTracksCount}</span>
                </p>
              )}

              {roadmapPreviewMeta?.summary && (
                <div className="mt-3 rounded-xl border border-cyan-100/22 bg-cyan-100/8 p-3">
                  <p className="text-xs text-cyan-50/82">{roadmapPreviewMeta.summary}</p>
                  {typeof roadmapPreviewMeta.added_milestones === "number" && (
                    <p className="mt-1 text-[11px] text-cyan-100/72">
                      New milestones: {roadmapPreviewMeta.added_milestones} • Similarity score: {roadmapPreviewMeta.similarity_score ?? 0}
                    </p>
                  )}
                  {(roadmapPreviewMeta.added_titles || []).length > 0 && (
                    <p className="mt-1 text-[11px] text-cyan-100/76">
                      Additions: {(roadmapPreviewMeta.added_titles || []).slice(0, 4).join(", ")}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3">
                <p className="text-xs text-cyan-100/78">
                  {roadmapDecisionMode === "first"
                    ? "You can manage milestones later from Dashboard with explicit Mark Complete actions."
                    : "If no new gaps are found, your existing roadmap stays clean with no duplicate clutter."}
                </p>
              </div>

              {roadmapError && (
                <p className="mt-4 rounded-xl border border-amber-100/34 bg-amber-100/12 px-3 py-2 text-sm text-amber-50">{roadmapError}</p>
              )}

              {roadmapDecisionLoading && <p className="mt-4 text-sm text-cyan-100/76">Checking your existing roadmap tracks...</p>}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleConfirmRoadmapDecision()}
                  disabled={roadmapDecisionLoading || roadmapDecisionSubmitting}
                  className="rounded-xl border border-cyan-100/38 bg-cyan-200/18 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {roadmapDecisionSubmitting
                    ? "Updating..."
                    : roadmapDecisionMode === "first"
                      ? "Add To Roadmap"
                      : "Yes, Update Smartly"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (roadmapDecisionLoading || roadmapDecisionSubmitting) return;
                    setShowRoadmapDecisionModal(false);
                    setRoadmapPreviewMeta(null);
                    setRoadmapError("");
                  }}
                  disabled={roadmapDecisionLoading || roadmapDecisionSubmitting}
                  className="rounded-xl border border-cyan-100/24 bg-transparent px-4 py-2 text-sm font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10 disabled:opacity-60"
                >
                  Not Now
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}

        {showRoadmapModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[265] flex items-center justify-center bg-[#020915]/88 px-4 backdrop-blur-sm"
            onClick={() => {
              if (roadmapLoading) return;
              setShowRoadmapModal(false);
            }}
          >
            <motion.section
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-3xl rounded-[1.8rem] border border-cyan-100/22 bg-[#041427]/96 p-5 shadow-[0_35px_100px_rgba(0,0,0,0.65)] sm:p-7"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/72">Goal Roadmap</p>
                  <h3 className="mt-1 text-2xl font-semibold text-cyan-50">Roadmap Preview</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRoadmapModal(false)}
                  disabled={roadmapLoading}
                  className="rounded-xl border border-cyan-100/24 bg-cyan-100/8 px-3 py-1.5 text-xs font-semibold text-cyan-50/86 transition hover:bg-cyan-100/14 disabled:opacity-50"
                >
                  Close
                </button>
              </div>

              {!roadmapLoading && roadmapServerActionLabel && (
                <p className="mt-3 rounded-xl border border-emerald-100/26 bg-emerald-200/10 px-3 py-2 text-sm text-emerald-50/90">
                  {roadmapServerActionLabel}
                </p>
              )}
              {roadmapLoading && <p className="mt-4 text-sm text-cyan-100/78">Preparing your milestone roadmap...</p>}
              {!roadmapLoading && roadmapError && (
                <p className="mt-4 rounded-xl border border-amber-100/34 bg-amber-100/12 px-3 py-2 text-sm text-amber-50">{roadmapError}</p>
              )}

              {!roadmapLoading && roadmapPreview && (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-2xl border border-cyan-100/18 bg-cyan-100/7 p-4">
                      <p className="text-sm font-semibold text-cyan-50">{roadmapPreview.goal_title}</p>
                      {roadmapPreview.goal_context && <p className="mt-1 text-sm text-cyan-50/72">{roadmapPreview.goal_context}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-cyan-100/72">
                        {roadmapPreview.target_role && <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1">Role: {roadmapPreview.target_role}</span>}
                        {roadmapPreview.target_industry && (
                          <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1">Industry: {roadmapPreview.target_industry}</span>
                        )}
                        <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1">
                          {roadmapPreview.progress_percent}% complete
                        </span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full border border-cyan-100/20 bg-cyan-100/8">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200"
                          style={{ width: `${roadmapPreview.progress_percent}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-cyan-100/72">
                        {roadmapPreview.completed_milestones}/{roadmapPreview.total_milestones} milestones completed
                      </p>
                    </div>

                    <div className="rounded-2xl border border-emerald-100/24 bg-emerald-200/8 p-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-emerald-100/82">How This Works</p>
                      <p className="mt-2 text-sm text-emerald-50/88">
                        Open dashboard and use <span className="font-semibold">Mark Complete</span> on each step.
                      </p>
                      {nextRoadmapPreviewMilestone && (
                        <div className="mt-3 rounded-lg border border-emerald-100/25 bg-emerald-200/12 p-2.5">
                          <p className="text-[11px] uppercase tracking-[0.11em] text-emerald-100/78">First Focus</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-50">{nextRoadmapPreviewMilestone.title}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <ol className="mt-4 max-h-[36vh] space-y-2 overflow-y-auto pr-1">
                    {roadmapPreview.milestones.map((milestone, index) => (
                      <li key={milestone.id} className="rounded-xl border border-cyan-100/16 bg-cyan-100/6 p-3">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] text-cyan-100/74">
                          <span className="rounded-full border border-cyan-100/24 bg-cyan-100/8 px-2 py-0.5">Step {index + 1}</span>
                          {milestone.category && (
                            <span className="rounded-full border border-cyan-100/24 bg-cyan-100/8 px-2 py-0.5">{milestone.category}</span>
                          )}
                          {milestone.timeframe && (
                            <span className="rounded-full border border-cyan-100/24 bg-cyan-100/8 px-2 py-0.5">{milestone.timeframe}</span>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-semibold text-cyan-50">{milestone.title}</p>
                        <p className="mt-1 text-xs text-cyan-50/72">{milestone.detail}</p>
                        {milestone.done_when && <p className="mt-1 text-xs text-emerald-100/78">Done when: {milestone.done_when}</p>}
                      </li>
                    ))}
                  </ol>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      href="/dashboard"
                      onClick={() => setShowRoadmapModal(false)}
                      className="rounded-xl border border-cyan-100/38 bg-cyan-200/18 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
                    >
                      Open Dashboard Tracker
                    </Link>
                    <button
                      type="button"
                      onClick={() => setShowRoadmapModal(false)}
                      className="rounded-xl border border-cyan-100/24 bg-transparent px-4 py-2 text-sm font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10"
                    >
                      I&apos;ll Do This Later
                    </button>
                  </div>
                </>
              )}
            </motion.section>
          </motion.div>
        )}

        {showFeedbackModal && authToken && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[140] flex items-center justify-center bg-[#020915]/90 px-4 backdrop-blur-sm"
          >
            <motion.section
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="w-full max-w-xl rounded-[1.7rem] border border-cyan-100/26 bg-[#04172e]/96 p-6 shadow-[0_35px_100px_rgba(0,0,0,0.6)]"
            >
              <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/70">Quick Feedback (Optional)</p>
              <h3 className="mt-2 text-2xl font-semibold text-cyan-50">Rate This Analysis</h3>
              <p className="mt-2 text-sm text-cyan-50/72">
                Share a quick rating to help improve future analysis quality.
              </p>

              <div className="mt-5 rounded-2xl border border-cyan-100/20 bg-[#06233f]/72 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/70">Your Rating</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((value) => {
                    const active = feedbackRating >= value;
                    return (
                      <button
                        key={`star-${value}`}
                        type="button"
                        onClick={() => setFeedbackRating(value)}
                        aria-label={`Rate ${value} stars`}
                        className={`rounded-xl border px-3 py-2 text-lg leading-none transition ${
                          active
                            ? "border-amber-100/60 bg-amber-100/22 text-amber-100"
                            : "border-cyan-100/20 bg-cyan-100/6 text-cyan-50/50"
                        }`}
                      >
                        ★
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-sm font-semibold text-cyan-100">{feedbackRating}/5 - {feedbackRatingLabel}</p>
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-cyan-50/86">What should we improve?</label>
                <textarea
                  value={feedbackComment}
                  onChange={(event) => setFeedbackComment(event.target.value)}
                  placeholder="Share your experience in 1-2 lines."
                  className={`${textAreaClass} min-h-24`}
                />
              </div>

              {feedbackError && <p className="mt-3 rounded-xl border border-amber-100/36 bg-amber-100/12 px-3 py-2 text-sm text-amber-50">{feedbackError}</p>}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleFeedbackSubmit()}
                  disabled={feedbackSubmitting}
                  className="rounded-xl border border-cyan-100/38 bg-cyan-200/18 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:opacity-65"
                >
                  {feedbackSubmitting ? "Submitting..." : "Submit Feedback"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowFeedbackModal(false)}
                  className="rounded-xl border border-cyan-100/24 bg-transparent px-4 py-2 text-sm font-semibold text-cyan-50/84 transition hover:bg-cyan-100/10"
                >
                  Not Now
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </div>
    </main>
  );
}
