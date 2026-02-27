"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { renderGoogleSignInButton } from "@/lib/google-sso";

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
  otp_required?: boolean;
  message?: string;
  otp_expires_minutes?: number;
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

const rounded = (value: number) => Math.round(value * 10) / 10;
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
const AUTH_REQUEST_TIMEOUT_MS = 70000;

type ResultTabId = "summary" | "strategy" | "salary" | "market" | "improvements";

export default function UploadPage() {
  const router = useRouter();
  const [analysisMode, setAnalysisMode] = useState<"manual" | "upload">("manual");
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [ageYears, setAgeYears] = useState("");
  const [applicationsCount, setApplicationsCount] = useState("60");
  const [analysisSkills, setAnalysisSkills] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(12);
  const [showResultModal, setShowResultModal] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState<ResultTabId>("summary");

  const [selectedSalaryBoosters, setSelectedSalaryBoosters] = useState<string[]>([]);
  const [callbackSimulationApps, setCallbackSimulationApps] = useState("60");

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authUserEmail, setAuthUserEmail] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [authLiveLoading, setAuthLiveLoading] = useState(false);
  const [authLiveStepIndex, setAuthLiveStepIndex] = useState(0);
  const [authLiveProgress, setAuthLiveProgress] = useState(10);
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
      window.localStorage.setItem("hirescore_auth_token", payload.auth_token);
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
  };

  useEffect(() => {
    const token = window.localStorage.getItem("hirescore_auth_token");
    if (!token) return;

    setAuthToken(token);
    fetch(apiUrl("/auth/me"), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Session expired");
        }
        const payload = (await response.json()) as AuthPayload;
        applyAuthPayload(payload);
      })
      .catch(() => {
        setAuthToken("");
        setWallet(null);
        setAuthUserEmail("");
        setFeedbackRequired(false);
        setShowFeedbackModal(false);
        window.localStorage.removeItem("hirescore_auth_token");
      });
  }, []);

  useEffect(() => {
    void warmBackend(apiUrl);
  }, []);

  useEffect(() => {
    if (!loading) {
      setLoadingStepIndex(0);
      setLoadingProgress(12);
      return;
    }

    const startedAt = performance.now();
    const totalSteps = ANALYSIS_LOADING_STEPS.length;
    const stepDuration = MIN_ANALYSIS_LOADING_MS / totalSteps;
    let frameId = 0;

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const cappedElapsed = Math.min(elapsed, MIN_ANALYSIS_LOADING_MS);
      const progress = 12 + (cappedElapsed / MIN_ANALYSIS_LOADING_MS) * 82;
      const stepIndex = Math.min(totalSteps - 1, Math.floor(cappedElapsed / stepDuration));
      setLoadingProgress(Math.round(progress));
      setLoadingStepIndex(stepIndex);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [loading]);

  useEffect(() => {
    if (!loading && !showResultModal && !showFeedbackModal && !showAuthModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [loading, showResultModal, showFeedbackModal, showAuthModal]);

  useEffect(() => {
    if (!showResultModal) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowResultModal(false);
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
    setAuthLiveStepIndex(0);
    setAuthLiveProgress(10);

    const totalSteps = AUTH_LIVE_LOADING_STEPS.length;
    const stepDuration = MIN_AUTH_LIVE_LOADING_MS / totalSteps;
    let frameId = 0;
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const cappedElapsed = Math.min(elapsed, MIN_AUTH_LIVE_LOADING_MS);
      const progress = 10 + (cappedElapsed / MIN_AUTH_LIVE_LOADING_MS) * 85;
      const stepIndex = Math.min(totalSteps - 1, Math.floor(cappedElapsed / stepDuration));
      setAuthLiveProgress(Math.round(progress));
      setAuthLiveStepIndex(stepIndex);
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);

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
      window.cancelAnimationFrame(frameId);
      setAuthLiveProgress(100);
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 220);
      });
      setAuthLiveLoading(false);
      setAuthLiveStepIndex(0);
      setAuthLiveProgress(10);
    }
  };

  useEffect(() => {
    const container = googleButtonRef.current;
    if (!container) return;
    if (authToken || signupOtpRequired || forgotPasswordMode || authLiveLoading) {
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
      width: 320,
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
  }, [authToken, signupOtpRequired, forgotPasswordMode, authMode, authLiveLoading, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyzeSuccess = (data: AnalysisResult) => {
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
    setSelectedSalaryBoosters(data.salary_insight?.selected_boosters || []);
    if (data.callback_forecast?.applications_input) {
      setCallbackSimulationApps(String(data.callback_forecast.applications_input));
    }
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
        setSignupOtpRequired(false);
        setSignupOtp("");
        setAuthPassword("");
        setAuthInfo("Signup complete. Welcome to HireScore.");
        const consumed = await runQueuedAnalyzeAfterAuth(payload.auth_token);
        if (!consumed) router.push("/dashboard");
      } else {
        if (!email || !password) {
          throw new Error("Enter email and password.");
        }
        const payload = await runWithMinimumAuthLiveLoading(() => submitAuthRequest(authMode, email, password));
        if (authMode === "signup") {
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
    setResult(null);
    setFeedbackRequired(false);
    setShowFeedbackModal(false);
    setFeedbackComment("");
    setFeedbackError("");
    setAuthInfo("");
    setSignupOtpRequired(false);
    setSignupOtp("");
    setForgotPasswordMode(false);
    setForgotOtpRequested(false);
    setForgotOtp("");
    setForgotNewPassword("");
    window.localStorage.removeItem("hirescore_auth_token");
  };

  const toMaybeNumber = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

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
      return;
    }

    if (!isFresherFlow && skillTokens.length < 3) {
      setAnalysisError("Add at least 3 concrete skills/tools for meaningful prediction. If you are a fresher, keep experience at 0-1 years.");
      setResult(null);
      return;
    }

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
      handleAnalyzeSuccess(data);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Unable to analyze right now.");
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
      return;
    }

    if (!uploadedFile) {
      setAnalysisError("Upload your resume file first.");
      setResult(null);
      return;
    }

    setAnalysisError("");
    setResult(null);
    setShowResultModal(false);

    try {
      const authHeaders = tokenOverride ? { Authorization: `Bearer ${tokenOverride}` } : (authHeader || {});
      const data = await runWithMinimumLoading(async () => {
        const formData = new FormData();
        formData.append("file", uploadedFile);
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
      handleAnalyzeSuccess(data);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Unable to analyze uploaded resume right now.");
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
                Enter role details, run analysis, and get an easy report: score, interview chances, salary direction, and next-step actions.
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
                    <div className="flex flex-wrap gap-2 text-xs text-amber-50/86">
                      <span className="rounded-xl border border-amber-100/24 bg-amber-100/8 px-2.5 py-1.5">
                        1. Fill details
                      </span>
                      <span className="rounded-xl border border-amber-100/24 bg-amber-100/8 px-2.5 py-1.5">
                        2. Click Analyze
                      </span>
                      <span className="rounded-xl border border-amber-100/24 bg-amber-100/8 px-2.5 py-1.5">
                        3. Read report
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full border border-amber-100/24 bg-amber-100/10 px-2.5 py-1 text-amber-50/84">
                        {authToken ? "Signed In" : "Guest"}
                      </span>
                      {authToken && wallet && (
                        <>
                          <span className="rounded-full border border-amber-100/24 bg-amber-100/10 px-2.5 py-1 text-amber-50/84">Credits: {wallet.credits}</span>
                          <span className="rounded-full border border-amber-100/24 bg-amber-100/10 px-2.5 py-1 text-amber-50/84">Reports: {remainingAnalyze}</span>
                        </>
                      )}
                      {!authToken ? (
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
                      <Link
                        href="/pricing"
                        className="rounded-xl border border-rose-100/34 bg-rose-100/12 px-3 py-1.5 text-center font-semibold text-rose-50 transition hover:bg-rose-100/18"
                      >
                        Buy Credits
                      </Link>
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
                  {!authToken && <p className="mt-3 text-xs text-amber-100/82">New users get 5 free credits on signup (one full analysis).</p>}
                  {authToken && authUserEmail && <p className="mt-2 text-xs text-amber-50/74">Signed in as: {authUserEmail}</p>}
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
                      <label className="mb-2 block text-sm font-medium text-amber-50/90">Years of Experience (optional)</label>
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
                      <label className="mb-2 block text-sm font-medium text-amber-50/90">Age (optional)</label>
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
                      <label className="mb-2 block text-sm font-medium text-amber-50/90">Job Applications Planned Per Week</label>
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
                    <label className="mb-2 mt-3 block text-sm font-medium text-amber-50/90">Resume File (PDF or TXT)</label>
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
                          setUploadedFile(file);
                          setAnalysisError("");
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
                              accept=".pdf,.txt"
                              className="hidden"
                              onChange={(event) => setUploadedFile(event.target.files?.[0] || null)}
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
                  </div>
                )}

                <div className="mt-5 rounded-2xl border border-amber-100/20 bg-amber-100/[0.05] p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-amber-100/78">Actions</p>
                  {analysisError && (
                    <div className="mt-3 rounded-xl border border-amber-100/42 bg-amber-100/14 px-3 py-2 text-sm text-amber-50">{analysisError}</div>
                  )}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-2xl border border-amber-100/45 bg-gradient-to-r from-rose-500/34 via-amber-300/28 to-orange-300/28 px-5 py-3.5 text-sm font-semibold tracking-wide text-amber-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-75"
                    >
                      {loading ? "Analyzing..." : analysisMode === "manual" ? "Analyze My Profile" : "Analyze Uploaded Resume"}
                    </button>

                    <Link
                      href="/studio"
                      className="rounded-2xl border border-rose-100/36 bg-rose-100/12 px-5 py-3.5 text-center text-sm font-semibold text-rose-50 transition hover:bg-rose-100/20"
                    >
                      Improve Resume Next
                    </Link>
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
            className="fixed inset-0 z-[190] flex items-center justify-center bg-[#020915]/90 px-4 backdrop-blur-xl"
            onClick={() => {
              if (authLoading || googleAuthLoading) return;
              setShowAuthModal(false);
              setQueuedAnalyzeMode(null);
            }}
          >
            <motion.section
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-xl rounded-[1.7rem] border border-cyan-100/26 bg-[#04172e]/96 p-6 shadow-[0_35px_100px_rgba(0,0,0,0.6)]"
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

                {!forgotPasswordMode && !signupOtpRequired && (
                  <div className="pt-1">
                    <p className="text-center text-[11px] uppercase tracking-[0.16em] text-cyan-100/62">or continue with</p>
                    <div className="mt-2 flex justify-center">
                      <div ref={googleButtonRef} className="min-h-[42px] rounded-full" />
                    </div>
                    {googleAuthLoading && <p className="mt-2 text-center text-xs text-cyan-100/78">Completing Google sign-in...</p>}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={authLoading || googleAuthLoading}
                    className="rounded-xl border border-cyan-100/35 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:opacity-60"
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
                      className="rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10"
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
                    className="rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10"
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

        {authLiveLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[320] flex items-center justify-center bg-[#030412]/58 px-4 backdrop-blur-lg"
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
              <p className="mt-2 text-center text-sm font-semibold text-cyan-50">{AUTH_LIVE_LOADING_STEPS[authLiveStepIndex]}</p>

              <div className="mt-5 h-2 overflow-hidden rounded-full border border-cyan-100/40 bg-cyan-100/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-fuchsia-200 to-amber-200 transition-[width] duration-150 ease-linear"
                  style={{ width: `${authLiveProgress}%` }}
                />
              </div>
              <p className="mt-2 text-center text-xs text-cyan-100/76">{authLiveProgress}%</p>
            </div>
          </motion.div>
        )}

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-[#010716]/86 px-4 backdrop-blur-xl"
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
                  <span className="analysis-live-core-value">{loadingProgress}%</span>
                </div>
              </div>

              <div className="relative mt-3">
                <p className="text-center text-xs uppercase tracking-[0.2em] text-cyan-100/72">Analysis In Progress</p>
                <h3 className="mt-2 text-center text-2xl font-semibold text-cyan-50 sm:text-3xl">Building Your Shortlist Intelligence Report</h3>
                <p className="mt-3 text-center text-sm text-cyan-50/74">{ANALYSIS_LOADING_STEPS[loadingStepIndex]}</p>

                <div className="mt-5 h-2 overflow-hidden rounded-full border border-cyan-100/24 bg-cyan-100/8">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200 transition-[width] duration-150 ease-linear"
                    style={{ width: `${loadingProgress}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-cyan-100/66">
                  <span>{ANALYSIS_LOADING_STEPS[loadingStepIndex]}</span>
                  <span>{loadingProgress}%</span>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {ANALYSIS_LOADING_STEPS.map((step, index) => {
                    const active = index === loadingStepIndex;
                    return (
                      <motion.div
                        key={step}
                        animate={{ opacity: active ? 1 : 0.56, scale: active ? 1.01 : 1 }}
                        className={`analysis-live-step rounded-xl border px-3 py-2.5 text-sm ${
                          active ? "analysis-live-step-active border-cyan-100/52 bg-cyan-200/18 text-cyan-50" : "border-cyan-100/16 bg-cyan-100/5 text-cyan-50/72"
                        }`}
                      >
                        {step}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {showResultModal && result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[260] overflow-y-auto bg-[#020915]/88 px-2 pb-2 pt-14 backdrop-blur-xl sm:px-6 sm:pb-6 sm:pt-24"
            onClick={() => setShowResultModal(false)}
          >
            <motion.section
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              onClick={(event) => event.stopPropagation()}
              className="mx-auto my-0 flex max-h-[calc(100dvh-3rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[1.2rem] border border-cyan-100/22 bg-[#041427]/96 shadow-[0_35px_100px_rgba(0,0,0,0.65)] sm:max-h-[calc(100dvh-7rem)] sm:rounded-[2rem]"
            >
              <div className="sticky top-0 z-20 flex justify-end border-b border-cyan-100/14 bg-[#041427]/96 px-3 py-2.5 sm:px-6 sm:py-3">
                <button
                  type="button"
                  onClick={() => setShowResultModal(false)}
                  className="rounded-xl border border-cyan-100/28 bg-[#082640]/78 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-50/90 transition hover:bg-[#0d3358]"
                >
                  Close
                </button>
              </div>
              <div className="border-b border-cyan-100/14 px-3 py-3 sm:px-6 sm:py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/72">Analysis Complete</p>
                    <h3 className="mt-1 text-lg font-semibold text-cyan-50 sm:text-2xl">{result.shortlist_prediction || "Shortlist Analysis Report"}</h3>
                    <p className="text-[13px] text-cyan-50/72 sm:text-sm">{scoreInsight}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/studio"
                      className="rounded-xl border border-cyan-100/34 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 sm:text-sm"
                    >
                      Improve Resume Next
                    </Link>
                  </div>
                </div>

                <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto whitespace-nowrap px-1 pb-1">
                  {[
                    { id: "summary", label: "Summary" },
                    { id: "strategy", label: "90% Strategy" },
                    { id: "salary", label: "Salary + Callback" },
                    { id: "market", label: "Hiring Timing" },
                    { id: "improvements", label: "Improvements" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveResultTab(tab.id as ResultTabId)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-[0.06em] transition sm:text-xs sm:tracking-[0.1em] ${
                        activeResultTab === tab.id
                          ? "border-cyan-100/56 bg-cyan-200/24 text-cyan-50"
                          : "border-cyan-100/20 bg-cyan-100/8 text-cyan-50/72 hover:text-cyan-50"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 sm:p-6">
                {activeResultTab === "summary" && (
                  <div className="space-y-4 sm:space-y-6">
                    <div className="rounded-2xl border border-cyan-100/22 bg-cyan-100/8 p-3 sm:p-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Read This First</p>
                      <p className="mt-2 text-[13px] leading-relaxed text-cyan-50/78 sm:text-sm">
                        Start with your shortlist score, then follow the plan in this order:
                        <span className="font-semibold text-cyan-100"> Summary, then Strategy, then Salary, then Hiring Timing.</span>
                      </p>
                    </div>
                    <div className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
                      <div className="flex flex-col items-center justify-center rounded-3xl border border-cyan-100/20 bg-cyan-300/6 p-6 text-center">
                        <div
                          className="relative flex h-44 w-44 items-center justify-center rounded-full p-[14px]"
                          style={{
                            background: `conic-gradient(#45f0df ${result.overall_score}%, rgba(93,138,168,0.2) ${result.overall_score}% 100%)`,
                          }}
                        >
                          <div className="pointer-events-none absolute inset-1 rounded-full border border-dashed border-cyan-100/24 ring-spin" />
                          <div className="relative flex h-full w-full items-center justify-center rounded-full border border-cyan-100/15 bg-[#041224]/85">
                            <span className="text-4xl font-semibold text-cyan-50">{result.overall_score}%</span>
                          </div>
                        </div>
                        <p className="mt-5 text-sm uppercase tracking-[0.2em] text-cyan-100/65">Shortlist Probability</p>
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

                      <div className="space-y-4">
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
                            <p className="text-sm font-semibold text-cyan-100">Quick Wins</p>
                            <ul className="mt-2 space-y-1.5 text-[13px] text-cyan-50/75 sm:mt-3 sm:space-y-2 sm:text-sm">
                              {(result.quick_wins || []).map((item, index) => (
                                <li key={`win-${index}`}>- {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
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
                  </div>
                )}
              </div>
            </motion.section>
          </motion.div>
        )}

        {showFeedbackModal && authToken && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[140] flex items-center justify-center bg-[#020915]/90 px-4 backdrop-blur-xl"
          >
            <motion.section
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="w-full max-w-xl rounded-[1.7rem] border border-cyan-100/26 bg-[#04172e]/96 p-6 shadow-[0_35px_100px_rgba(0,0,0,0.6)]"
            >
              <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/70">Mandatory Feedback</p>
              <h3 className="mt-2 text-2xl font-semibold text-cyan-50">Rate Your First Analysis</h3>
              <p className="mt-2 text-sm text-cyan-50/72">
                Please share feedback once to unlock your next analysis attempt.
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
                {!feedbackRequired && (
                  <button
                    type="button"
                    onClick={() => setShowFeedbackModal(false)}
                    className="rounded-xl border border-cyan-100/24 bg-transparent px-4 py-2 text-sm font-semibold text-cyan-50/84 transition hover:bg-cyan-100/10"
                  >
                    Close
                  </button>
                )}
              </div>
            </motion.section>
          </motion.div>
        )}
      </div>
    </main>
  );
}
