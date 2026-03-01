"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { renderGoogleSignInButton } from "@/lib/google-sso";

type ResumeTemplateId = "quantum" | "executive" | "minimal" | "dublin" | "slate" | "metro";

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

type ResumeTemplate = {
  id: ResumeTemplateId;
  name: string;
  description: string;
  badge: string;
  panelClass: string;
  previewSrc: string;
};

const RESUME_TEMPLATES: ResumeTemplate[] = [
  {
    id: "metro",
    name: "Metro Prime",
    description: "Modern two-column professional format with clear role and skill separation.",
    badge: "Modern",
    panelClass: "border-indigo-100/32 bg-gradient-to-br from-indigo-200/15 via-cyan-100/7 to-slate-100/8",
    previewSrc: "/template-previews/metro-prime.png",
  },
  {
    id: "dublin",
    name: "Dublin Profile",
    description: "Clean single-column profile with bold teal highlights and compact bio header.",
    badge: "Corporate",
    panelClass: "border-emerald-100/36 bg-gradient-to-br from-emerald-200/18 via-cyan-100/10 to-sky-100/8",
    previewSrc: "/template-previews/dublin-profile.png",
  },
  {
    id: "slate",
    name: "Slate Sidebar",
    description: "Two-column premium layout with deep teal achievement rail.",
    badge: "Showcase",
    panelClass: "border-teal-100/40 bg-gradient-to-br from-teal-300/20 via-cyan-200/8 to-slate-100/8",
    previewSrc: "/template-previews/slate-sidebar.png",
  },
  {
    id: "quantum",
    name: "Quantum Grid",
    description: "Bold modern style for technical and product applications.",
    badge: "Tech",
    panelClass: "border-cyan-100/40 bg-gradient-to-br from-cyan-300/20 via-cyan-200/10 to-sky-200/8",
    previewSrc: "/template-previews/quantum-grid.png",
  },
  {
    id: "executive",
    name: "Executive Edge",
    description: "Premium business-forward structure with concise hierarchy.",
    badge: "Premium",
    panelClass: "border-amber-100/38 bg-gradient-to-br from-amber-100/15 via-amber-50/8 to-cyan-100/8",
    previewSrc: "/template-previews/executive-edge.png",
  },
  {
    id: "minimal",
    name: "Minimal Flow",
    description: "Clean ATS-friendly format for broad recruiter readability.",
    badge: "ATS",
    panelClass: "border-cyan-100/24 bg-cyan-100/6",
    previewSrc: "/template-previews/minimal-flow.png",
  },
];

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || "";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const AUTH_REQUEST_TIMEOUT_MS = 70000;
const STUDIO_AI_LOADING_STEPS = [
  "Extracting role intent and resume signals",
  "Synthesizing high-impact bullet upgrades",
  "Optimizing ATS keyword alignment",
  "Finalizing polished recruiter-ready draft",
] as const;
const MIN_STUDIO_AI_LOADING_MS = 6000;

export default function StudioPage() {
  const [mode, setMode] = useState<"build" | "polish" | "compose">("build");
  const [polishMode, setPolishMode] = useState<"paste" | "upload">("paste");

  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [skills, setSkills] = useState("");
  const [workExperience, setWorkExperience] = useState("");
  const [projects, setProjects] = useState("");
  const [education, setEducation] = useState("");

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [polishText, setPolishText] = useState("");

  const [optimizedResume, setOptimizedResume] = useState<string | null>(null);
  const [editableResume, setEditableResume] = useState("");
  const [composedDraft, setComposedDraft] = useState("");

  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplateId | null>("minimal");
  const [generationError, setGenerationError] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [building, setBuilding] = useState(false);
  const [studioAiLoading, setStudioAiLoading] = useState(false);
  const [studioAiStepIndex, setStudioAiStepIndex] = useState(0);
  const [studioAiProgress, setStudioAiProgress] = useState(10);

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authUserEmail, setAuthUserEmail] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [signupOtp, setSignupOtp] = useState("");
  const [signupOtpRequired, setSignupOtpRequired] = useState(false);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [forgotOtpRequested, setForgotOtpRequested] = useState(false);
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
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
    if (payload?.message) setAuthInfo(payload.message);
    if (payload?.otp_required) setSignupOtpRequired(true);
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
        window.localStorage.removeItem("hirescore_auth_token");
      });
  }, []);

  useEffect(() => {
    void warmBackend(apiUrl);
  }, []);

  useEffect(() => {
    if (!studioAiLoading) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [studioAiLoading]);

  const remainingGeneration = wallet ? Math.floor(wallet.credits / Math.max(1, wallet.pricing.ai_resume_generation)) : 0;
  const canUseAiGeneration = (wallet?.credits || 0) >= (wallet?.pricing.ai_resume_generation || 15);
  const canUsePdfTemplate = (wallet?.credits || 0) >= (wallet?.pricing.template_pdf_download || 20);

  const parseApiError = async (response: Response) => {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string | { message?: string; wallet?: CreditWallet }; wallet?: CreditWallet; auth_token?: string; user?: AuthUser }
      | null;

    if (payload?.wallet) {
      setWallet(payload.wallet);
    }
    if (payload?.auth_token || payload?.user) {
      applyAuthPayload(payload);
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
        body: JSON.stringify({ email, otp }),
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
    const container = googleButtonRef.current;
    if (!container) return;
    if (authToken || signupOtpRequired || forgotPasswordMode) {
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
        const payload = await submitGoogleAuthRequest(credential);
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
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Unable to sign in with Google.");
      } finally {
        setGoogleAuthLoading(false);
      }
    };

    void renderGoogleSignInButton({
      container,
      clientId: GOOGLE_CLIENT_ID,
      width: 300,
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
  }, [authToken, signupOtpRequired, forgotPasswordMode, authMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAuthSubmit = async () => {
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
          const payload = await requestForgotPasswordOtp(email);
          setForgotOtpRequested(true);
          setAuthInfo(payload.message || "Reset OTP sent. Enter OTP and new password.");
        } else {
          if (!email || !forgotOtp.trim() || !forgotNewPassword.trim()) {
            throw new Error("Enter email, OTP, and new password.");
          }
          const payload = await resetForgottenPassword(email, forgotOtp.trim(), forgotNewPassword.trim());
          applyAuthPayload(payload);
          setForgotPasswordMode(false);
          setForgotOtpRequested(false);
          setForgotOtp("");
          setForgotNewPassword("");
          setAuthPassword("");
          setAuthInfo("Password reset successful. You are now logged in.");
        }
      } else if (authMode === "signup" && signupOtpRequired) {
        if (!email || !signupOtp.trim()) throw new Error("Enter email and OTP.");
        const payload = await verifySignupOtp(email, signupOtp.trim());
        applyAuthPayload(payload);
        setSignupOtpRequired(false);
        setSignupOtp("");
        setAuthPassword("");
        setAuthInfo("Signup complete. Welcome to HireScore.");
      } else {
        if (!email || !password) throw new Error("Enter email and password.");
        const payload = await submitAuthRequest(authMode, email, password);
        if (authMode === "signup") {
          setSignupOtpRequired(Boolean(payload.otp_required));
          setAuthInfo(payload.message || "OTP sent to your email.");
        } else {
          applyAuthPayload(payload);
          setAuthPassword("");
        }
      }
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to authenticate.");
    } finally {
      window.clearTimeout(loadingGuard);
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    setAuthToken("");
    setAuthUserEmail("");
    setWallet(null);
    setGenerationError("");
    setTemplateError("");
    setAuthInfo("");
    setSignupOtpRequired(false);
    setSignupOtp("");
    setForgotPasswordMode(false);
    setForgotOtpRequested(false);
    setForgotOtp("");
    setForgotNewPassword("");
    window.localStorage.removeItem("hirescore_auth_token");
  };

  const assignOptimizedResume = (value: string) => {
    const normalizedValue = value.trim();
    setOptimizedResume(normalizedValue);
    setEditableResume(normalizedValue);
    setTemplateError("");
    setGenerationError("");
  };

  const inferExperienceYears = () => {
    const source = `${summary}\n${workExperience}`;
    const match = source.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i);
    return match?.[1] || "Not specified";
  };

  const refreshWallet = async () => {
    if (!authHeader) return;
    try {
      const response = await fetch(apiUrl("/auth/me"), {
        headers: {
          ...authHeader,
        },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as AuthPayload;
      applyAuthPayload(payload);
    } catch {
      // Keep Studio usable when wallet refresh fails.
    }
  };

  const runWithMinimumStudioAiLoading = async <T,>(task: () => Promise<T>) => {
    const startedAt = performance.now();
    setStudioAiLoading(true);
    setStudioAiStepIndex(0);
    setStudioAiProgress(10);

    const totalSteps = STUDIO_AI_LOADING_STEPS.length;
    const stepDuration = MIN_STUDIO_AI_LOADING_MS / totalSteps;
    let frameId = 0;

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const cappedElapsed = Math.min(elapsed, MIN_STUDIO_AI_LOADING_MS);
      const progress = 10 + (cappedElapsed / MIN_STUDIO_AI_LOADING_MS) * 85;
      const stepIndex = Math.min(totalSteps - 1, Math.floor(cappedElapsed / stepDuration));
      setStudioAiProgress(Math.round(progress));
      setStudioAiStepIndex(stepIndex);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    try {
      return await task();
    } finally {
      const elapsed = performance.now() - startedAt;
      const waitMs = Math.max(0, MIN_STUDIO_AI_LOADING_MS - elapsed);
      if (waitMs > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), waitMs);
        });
      }
      window.cancelAnimationFrame(frameId);
      setStudioAiProgress(100);
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 180);
      });
      setStudioAiLoading(false);
      setStudioAiStepIndex(0);
      setStudioAiProgress(10);
    }
  };

  const handleBuildResume = async () => {
    if (!authToken || !authHeader) {
      setGenerationError("Login required to use Resume Studio paid features.");
      return;
    }
    if (!canUseAiGeneration) {
      setGenerationError(`Need ${wallet?.pricing.ai_resume_generation || 15} credits for AI resume generation.`);
      return;
    }

    setBuilding(true);
    setGenerationError("");

    try {
      await runWithMinimumStudioAiLoading(async () => {
        if (mode === "build") {
          const response = await fetch(apiUrl("/build-resume"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify({
              name: name || "Candidate",
              industry,
              role,
              experience_years: inferExperienceYears(),
              skills,
              work_experience: `${summary ? `Summary:\n${summary}\n\n` : ""}${workExperience}`,
              projects,
              education,
            }),
          });

          if (!response.ok) {
            throw new Error(await parseApiError(response));
          }

          const data = (await response.json()) as {
            optimized_resume: string;
            ai_generated?: boolean;
            ai_warning?: string | null;
            wallet?: CreditWallet;
          };
          if (data.wallet) setWallet(data.wallet);
          assignOptimizedResume(data.optimized_resume || "");
          if (data.ai_generated === false && data.ai_warning) {
            setGenerationError(data.ai_warning);
          }
        } else if (mode === "polish" && polishMode === "upload" && uploadedFile) {
          const formData = new FormData();
          formData.append("file", uploadedFile);
          formData.append("industry", industry || "General");
          formData.append("role", role || "General Role");

          const response = await fetch(apiUrl("/polish-resume-pdf"), {
            method: "POST",
            headers: {
              ...authHeader,
            },
            body: formData,
          });

          if (!response.ok) {
            throw new Error(await parseApiError(response));
          }

          const data = (await response.json()) as {
            optimized_resume: string;
            ai_generated?: boolean;
            ai_warning?: string | null;
            wallet?: CreditWallet;
          };
          if (data.wallet) setWallet(data.wallet);
          assignOptimizedResume(data.optimized_resume || "");
          if (data.ai_generated === false && data.ai_warning) {
            setGenerationError(data.ai_warning);
          }
        } else if (mode === "polish" && polishMode === "paste") {
          const response = await fetch(apiUrl("/build-resume"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify({
              name: name || "Candidate",
              industry: industry || "General",
              role: role || "General Role",
              experience_years: inferExperienceYears(),
              skills: polishText,
              work_experience: polishText,
              projects: "",
              education: "",
            }),
          });

          if (!response.ok) {
            throw new Error(await parseApiError(response));
          }

          const data = (await response.json()) as {
            optimized_resume: string;
            ai_generated?: boolean;
            ai_warning?: string | null;
            wallet?: CreditWallet;
          };
          if (data.wallet) setWallet(data.wallet);
          assignOptimizedResume(data.optimized_resume || "");
          if (data.ai_generated === false && data.ai_warning) {
            setGenerationError(data.ai_warning);
          }
        }
      });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Unable to generate resume right now.");
    } finally {
      setBuilding(false);
    }
  };

  const buildDraftLocally = () => {
    const blocks: string[] = [];

    blocks.push((name.trim() || "Candidate Name").toUpperCase());

    if (role.trim() || industry.trim()) {
      blocks.push([role.trim(), industry.trim()].filter(Boolean).join(" | "));
    }

    if (summary.trim()) {
      blocks.push(`SUMMARY\n${summary.trim()}`);
    }

    if (skills.trim()) {
      blocks.push(`SKILLS\n${skills.trim()}`);
    }

    if (workExperience.trim()) {
      blocks.push(`WORK EXPERIENCE\n${workExperience.trim()}`);
    }

    if (projects.trim()) {
      blocks.push(`PROJECTS\n${projects.trim()}`);
    }

    if (education.trim()) {
      blocks.push(`EDUCATION\n${education.trim()}`);
    }

    return blocks.join("\n\n");
  };

  const handleComposeDraft = () => {
    const draft = buildDraftLocally();
    setComposedDraft(draft);
    assignOptimizedResume(draft);
  };

  const handleEnhanceCompose = async () => {
    if (!authToken || !authHeader) {
      setGenerationError("Login required to use AI enhancement.");
      return;
    }
    if (!canUseAiGeneration) {
      setGenerationError(`Need ${wallet?.pricing.ai_resume_generation || 15} credits for AI enhancement.`);
      return;
    }

    setBuilding(true);
    setGenerationError("");

    try {
      await runWithMinimumStudioAiLoading(async () => {
        const response = await fetch(apiUrl("/build-resume"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            name: name || "Candidate",
            industry,
            role,
            experience_years: inferExperienceYears(),
            skills,
            work_experience: `${summary ? `Summary:\n${summary}\n\n` : ""}${workExperience}`,
            projects,
            education,
          }),
        });

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        const data = (await response.json()) as {
          optimized_resume: string;
          ai_generated?: boolean;
          ai_warning?: string | null;
          wallet?: CreditWallet;
        };
        if (data.wallet) setWallet(data.wallet);
        assignOptimizedResume(data.optimized_resume || "");
        if (data.ai_generated === false && data.ai_warning) {
          setGenerationError(data.ai_warning);
        }
      });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Unable to enhance draft right now.");
    } finally {
      setBuilding(false);
    }
  };

  const handleDownloadResume = () => {
    if (!selectedTemplate) {
      setTemplateError("Select a template before downloading.");
      return;
    }

    const content = editableResume.trim();
    if (!content) {
      setTemplateError("Generate or compose resume content before downloading.");
      return;
    }

    const safeName =
      (name || "optimized-resume")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "optimized-resume";

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName}-${selectedTemplate}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const handleDownloadPdf = async () => {
    if (!authToken || !authHeader) {
      setTemplateError("Login required to download PDF templates.");
      return;
    }
    if (!selectedTemplate) {
      setTemplateError("Select a template before downloading PDF.");
      return;
    }
    if (!canUsePdfTemplate) {
      setTemplateError(`Need ${wallet?.pricing.template_pdf_download || 20} credits to download PDF template.`);
      return;
    }

    const content = editableResume.trim();
    if (!content) {
      setTemplateError("Generate or compose resume content before downloading.");
      return;
    }

    setTemplateError("");
    setBuilding(true);
    try {
      const response = await fetch(apiUrl("/export-resume-pdf"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          name: name || "optimized-resume",
          template: selectedTemplate,
          resume_text: content,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const blob = await response.blob();
      const safeName =
        (name || "optimized-resume")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "optimized-resume";

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${safeName}-${selectedTemplate}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      await refreshWallet();
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "Unable to export PDF right now.");
    }
    setBuilding(false);
  };

  const fieldClass =
    "w-full rounded-2xl border border-cyan-100/38 bg-[#08233f]/88 px-4 py-3.5 text-cyan-50 placeholder:text-cyan-50/45 outline-none transition focus:border-cyan-100 focus:shadow-[0_0_0_3px_rgba(146,238,255,0.24)]";
  const textAreaClass = `${fieldClass} min-h-28 leading-relaxed`;

  return (
    <main className="relative min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-10 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-7">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="studio-bright-panel relative overflow-hidden rounded-[2rem] p-5 sm:p-8"
        >
          <div className="absolute -left-10 top-4 h-44 w-44 rounded-full bg-cyan-300/24 blur-[85px]" />
          <div className="absolute right-[-48px] top-28 h-52 w-52 rounded-full bg-amber-200/18 blur-[95px]" />

          <div className="relative z-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-100/28 bg-cyan-100/8 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-cyan-100/86 sm:px-4 sm:text-xs sm:tracking-[0.22em]">
                <span className="live-dot" />
                Resume Studio
              </p>
              <h1 className="mt-4 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">
                Build, Polish, And Compose
                <span className="block bg-gradient-to-r from-cyan-100 via-cyan-300 to-amber-100 bg-clip-text text-transparent">
                  Interview-Ready Resumes
                </span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-cyan-50/80 sm:text-base">
                A brighter focused workspace for AI builds, polishing existing resumes, and studio drafting with premium templates.
              </p>
            </div>

            <div className="studio-soft-card rounded-3xl p-4">
              {authToken && wallet ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Wallet</p>
                    <p className="text-sm font-semibold text-cyan-50">{authUserEmail || "Signed in"}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-cyan-50/74">
                    <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1.5">Credits: {wallet.credits}</span>
                    <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1.5">AI runs left: {remainingGeneration}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-cyan-50/74">
                    <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1.5">
                      AI Generate: {wallet.pricing.ai_resume_generation} credits
                    </span>
                    <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1.5">
                      PDF Template: {wallet.pricing.template_pdf_download} credits
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href="/pricing"
                      className="rounded-xl border border-cyan-100/35 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
                    >
                      Buy Credit Packs
                    </a>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10"
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Login Required</p>
                  <p className="mt-2 text-sm text-cyan-50/76">
                    {forgotPasswordMode
                      ? "Reset password via email OTP."
                      : signupOtpRequired
                        ? "Enter the OTP sent to your email to complete signup."
                        : "AI studio actions are credit-based. Sign up to start."}
                  </p>
                  <div className="mt-3 grid gap-3">
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      placeholder="Email"
                      className="w-full rounded-2xl border border-cyan-100/38 bg-[#08233f]/88 px-4 py-3 text-cyan-50 placeholder:text-cyan-50/45 outline-none transition focus:border-cyan-100"
                    />
                    {forgotPasswordMode ? (
                      forgotOtpRequested ? (
                        <input
                          type="text"
                          value={forgotOtp}
                          onChange={(event) => setForgotOtp(event.target.value)}
                          placeholder="Reset OTP"
                          className="w-full rounded-2xl border border-cyan-100/38 bg-[#08233f]/88 px-4 py-3 text-cyan-50 placeholder:text-cyan-50/45 outline-none transition focus:border-cyan-100"
                        />
                      ) : (
                        <input
                          disabled
                          value=""
                          placeholder="OTP will be sent to this email"
                          className="w-full rounded-2xl border border-cyan-100/38 bg-[#08233f]/88 px-4 py-3 text-cyan-50 placeholder:text-cyan-50/45 opacity-70"
                        />
                      )
                    ) : signupOtpRequired ? (
                      <input
                        type="text"
                        value={signupOtp}
                        onChange={(event) => setSignupOtp(event.target.value)}
                        placeholder="Signup OTP"
                        className="w-full rounded-2xl border border-cyan-100/38 bg-[#08233f]/88 px-4 py-3 text-cyan-50 placeholder:text-cyan-50/45 outline-none transition focus:border-cyan-100"
                      />
                    ) : (
                      <input
                        type="password"
                        value={authPassword}
                        onChange={(event) => setAuthPassword(event.target.value)}
                        placeholder="Password"
                        className="w-full rounded-2xl border border-cyan-100/38 bg-[#08233f]/88 px-4 py-3 text-cyan-50 placeholder:text-cyan-50/45 outline-none transition focus:border-cyan-100"
                      />
                    )}
                  </div>
                  {forgotPasswordMode && forgotOtpRequested && (
                    <div className="mt-3">
                      <input
                        type="password"
                        value={forgotNewPassword}
                        onChange={(event) => setForgotNewPassword(event.target.value)}
                        placeholder="New password"
                        className="w-full rounded-2xl border border-cyan-100/38 bg-[#08233f]/88 px-4 py-3 text-cyan-50 placeholder:text-cyan-50/45 outline-none transition focus:border-cyan-100"
                      />
                    </div>
                  )}
                  {!forgotPasswordMode && !signupOtpRequired && (
                    <div className="mt-3">
                      <p className="text-center text-[11px] uppercase tracking-[0.16em] text-cyan-100/62">or continue with</p>
                      <div className="mt-2 flex justify-center">
                        <div ref={googleButtonRef} className="min-h-[42px] rounded-full" />
                      </div>
                      {googleAuthLoading && <p className="mt-2 text-center text-xs text-cyan-100/78">Completing Google sign-in...</p>}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAuthSubmit()}
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
                          setAuthError("");
                          setAuthInfo("");
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
                        setAuthError("");
                        setAuthInfo("");
                      }}
                      className="rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10"
                    >
                      {forgotPasswordMode ? "Back To Login" : "Forgot Password"}
                    </button>
                  </div>
                  {authInfo && <p className="mt-2 text-xs text-emerald-100">{authInfo}</p>}
                  {authError && <p className="mt-2 text-xs text-amber-100">{authError}</p>}
                </>
              )}
            </div>
          </div>
        </motion.section>

        <section className="studio-soft-card rounded-[2rem] p-6 sm:p-8">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { id: "build", title: "Build With AI", text: "Generate from structured details." },
              { id: "polish", title: "Polish Existing Resume", text: "Paste text or upload a PDF." },
              { id: "compose", title: "Compose In Studio", text: "Write manually and enhance with AI." },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setMode(item.id as "build" | "polish" | "compose");
                  setGenerationError("");
                }}
                className={`rounded-2xl border p-4 text-left transition ${
                  mode === item.id
                    ? "border-cyan-100/55 bg-cyan-200/20"
                    : "border-cyan-100/20 bg-cyan-100/5 hover:bg-cyan-100/10"
                }`}
              >
                <p className="text-sm font-semibold text-cyan-50">{item.title}</p>
                <p className="mt-1 text-xs text-cyan-50/66">{item.text}</p>
              </button>
            ))}
          </div>

          {generationError && (
            <div className="mt-5 rounded-xl border border-amber-100/40 bg-amber-100/14 px-4 py-3 text-sm text-amber-50">{generationError}</div>
          )}

          {mode === "build" && (
            <div className="mt-6 space-y-4">
              <h2 className="text-xl font-semibold text-cyan-50 sm:text-2xl">Build Resume With AI</h2>
              <input type="text" placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
              <div className="grid gap-4 md:grid-cols-2">
                <input type="text" placeholder="Target Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className={fieldClass} />
                <input type="text" placeholder="Target Role" value={role} onChange={(e) => setRole(e.target.value)} className={fieldClass} />
              </div>
              <textarea placeholder="Professional Snapshot (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} className={textAreaClass} />
              <textarea placeholder="Key Skills" value={skills} onChange={(e) => setSkills(e.target.value)} className={textAreaClass} />
              <textarea
                placeholder="Work Experience Highlights (roles, tenure, measurable outcomes)"
                value={workExperience}
                onChange={(e) => setWorkExperience(e.target.value)}
                className={textAreaClass}
              />
              <textarea placeholder="Projects" value={projects} onChange={(e) => setProjects(e.target.value)} className={textAreaClass} />
              <textarea placeholder="Education" value={education} onChange={(e) => setEducation(e.target.value)} className={textAreaClass} />

              <button
                type="button"
                onClick={handleBuildResume}
                disabled={building || !authToken}
                className="w-full rounded-2xl border border-cyan-100/36 bg-cyan-200/20 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/28"
              >
                {building ? "Generating..." : !authToken ? "Login To Continue" : "Generate Resume"}
              </button>
            </div>
          )}

          {mode === "polish" && (
            <div className="mt-6 space-y-5">
              <h2 className="text-xl font-semibold text-cyan-50 sm:text-2xl">Polish Existing Resume</h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setPolishMode("paste");
                    setUploadedFile(null);
                  }}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                    polishMode === "paste"
                      ? "border-cyan-100/45 bg-cyan-200/22 text-cyan-50"
                      : "border-cyan-100/20 bg-transparent text-cyan-50/75 hover:bg-cyan-200/10"
                  }`}
                >
                  Paste Resume Text
                </button>

                <button
                  type="button"
                  onClick={() => setPolishMode("upload")}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                    polishMode === "upload"
                      ? "border-cyan-100/45 bg-cyan-200/22 text-cyan-50"
                      : "border-cyan-100/20 bg-transparent text-cyan-50/75 hover:bg-cyan-200/10"
                  }`}
                >
                  Upload PDF
                </button>
              </div>

              {polishMode === "paste" && (
                <textarea
                  placeholder="Paste your full resume content here..."
                  value={polishText}
                  onChange={(e) => setPolishText(e.target.value)}
                  className={`${textAreaClass} min-h-[220px]`}
                />
              )}

              {polishMode === "upload" && (
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
                    }
                  }}
                  className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${
                    isDragging ? "border-cyan-200/65 bg-cyan-100/12" : "border-cyan-100/28 bg-cyan-100/4"
                  }`}
                >
                  {!uploadedFile ? (
                    <>
                      <p className="text-base font-semibold text-cyan-50">Drag and drop your resume PDF</p>
                      <p className="mt-2 text-sm text-cyan-50/62">or choose a file manually</p>
                      <label className="mt-4 inline-block cursor-pointer rounded-xl border border-cyan-100/35 bg-cyan-200/20 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/28">
                        Browse File
                        <input
                          type="file"
                          accept=".pdf"
                          className="hidden"
                          onChange={(event) => setUploadedFile(event.target.files?.[0] || null)}
                        />
                      </label>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-cyan-50">Selected: {uploadedFile.name}</p>
                      <button type="button" onClick={() => setUploadedFile(null)} className="text-sm text-amber-100/90 hover:text-amber-100">
                        Remove file
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleBuildResume}
                disabled={building || !authToken}
                className="w-full rounded-2xl border border-cyan-100/36 bg-cyan-200/20 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/28"
              >
                {building ? "Polishing..." : !authToken ? "Login To Continue" : "Polish Resume"}
              </button>
            </div>
          )}

          {mode === "compose" && (
            <div className="mt-6 space-y-4">
              <h2 className="text-xl font-semibold text-cyan-50 sm:text-2xl">Compose In Studio</h2>
              <input type="text" placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
              <div className="grid gap-4 md:grid-cols-2">
                <input type="text" placeholder="Target Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className={fieldClass} />
                <input type="text" placeholder="Target Role" value={role} onChange={(e) => setRole(e.target.value)} className={fieldClass} />
              </div>
              <textarea placeholder="Professional Snapshot (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} className={textAreaClass} />
              <textarea placeholder="Key Skills" value={skills} onChange={(e) => setSkills(e.target.value)} className={textAreaClass} />
              <textarea
                placeholder="Work Experience Highlights (roles, tenure, measurable outcomes)"
                value={workExperience}
                onChange={(e) => setWorkExperience(e.target.value)}
                className={textAreaClass}
              />
              <textarea placeholder="Projects" value={projects} onChange={(e) => setProjects(e.target.value)} className={textAreaClass} />
              <textarea placeholder="Education" value={education} onChange={(e) => setEducation(e.target.value)} className={textAreaClass} />

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleComposeDraft}
                  className="rounded-2xl border border-cyan-100/36 bg-cyan-200/20 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/28"
                >
                  Build Draft In Studio
                </button>
                <button
                  type="button"
                  onClick={handleEnhanceCompose}
                  disabled={building || !authToken || !canUseAiGeneration}
                  className="rounded-2xl border border-cyan-100/30 bg-cyan-100/8 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-100/14 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {building ? "Enhancing..." : !authToken ? "Login To Enhance" : canUseAiGeneration ? "Enhance With AI" : "Need More Credits"}
                </button>
              </div>

              {composedDraft && (
                <div className="rounded-2xl border border-cyan-100/20 bg-cyan-100/5 p-4">
                  <p className="mb-3 text-sm font-semibold text-cyan-100">Draft Preview</p>
                  <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap text-sm text-cyan-50/80">{composedDraft}</pre>
                </div>
              )}
            </div>
          )}
        </section>

        {studioAiLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[180] flex items-center justify-center bg-[#010715]/64 px-4 backdrop-blur-2xl"
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
                  <span className="analysis-live-core-value">{studioAiProgress}%</span>
                </div>
              </div>

              <div className="relative mt-3">
                <p className="text-center text-xs uppercase tracking-[0.2em] text-cyan-100/72">AI Resume Processing</p>
                <h3 className="mt-2 text-center text-2xl font-semibold text-cyan-50 sm:text-3xl">Crafting Your Best-Fit Resume Draft</h3>
                <p className="mt-3 text-center text-sm text-cyan-50/74">{STUDIO_AI_LOADING_STEPS[studioAiStepIndex]}</p>

                <div className="mt-5 h-2 overflow-hidden rounded-full border border-cyan-100/24 bg-cyan-100/8">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200 transition-[width] duration-150 ease-linear"
                    style={{ width: `${studioAiProgress}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-cyan-100/66">
                  <span>{STUDIO_AI_LOADING_STEPS[studioAiStepIndex]}</span>
                  <span>{studioAiProgress}%</span>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {STUDIO_AI_LOADING_STEPS.map((step, index) => {
                    const active = index === studioAiStepIndex;
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

        {optimizedResume && (
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="studio-soft-card rounded-[2rem] p-6 sm:p-8">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-xl font-semibold text-cyan-50">Resume Output Editor</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDownloadResume}
                  className="rounded-xl border border-cyan-100/35 bg-cyan-200/18 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/28"
                >
                  Download Resume (.txt)
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={building || !authToken || !canUsePdfTemplate}
                  className="rounded-xl border border-cyan-100/35 bg-cyan-100/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {building ? "Preparing..." : !authToken ? "Login For PDF" : canUsePdfTemplate ? "Download Template PDF" : "Need More Credits"}
                </button>
              </div>
            </div>

            <div className="mb-5 rounded-2xl border border-cyan-100/20 bg-cyan-100/5 p-4">
              <p className="mb-3 text-sm font-semibold text-cyan-100">Choose Template Style</p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {RESUME_TEMPLATES.map((template) => {
                  const active = selectedTemplate === template.id;
                  return (
                    <button
                      type="button"
                      key={template.id}
                      onClick={() => {
                        setSelectedTemplate(template.id);
                        setTemplateError("");
                      }}
                      className={`rounded-2xl border p-4 text-left transition ${template.panelClass} ${
                        active ? "ring-1 ring-cyan-100/65" : "hover:brightness-110"
                      }`}
                    >
                      <div className="mb-3 overflow-hidden rounded-xl border border-cyan-100/20 bg-[#071a33]">
                        <img
                          src={template.previewSrc}
                          alt={`${template.name} preview`}
                          className="h-32 w-full object-cover object-top"
                          loading="lazy"
                        />
                      </div>
                      <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/70">{template.badge}</p>
                      <p className="mt-2 text-base font-semibold text-cyan-50">{template.name}</p>
                      <p className="mt-2 text-sm text-cyan-50/72">{template.description}</p>
                    </button>
                  );
                })}
              </div>
              {templateError && <p className="mt-3 text-sm text-amber-200">{templateError}</p>}
            </div>

            <textarea
              value={editableResume}
              onChange={(event) => setEditableResume(event.target.value)}
              className="min-h-[380px] w-full rounded-2xl border border-cyan-100/18 bg-[#041125] p-4 text-sm leading-relaxed text-cyan-50/85 outline-none transition focus:border-cyan-200/45"
            />
          </motion.section>
        )}
      </div>
    </main>
  );
}
