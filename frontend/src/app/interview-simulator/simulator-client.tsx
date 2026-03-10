"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { addUtmParams } from "@/lib/utm";
import { trackEvent } from "@/lib/analytics";
import TrackedLink from "../components/tracked-link";

type InterviewSimulatorMode = "full" | "demo";

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

type SimulatorScoreBreakdown = {
  communication: number;
  clarity: number;
  domain_depth: number;
  confidence: number;
  overall?: number;
};

type SimulatorTurnFeedback = {
  round_number: number;
  stage_key?: string;
  stage_label?: string;
  question_number_in_stage?: number;
  question: string;
  answer: string;
  answer_word_count: number;
  response_time_seconds: number;
  scores: SimulatorScoreBreakdown;
  matched_focus_skills?: string[];
  missing_focus_skills?: string[];
  relevance_score?: number;
  evidence_score?: number;
  off_topic?: boolean;
  feedback_summary: string;
  strengths: string[];
  improvements: string[];
  next_focus_skill?: string;
  interviewer_bridge?: string;
  screening_decision?: string;
  screening_decision_reason?: string;
  round_decision?: string;
  round_decision_reason?: string;
  ai?: {
    used?: boolean;
    model?: string | null;
    reason?: string;
  };
  created_at?: string;
};

type SimulatorStageSummary = {
  stage_key: string;
  stage_label: string;
  stage_number: number;
  question_count: number;
  average_score: number;
};

type SimulatorRoundDecision = {
  stage_key: string;
  stage_label: string;
  stage_number: number;
  decision: "shortlisted" | "rejected";
  reason?: string;
};

type SimulatorReport = {
  overall_score: number;
  readiness_label: string;
  mode?: InterviewSimulatorMode;
  shortlist_prediction?: string;
  screening_decision?: string;
  screening_decision_reason?: string;
  round_decisions?: SimulatorRoundDecision[];
  score_breakdown: {
    communication: number;
    clarity: number;
    domain_depth: number;
    confidence: number;
  };
  strength_signals: string[];
  improvement_signals: string[];
  next_steps: string[];
  turns_completed: number;
  rounds_completed?: number;
  stage_summaries?: SimulatorStageSummary[];
  total_rounds: number;
};

type SimulatorStartPayload = {
  session_id: string;
  session_secret?: string;
  mode?: InterviewSimulatorMode;
  role: string;
  industry: string;
  candidate_name?: string;
  interviewer_name?: string;
  interviewer_title?: string;
  interviewer_voice?: string;
  opening_remark?: string;
  closing_remark?: string;
  difficulty: string;
  focus_skills: string[];
  round_number: number;
  current_stage_key?: string;
  current_stage_label?: string;
  question_number_in_stage?: number;
  total_rounds: number;
  progress_percent: number;
  current_question: string;
  status: string;
  guest_free_interviews_remaining?: number | null;
  report?: SimulatorReport | null;
  ai?: {
    used?: boolean;
    model?: string | null;
    reason?: string;
  };
};

type SimulatorTurnPayload = {
  session_id: string;
  mode?: InterviewSimulatorMode;
  completed: boolean;
  round_number: number;
  current_stage_key?: string;
  current_stage_label?: string;
  question_number_in_stage?: number;
  total_rounds: number;
  progress_percent: number;
  next_question?: string | null;
  turn_feedback?: SimulatorTurnFeedback | null;
  report?: SimulatorReport | null;
  status: string;
  interviewer_bridge?: string | null;
  interviewer_title?: string | null;
  interviewer_voice?: string | null;
  closing_remark?: string | null;
  saved_report_id?: number | null;
  screening_decision?: string | null;
  screening_decision_reason?: string | null;
  round_decision?: string | null;
  round_decision_reason?: string | null;
  round_decision_stage_key?: string | null;
  round_decision_stage_label?: string | null;
};

type PendingRoundStartState = {
  completedRoundNumber: number;
  completedStageLabel: string;
  completedStageKey: string;
  completedStageDecision: "shortlisted" | "rejected" | "pending";
  completedStageAverageScore: number;
  completedStageQuestionCount: number;
  stageDecisionLabel: string;
  stageDecisionReason: string;
  nextRoundNumber: number;
  nextStageLabel: string;
  nextQuestion: string;
  nextInterviewerBridge: string;
};

type SimulatorReportPayload = {
  session_id: string;
  mode?: InterviewSimulatorMode;
  role: string;
  industry: string;
  candidate_name?: string;
  interviewer_name?: string;
  interviewer_title?: string;
  interviewer_voice?: string;
  opening_remark?: string;
  closing_remark?: string;
  difficulty: string;
  round_number?: number;
  current_stage_key?: string;
  current_stage_label?: string;
  question_number_in_stage?: number;
  total_rounds: number;
  status: string;
  focus_skills: string[];
  current_question?: string;
  questions?: string[];
  turns: SimulatorTurnFeedback[];
  report: SimulatorReport;
  saved_report_id?: number | null;
  screening_decision?: string | null;
  screening_decision_reason?: string | null;
};

type ApiErrorDetail = {
  message?: string;
  wallet?: CreditWallet;
};

type ApiErrorPayload = {
  detail?: string | ApiErrorDetail;
  wallet?: CreditWallet;
};

type StoredSessionRef = {
  session_id: string;
  session_secret: string;
  room_stage?: "ready_to_join" | "live";
  account_key?: string;
};

type UploadExtractPayload = {
  extracted_text?: string;
  job_description?: string;
  extracted_chars: number;
  file_name: string;
  file_type?: string;
};

type InterviewRoomStage = "not_started" | "ready_to_join" | "joining" | "live" | "ended";

type PrefetchedQuestionAudio = {
  key: string;
  blob: Blob;
  modelLabel: string;
  voiceLabel: string;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
    SpeechRecognition?: SpeechRecognitionConstructorLike;
  }
}

const AUTH_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const SIMULATOR_API_BASE_URL = AUTH_API_BASE_URL;
const AUTH_REQUEST_TIMEOUT_MS = 70000;
const SIMULATOR_MIN_LOADING_MS = 1800;
const SESSION_STORAGE_KEY = "hirescore_interview_simulator_session_id";
const PUBLIC_UPLOAD_SESSION_STORAGE_KEY = "hirescore_interview_simulator_public_upload_session_id";
const DEFAULT_AI_INTERVIEWER_VOICE = "verse";
const JOIN_CHIME_DURATION_MS = 900;
const AUTO_START_LISTEN_DELAY_MS = 550;
const AUTO_SUBMIT_SILENCE_MS = 1400;
const AI_AUDIO_MIN_BYTES = 700;
const authApiUrl = (path: string) => `${AUTH_API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const simulatorApiUrl = (path: string) => `${SIMULATOR_API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const fieldClass =
  "w-full rounded-xl border border-cyan-100/26 bg-[#081f38]/76 px-3 py-2.5 text-sm text-cyan-50 placeholder:text-cyan-100/34 outline-none transition focus:border-cyan-100/62";
const textAreaClass = `${fieldClass} min-h-[120px] leading-relaxed`;

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const normalizeSimulatorMode = (value?: string | null): InterviewSimulatorMode => (String(value || "").trim().toLowerCase() === "demo" ? "demo" : "full");

const formatSeconds = (value: number) => {
  const safe = Math.max(0, Math.floor(value));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const normalizeSpeechText = (value: string) => value.replace(/\s+/g, " ").trim();

const composeSpeechAnswer = (base: string, finalized: string, interim = "") => {
  const chunks = [normalizeSpeechText(base), normalizeSpeechText(finalized), normalizeSpeechText(interim)].filter(Boolean);
  return normalizeSpeechText(chunks.join(" "));
};

const buildInterviewerSpeechText = (
  question: string,
  roundNumber: number,
  questionNumberInStage: number,
  openingRemark = "",
  interviewerBridge = ""
) => {
  const normalizedQuestion = normalizeSpeechText(question);
  const normalizedOpening = roundNumber <= 1 && questionNumberInStage <= 1 ? normalizeSpeechText(openingRemark) : "";
  const normalizedBridge = roundNumber > 1 || questionNumberInStage > 1 ? normalizeSpeechText(interviewerBridge) : "";
  const bridge = normalizedOpening ? "" : normalizedBridge || (roundNumber > 1 || questionNumberInStage > 1 ? "All right. Here's the next question." : "");
  return normalizeSpeechText([normalizedOpening, bridge, normalizedQuestion].filter(Boolean).join(" "));
};

const formatRoundLabel = (roundNumber: number, stageLabel: string) => {
  const safeRoundNumber = Math.max(1, roundNumber || 1);
  const safeStageLabel = stageLabel.trim() || "Screening";
  return `Round ${safeRoundNumber}: ${safeStageLabel}`;
};

const formatRoomTime = (value: Date) =>
  value.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });

const looksLikeIndianName = (value: string) => {
  const normalized = normalizeSpeechText(value).toLowerCase();
  if (!normalized) return false;
  const parts = normalized.split(" ").filter(Boolean);
  const familyNameHints = /(patel|sharma|gupta|singh|reddy|nair|iyer|joshi|jain|mehta|das|bhat|khan|ali)$/i;
  const givenNameHints = /(jeet|deep|veer|raj|kumar|nath|isha|ika|ananya|priya|aarav|riya|samir|vish|aditya|akash|sneha|pooja)/i;
  return parts.some((part) => familyNameHints.test(part) || givenNameHints.test(part));
};

const shouldPreferIndianEnglish = (candidateName: string) => {
  if (typeof navigator !== "undefined") {
    const locales = [navigator.language, ...(navigator.languages || [])].filter(Boolean).join(" ").toLowerCase();
    if (/\ben[-_]in\b/.test(locales) || /\bhi[-_]in\b/.test(locales)) {
      return true;
    }
  }
  return looksLikeIndianName(candidateName);
};

const sanitizeFocusSkillsForDisplay = (skills: string[]) => {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const rawSkill of skills || []) {
    const token = rawSkill
      .replace(/[\[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!token) continue;
    const lowered = token.toLowerCase();
    const words = token.split(" ").filter(Boolean);
    if (token.length > 42 || words.length > 5 || /[.!?]/.test(token)) continue;
    if (
      lowered.includes("your company") ||
      lowered.includes("looking to hire") ||
      lowered.includes("developed a reputation") ||
      lowered.includes("high performing sales team") ||
      lowered.includes("consistently delivering") ||
      lowered.includes("staying informed")
    ) {
      continue;
    }
    if (["competencies", "market conditions", "company name"].includes(lowered)) continue;
    const dedupeKey = lowered;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    cleaned.push(token);
    if (cleaned.length >= 8) break;
  }
  return cleaned;
};

const buildInterviewerRoundAnswer = (
  question: string,
  stageLabel: string,
  decision: "shortlisted" | "rejected" | "pending"
) => {
  const normalized = normalizeSpeechText(question).toLowerCase();
  if (!normalized) return "";
  if (/(salary|ctc|compensation|pay|package|offer)/i.test(normalized)) {
    return "Good question. Compensation is finalized only after final-stage alignment. If you progress, we discuss it transparently in the closing round.";
  }
  if (/(next|timeline|result|update|when|notify)/i.test(normalized)) {
    return decision === "shortlisted"
      ? `You are currently shortlisted from ${stageLabel}. The next round is ready in this simulator, and status updates are also reflected in your report.`
      : `Your current status after ${stageLabel} is not shortlisted. You can review your report now; if requirements reopen, you'll be informed.`;
  }
  if (/(feedback|improve|better|mistake|weak)/i.test(normalized)) {
    return "Focus on direct role relevance, measurable outcomes, and clearer structure. The round score and improvement signals below show exactly where to sharpen.";
  }
  if (/(team|manager|role|responsibilit|culture|work)/i.test(normalized)) {
    return "The role expects strong execution, communication, and decision quality under real constraints. We test this progressively across rounds.";
  }
  return "Thanks for asking. Based on your current round, keep answers specific, measurable, and role-aligned. The simulator will adapt next-round depth from your performance.";
};

const generatePublicSessionId = () => {
  if (typeof window === "undefined") return "";
  try {
    const randomBytes = new Uint8Array(10);
    window.crypto.getRandomValues(randomBytes);
    const token = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `sim-public-${token}`;
  } catch {
    return `sim-public-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
};

export default function InterviewSimulatorClient() {
  const [authToken, setAuthToken] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [authResolved, setAuthResolved] = useState(false);
  const [candidateName, setCandidateName] = useState("");
  const [role, setRole] = useState("");
  const [industry, setIndustry] = useState("");
  const [difficulty, setDifficulty] = useState<"foundation" | "standard" | "advanced">("standard");
  const [simulatorMode, setSimulatorMode] = useState<InterviewSimulatorMode>("full");
  const [resumeText, setResumeText] = useState("");
  const [resumeUploadedFileName, setResumeUploadedFileName] = useState("");
  const [resumeFileUploading, setResumeFileUploading] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [jdUploadedFileName, setJdUploadedFileName] = useState("");
  const [jdFileUploading, setJdFileUploading] = useState(false);
  const [publicUploadSessionId, setPublicUploadSessionId] = useState("");
  const [simulatorError, setSimulatorError] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionSecret, setSessionSecret] = useState("");
  const [focusSkills, setFocusSkills] = useState<string[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [roundNumber, setRoundNumber] = useState(0);
  const [currentStageLabel, setCurrentStageLabel] = useState("Screening");
  const [questionNumberInStage, setQuestionNumberInStage] = useState(1);
  const [totalRounds, setTotalRounds] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [pendingRoundStart, setPendingRoundStart] = useState<PendingRoundStartState | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [answerTimerSeconds, setAnswerTimerSeconds] = useState(0);
  const [turnHistory, setTurnHistory] = useState<SimulatorTurnFeedback[]>([]);
  const [report, setReport] = useState<SimulatorReport | null>(null);
  const [interviewerName, setInterviewerName] = useState("Avery Bennett");
  const [interviewerTitle, setInterviewerTitle] = useState("Lead Interviewer");
  const [interviewerVoice, setInterviewerVoice] = useState(DEFAULT_AI_INTERVIEWER_VOICE);
  const [openingRemark, setOpeningRemark] = useState("");
  const [interviewerBridge, setInterviewerBridge] = useState("");
  const [closingRemark, setClosingRemark] = useState("");
  const [savedDashboardReportId, setSavedDashboardReportId] = useState<number | null>(null);
  const [screeningDecision, setScreeningDecision] = useState("");
  const [screeningDecisionReason, setScreeningDecisionReason] = useState("");
  const [guestFreeInterviewsRemaining, setGuestFreeInterviewsRemaining] = useState<number | null>(null);
  const [roundQuestionText, setRoundQuestionText] = useState("");
  const [roundQuestionReply, setRoundQuestionReply] = useState("");
  const [startLoading, setStartLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [isQuestionAudioPlaying, setIsQuestionAudioPlaying] = useState(false);
  const [roomStage, setRoomStage] = useState<InterviewRoomStage>("not_started");
  const [interviewerJoined, setInterviewerJoined] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [prejoinModalOpen, setPrejoinModalOpen] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [roomClock, setRoomClock] = useState(() => new Date());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const keepListeningRef = useRef(false);
  const interimTranscriptRef = useRef("");
  const speechBaseAnswerRef = useRef("");
  const speechFinalTranscriptRef = useRef("");
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioUrlRef = useRef("");
  const questionAudioAbortRef = useRef<AbortController | null>(null);
  const prefetchedQuestionAudioRef = useRef<PrefetchedQuestionAudio | null>(null);
  const prefetchedQuestionAbortRef = useRef<AbortController | null>(null);
  const prefetchedQuestionAudioPromiseRef = useRef<Promise<PrefetchedQuestionAudio | null> | null>(null);
  const prefetchingQuestionKeyRef = useRef("");
  const autoSpokenQuestionRef = useRef("");
  const autoListenTimeoutRef = useRef<number | null>(null);
  const autoSubmitTimeoutRef = useRef<number | null>(null);
  const pendingVoiceAutoSubmitRef = useRef("");
  const questionPlaybackAutoListenRef = useRef(false);
  const prejoinVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);

  const authHeader = useMemo(() => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined), [authToken]);
  const sessionActive = Boolean(sessionId && currentQuestion && !report);
  const latestTurnFeedback = turnHistory.length > 0 ? turnHistory[turnHistory.length - 1] : null;
  const hasCandidateName = candidateName.trim().length >= 2;
  const hasTargetRole = role.trim().length >= 2;
  const hasResumeContext = resumeText.trim().length >= 24;
  const hasJobDescriptionContext = jobDescription.trim().length >= 24;
  const isDemoMode = simulatorMode === "demo";
  const setupRequiresResumeAndJd = !isDemoMode;
  const shouldShowCompactSetup = (Boolean(sessionId) || Boolean(report)) && !setupExpanded;
  const currentSessionAccountKey = useMemo(() => {
    const normalizedEmail = authEmail.trim().toLowerCase();
    if (authToken && normalizedEmail) return `auth:${normalizedEmail}`;
    if (authToken) return "auth:unknown";
    return "guest";
  }, [authEmail, authToken]);
  const spokenQuestionText = useMemo(
    () => buildInterviewerSpeechText(currentQuestion, roundNumber, questionNumberInStage, openingRemark, interviewerBridge),
    [currentQuestion, interviewerBridge, openingRemark, questionNumberInStage, roundNumber]
  );
  const focusSkillsForDisplay = useMemo(() => sanitizeFocusSkillsForDisplay(focusSkills), [focusSkills]);
  const preferIndianEnglishVoice = useMemo(() => shouldPreferIndianEnglish(candidateName), [candidateName]);
  const meetingRoomCode = useMemo(() => {
    if (!sessionId) return "meet-hirescore-live";
    return `meet-${sessionId.slice(0, 4)}-${sessionId.slice(4, 8)}-${sessionId.slice(8, 12)}`;
  }, [sessionId]);

  useEffect(() => {
    void warmBackend(simulatorApiUrl);
    if (AUTH_API_BASE_URL !== SIMULATOR_API_BASE_URL) {
      void warmBackend(authApiUrl);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryMode = normalizeSimulatorMode(params.get("mode"));
    const rolePrefill = (params.get("role") || "").trim().slice(0, 120);
    const industryPrefill = (params.get("industry") || "").trim().slice(0, 80);
    const candidateNamePrefill = (params.get("candidate_name") || "").trim().slice(0, 80);
    const resumePrefill = (params.get("resume_text") || "").trim().slice(0, 14000);
    const jdPrefill = (params.get("job_description") || "").trim().slice(0, 14000);

    setSimulatorMode(queryMode);
    if (rolePrefill) setRole(rolePrefill);
    if (industryPrefill) setIndustry(industryPrefill);
    if (candidateNamePrefill) setCandidateName(candidateNamePrefill);
    if (resumePrefill) setResumeText(resumePrefill);
    if (jdPrefill) setJobDescription(jdPrefill);
  }, []);

  useEffect(() => {
    const speechCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSpeechSupported(Boolean(speechCtor));
    setTtsSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const pickNaturalVoice = () => {
      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) return;
      const candidates = voices.filter((voice) => /^en(-|$)/i.test(voice.lang || "") || /english/i.test(voice.name));
      const source = candidates.length ? candidates : voices;
      const indianVoices = source.filter(
        (voice) => /en[-_]?in/i.test(voice.lang || "") || /india|indian|aditi|ananya|priya|ravi|neerja|swara|heera|kajal/i.test(voice.name)
      );
      const orderedSource =
        preferIndianEnglishVoice && indianVoices.length
          ? [...indianVoices, ...source.filter((voice) => !indianVoices.includes(voice))]
          : source;
      const priorityMatchers = preferIndianEnglishVoice
        ? [
            /en[-_ ]?in/i,
            /india|indian/i,
            /microsoft (heera|swara|prabhat|neerja|ananya)/i,
            /google .*english.*india/i,
            /natural/i,
            /neural/i,
          ]
        : [
            /google us english/i,
            /microsoft (aria|jenny|guy|davis)/i,
            /samantha/i,
            /daniel/i,
            /karen/i,
            /serena/i,
            /zira/i,
            /natural/i,
            /neural/i,
          ];
      let picked: SpeechSynthesisVoice | undefined;
      for (const matcher of priorityMatchers) {
        picked = orderedSource.find((voice) => matcher.test(voice.name) || matcher.test(voice.lang || ""));
        if (picked) break;
      }
      if (!picked) {
        picked = orderedSource.find((voice) => !voice.localService) || orderedSource[0];
      }
      selectedVoiceRef.current = picked || null;
    };

    pickNaturalVoice();
    window.speechSynthesis.onvoiceschanged = pickNaturalVoice;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === pickNaturalVoice) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [preferIndianEnglishVoice]);

  useEffect(() => {
    const stored = window.localStorage.getItem(PUBLIC_UPLOAD_SESSION_STORAGE_KEY) || "";
    if (stored) {
      setPublicUploadSessionId(stored);
      return;
    }
    const generated = generatePublicSessionId();
    if (!generated) return;
    window.localStorage.setItem(PUBLIC_UPLOAD_SESSION_STORAGE_KEY, generated);
    setPublicUploadSessionId(generated);
  }, []);

  useEffect(() => {
    const attachStream = (element: HTMLVideoElement | null) => {
      if (!element) return;
      if (!cameraEnabled || !mediaStreamRef.current) {
        element.srcObject = null;
        return;
      }
      element.srcObject = mediaStreamRef.current;
      void element.play().catch(() => undefined);
    };
    attachStream(prejoinVideoRef.current);
    attachStream(liveVideoRef.current);
  }, [cameraEnabled, roomStage, prejoinModalOpen]);

  useEffect(() => {
    if (roomStage !== "live") return;
    setRoomClock(new Date());
    const timer = window.setInterval(() => {
      setRoomClock(new Date());
    }, 30000);
    return () => {
      window.clearInterval(timer);
    };
  }, [roomStage]);

  useEffect(() => {
    const syncAuth = async () => {
      setAuthResolved(false);
      const token = window.localStorage.getItem("hirescore_auth_token") || "";
      if (!token) {
        setAuthToken("");
        setWallet(null);
        setAuthEmail("");
        setAuthError("");
        setAuthResolved(true);
        return;
      }

      try {
        const response = await fetch(authApiUrl("/auth/me"), {
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
          setAuthError("");
          setAuthResolved(true);
          return;
        }
        const payload = (await response.json()) as AuthPayload;
        setAuthToken(token);
        setWallet(payload.wallet || null);
        setAuthEmail(payload.user?.email || "");
        setAuthError("");
        setAuthResolved(true);
      } catch {
        setAuthToken(token);
        setWallet(null);
        setAuthEmail("");
        setAuthError("Signed-in account check is currently unavailable. Continuing with your stored login token.");
        setAuthResolved(true);
      }
    };
    void syncAuth();
  }, []);

  useEffect(() => {
    if (!sessionActive) return;
    const timer = window.setInterval(() => {
      setAnswerTimerSeconds((previous) => previous + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [sessionActive, currentQuestion]);

  useEffect(() => {
    if (!spokenQuestionText || !sessionId || !sessionSecret || report) {
      clearPrefetchedQuestionAudio();
      return;
    }
    const prefetchKey = `${sessionId}:${roundNumber}:${spokenQuestionText}`;
    if (prefetchedQuestionAudioRef.current?.key === prefetchKey) return;
    if (prefetchingQuestionKeyRef.current === prefetchKey && prefetchedQuestionAudioPromiseRef.current) return;

    if (prefetchedQuestionAbortRef.current) {
      prefetchedQuestionAbortRef.current.abort();
      prefetchedQuestionAbortRef.current = null;
    }
    const controller = new AbortController();
    prefetchedQuestionAbortRef.current = controller;
    prefetchingQuestionKeyRef.current = prefetchKey;
    const prefetchPromise = fetchAiQuestionAudio(spokenQuestionText, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return null;
        const prefetched = {
          key: prefetchKey,
          blob: payload.blob,
          modelLabel: payload.modelLabel,
          voiceLabel: payload.voiceLabel,
        };
        prefetchedQuestionAudioRef.current = prefetched;
        return prefetched;
      })
      .catch(() => null)
      .finally(() => {
        if (prefetchedQuestionAbortRef.current === controller) {
          prefetchedQuestionAbortRef.current = null;
        }
        if (prefetchingQuestionKeyRef.current === prefetchKey) {
          prefetchingQuestionKeyRef.current = "";
          prefetchedQuestionAudioPromiseRef.current = null;
        }
      });
    prefetchedQuestionAudioPromiseRef.current = prefetchPromise;
    void prefetchPromise;
  }, [spokenQuestionText, sessionId, sessionSecret, report, roundNumber, authHeader, authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (roomStage !== "live" || !sessionId || report) return;
    if (!spokenQuestionText) return;
    const questionKey = `${sessionId}:${roundNumber}:${spokenQuestionText}`;
    if (autoSpokenQuestionRef.current === questionKey) return;
    autoSpokenQuestionRef.current = questionKey;
    void speakCurrentQuestion({ force: true, silentErrors: true, trigger: "auto" });
  }, [roomStage, spokenQuestionText, sessionId, roundNumber, report]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authResolved) return;
    const storedRaw = window.localStorage.getItem(SESSION_STORAGE_KEY) || "";
    if (!storedRaw) return;

    let storedSession: StoredSessionRef | null = null;
    try {
      const parsed = JSON.parse(storedRaw) as StoredSessionRef;
      if (!parsed?.session_id || !parsed?.session_secret) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
      }
      const storedAccountKey = (typeof parsed.account_key === "string" ? parsed.account_key : "").trim().toLowerCase();
      if (!storedAccountKey || storedAccountKey !== currentSessionAccountKey) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
      }
      storedSession = parsed;
    } catch {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    let cancelled = false;
    const restoreSession = async () => {
      try {
        const payload = await fetchJsonWithWakeAndRetry<SimulatorReportPayload>({
          apiUrl: simulatorApiUrl,
          path: "/analysis/interview-simulator/report",
          init: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authHeader || {}),
            },
            body: JSON.stringify({
              session_id: storedSession?.session_id,
              session_secret: storedSession?.session_secret,
              auth_token: authToken || undefined,
            }),
          },
          timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        });
        if (cancelled) return;
        setSessionId(payload.session_id);
        setSessionSecret(storedSession?.session_secret || "");
        setCandidateName(payload.candidate_name || "");
        setRole(payload.role || "");
        setIndustry(payload.industry || "");
        setInterviewerName(payload.interviewer_name || "Avery Bennett");
        setInterviewerTitle(payload.interviewer_title || "Lead Interviewer");
        setInterviewerVoice(payload.interviewer_voice || DEFAULT_AI_INTERVIEWER_VOICE);
        setOpeningRemark(payload.opening_remark || "");
        setInterviewerBridge("");
        setClosingRemark(payload.closing_remark || "");
        setSavedDashboardReportId(payload.saved_report_id ?? null);
        setScreeningDecision(payload.screening_decision || payload.report?.screening_decision || "");
        setScreeningDecisionReason(payload.screening_decision_reason || payload.report?.screening_decision_reason || "");
        setSimulatorMode(normalizeSimulatorMode(payload.mode || payload.report?.mode));
        setPendingRoundStart(null);
        setDifficulty((payload.difficulty as "foundation" | "standard" | "advanced") || "standard");
        setTotalRounds(payload.total_rounds || 0);
        setFocusSkills(sanitizeFocusSkillsForDisplay(payload.focus_skills || []));
        setTurnHistory(payload.turns || []);
        setReport(payload.status === "completed" ? payload.report : null);
        setSetupExpanded(false);
        if (payload.status === "completed") {
          setCurrentQuestion("");
          setRoundNumber(payload.report?.rounds_completed || payload.round_number || payload.total_rounds || 0);
          setCurrentStageLabel(payload.current_stage_label || payload.turns?.[payload.turns.length - 1]?.stage_label || "Completed");
          setQuestionNumberInStage(payload.question_number_in_stage || payload.turns?.[payload.turns.length - 1]?.question_number_in_stage || 0);
          setProgressPercent(100);
          setAnswerText("");
          setPrejoinModalOpen(false);
          setRoomStage("ended");
          setInterviewerJoined(false);
          return;
        }
        const previousTurn = payload.turns && payload.turns.length > 0 ? payload.turns[payload.turns.length - 1] : null;
        const restoredStage = storedSession?.room_stage === "ready_to_join" ? "ready_to_join" : "live";
        const latestKnownQuestion = payload.questions && payload.questions.length > 0 ? payload.questions[payload.questions.length - 1] : "";
        setCurrentQuestion(payload.current_question || latestKnownQuestion || "");
        setInterviewerBridge(previousTurn?.interviewer_bridge || "");
        setRoundNumber(Math.max(1, payload.round_number || 1));
        setCurrentStageLabel(payload.current_stage_label || previousTurn?.stage_label || "Screening");
        setQuestionNumberInStage(Math.max(1, payload.question_number_in_stage || 1));
        setProgressPercent(clampPercent(payload.status === "completed" ? 100 : ((payload.round_number || 1) / Math.max(1, payload.total_rounds || 1)) * 100));
        setPrejoinModalOpen(restoredStage === "ready_to_join");
        setRoomStage(restoredStage);
        setInterviewerJoined(restoredStage === "live");
      } catch {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    };
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [authResolved, authToken, authHeader, currentSessionAccountKey]);

  useEffect(() => {
    return () => {
      keepListeningRef.current = false;
      interimTranscriptRef.current = "";
      speechBaseAnswerRef.current = "";
      speechFinalTranscriptRef.current = "";
      pendingVoiceAutoSubmitRef.current = "";
      questionPlaybackAutoListenRef.current = false;
      if (autoListenTimeoutRef.current) {
        window.clearTimeout(autoListenTimeoutRef.current);
        autoListenTimeoutRef.current = null;
      }
      if (autoSubmitTimeoutRef.current) {
        window.clearTimeout(autoSubmitTimeoutRef.current);
        autoSubmitTimeoutRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (questionAudioAbortRef.current) {
        questionAudioAbortRef.current.abort();
        questionAudioAbortRef.current = null;
      }
      if (questionAudioRef.current) {
        try {
          questionAudioRef.current.pause();
          questionAudioRef.current.currentTime = 0;
        } catch {}
        questionAudioRef.current = null;
      }
      if (questionAudioUrlRef.current) {
        URL.revokeObjectURL(questionAudioUrlRef.current);
        questionAudioUrlRef.current = "";
      }
      if (prefetchedQuestionAbortRef.current) {
        prefetchedQuestionAbortRef.current.abort();
        prefetchedQuestionAbortRef.current = null;
      }
      if (prefetchedQuestionAudioRef.current) {
        prefetchedQuestionAudioRef.current = null;
      }
      prefetchedQuestionAudioPromiseRef.current = null;
      prefetchingQuestionKeyRef.current = "";
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const parseApiError = async (response: Response) => {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    if (payload?.wallet) setWallet(payload.wallet);
    if (payload?.detail && typeof payload.detail === "object") {
      if (payload.detail.wallet) setWallet(payload.detail.wallet);
      return payload.detail.message || `Request failed (${response.status})`;
    }
    if (typeof payload?.detail === "string") return payload.detail;
    return `Request failed (${response.status})`;
  };

  const clearAutoListenTimeout = () => {
    if (autoListenTimeoutRef.current) {
      window.clearTimeout(autoListenTimeoutRef.current);
      autoListenTimeoutRef.current = null;
    }
  };

  const clearAutoSubmitTimeout = () => {
    if (autoSubmitTimeoutRef.current) {
      window.clearTimeout(autoSubmitTimeoutRef.current);
      autoSubmitTimeoutRef.current = null;
    }
  };

  const scheduleAutomaticVoiceCapture = (delayMs = AUTO_START_LISTEN_DELAY_MS) => {
    if (!speechSupported || roomStage !== "live" || Boolean(report) || submitLoading || joinLoading || !sessionId || Boolean(pendingRoundStart)) return;
    clearAutoListenTimeout();
    autoListenTimeoutRef.current = window.setTimeout(() => {
      autoListenTimeoutRef.current = null;
      if (!speechSupported || roomStage !== "live" || Boolean(report) || submitLoading || joinLoading || !sessionId || Boolean(pendingRoundStart)) return;
      if (isListening || isQuestionAudioPlaying || answerText.trim()) return;
      void startVoiceCapture({ autoStart: true });
    }, delayMs);
  };

  const stopQuestionAudioPlayback = () => {
    questionPlaybackAutoListenRef.current = false;
    clearAutoListenTimeout();
    if (questionAudioAbortRef.current) {
      questionAudioAbortRef.current.abort();
      questionAudioAbortRef.current = null;
    }
    if (questionAudioRef.current) {
      try {
        questionAudioRef.current.pause();
        questionAudioRef.current.currentTime = 0;
      } catch {}
      questionAudioRef.current = null;
    }
    if (questionAudioUrlRef.current) {
      URL.revokeObjectURL(questionAudioUrlRef.current);
      questionAudioUrlRef.current = "";
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsQuestionAudioPlaying(false);
  };

  const clearPrefetchedQuestionAudio = () => {
    if (prefetchedQuestionAbortRef.current) {
      prefetchedQuestionAbortRef.current.abort();
      prefetchedQuestionAbortRef.current = null;
    }
    prefetchedQuestionAudioRef.current = null;
    prefetchedQuestionAudioPromiseRef.current = null;
    prefetchingQuestionKeyRef.current = "";
  };

  const playMeetingJoinChime = async () => {
    if (typeof window === "undefined") return;
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const now = context.currentTime + 0.02;
    const scheduleTone = (frequency: number, start: number, duration: number, gainStart = 0.09) => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(gainStart, start + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.04);
    };
    scheduleTone(659.26, now, 0.24, 0.07);
    scheduleTone(987.77, now + 0.26, 0.36, 0.08);
    await new Promise<void>((resolve) => window.setTimeout(resolve, JOIN_CHIME_DURATION_MS));
    try {
      await context.close();
    } catch {}
  };

  const fetchAiQuestionAudio = async (
    questionText: string,
    signal?: AbortSignal
  ): Promise<{ blob: Blob; modelLabel: string; voiceLabel: string }> => {
    if (!sessionId || !sessionSecret) {
      throw new Error("start_session_required_for_ai_voice");
    }
    const response = await fetch(simulatorApiUrl("/analysis/interview-simulator/tts"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader || {}),
      },
      body: JSON.stringify({
        session_id: sessionId,
        session_secret: sessionSecret,
        text: questionText,
        voice: interviewerVoice || DEFAULT_AI_INTERVIEWER_VOICE,
        auth_token: authToken || undefined,
      }),
      signal,
    });
    if (!response.ok) {
      const err = await parseApiError(response);
      throw new Error(err || `Request failed (${response.status})`);
    }
    const blob = await response.blob();
    if (!blob || blob.size < AI_AUDIO_MIN_BYTES) {
      throw new Error("ai_audio_empty");
    }
    return {
      blob,
      modelLabel: response.headers.get("X-Interview-TTS-Model") || "",
      voiceLabel: response.headers.get("X-Interview-TTS-Voice") || "",
    };
  };

  const playBrowserSpeechFallback = (text: string, shouldAutoListenAfterPlayback = false) => {
    if (typeof window === "undefined" || !ttsSupported || !("speechSynthesis" in window)) {
      throw new Error("Text-to-speech is not supported in this browser.");
    }
    window.speechSynthesis.cancel();
    questionPlaybackAutoListenRef.current = shouldAutoListenAfterPlayback;
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text.replace(/\s+/g, " ").trim());
      const preferredVoice = selectedVoiceRef.current;
      if (preferredVoice) {
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang || (preferIndianEnglishVoice ? "en-IN" : "en-US");
      } else {
        utterance.lang = preferIndianEnglishVoice ? "en-IN" : "en-US";
      }
      utterance.rate = preferIndianEnglishVoice ? 0.94 : 0.95;
      utterance.pitch = 1.0;
      utterance.volume = 1;
      utterance.onstart = () => {
        setIsQuestionAudioPlaying(true);
      };
      utterance.onend = () => {
        setIsQuestionAudioPlaying(false);
        const shouldAutoListen = questionPlaybackAutoListenRef.current;
        questionPlaybackAutoListenRef.current = false;
        if (shouldAutoListen) {
          scheduleAutomaticVoiceCapture();
        }
        resolve();
      };
      utterance.onerror = () => {
        setIsQuestionAudioPlaying(false);
        questionPlaybackAutoListenRef.current = false;
        reject(new Error("browser_speech_failed"));
      };
      window.speechSynthesis.speak(utterance);
    });
  };

  const storeSessionRef = (nextSessionId: string, nextSessionSecret: string, nextRoomStage: "ready_to_join" | "live") => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        session_id: nextSessionId,
        session_secret: nextSessionSecret,
        room_stage: nextRoomStage,
        account_key: currentSessionAccountKey,
      } satisfies StoredSessionRef)
    );
  };

  const extractTextFromUpload = async (file: File, context: "resume" | "jd") => {
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

    let activePublicSessionId = publicUploadSessionId;
    if (!activePublicSessionId) {
      const generated = generatePublicSessionId();
      if (!generated) {
        throw new Error("Unable to initialize upload session. Please retry.");
      }
      window.localStorage.setItem(PUBLIC_UPLOAD_SESSION_STORAGE_KEY, generated);
      setPublicUploadSessionId(generated);
      activePublicSessionId = generated;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("session_id", activePublicSessionId);

    const payload = await fetchJsonWithWakeAndRetry<UploadExtractPayload>({
      apiUrl: simulatorApiUrl,
      path: "/public/instant-fit-check/extract",
      init: {
        method: "POST",
        body: formData,
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: parseApiError,
      abortErrorMessage: `${context === "resume" ? "Resume" : "JD"} extraction is taking longer than expected. Please retry.`,
    });
    const extractedText = (payload.extracted_text || payload.job_description || "").trim();
    if (extractedText.length < 24) {
      throw new Error(`Could not extract enough text from ${context === "resume" ? "resume" : "JD"} file.`);
    }
    return {
      text: extractedText,
      fileName: payload.file_name || file.name,
    };
  };

  const handleUploadResumeFile = async (file: File | null) => {
    if (!file) return;
    setSimulatorError("");
    setResumeFileUploading(true);
    try {
      const payload = await extractTextFromUpload(file, "resume");
      setResumeText(payload.text);
      setResumeUploadedFileName(payload.fileName);
    } catch (error) {
      setResumeUploadedFileName("");
      setResumeText("");
      setSimulatorError(error instanceof Error ? error.message : "Unable to extract resume text.");
    } finally {
      setResumeFileUploading(false);
    }
  };

  const handleUploadJdFile = async (file: File | null) => {
    if (!file) return;
    setSimulatorError("");
    setJdFileUploading(true);
    try {
      const payload = await extractTextFromUpload(file, "jd");
      setJobDescription(payload.text);
      setJdUploadedFileName(payload.fileName);
    } catch (error) {
      setJdUploadedFileName("");
      setJobDescription("");
      setSimulatorError(error instanceof Error ? error.message : "Unable to extract JD text.");
    } finally {
      setJdFileUploading(false);
    }
  };

  const resetSimulationState = () => {
    stopQuestionAudioPlayback();
    clearPrefetchedQuestionAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    clearAutoListenTimeout();
    clearAutoSubmitTimeout();
    keepListeningRef.current = false;
    interimTranscriptRef.current = "";
    speechBaseAnswerRef.current = "";
    speechFinalTranscriptRef.current = "";
    pendingVoiceAutoSubmitRef.current = "";
    questionPlaybackAutoListenRef.current = false;
    setSessionId("");
    setSessionSecret("");
    setCurrentQuestion("");
    setRoundNumber(0);
    setCurrentStageLabel("Screening");
    setQuestionNumberInStage(1);
    setTotalRounds(0);
    setProgressPercent(0);
    setTurnHistory([]);
    setReport(null);
    setAnswerText("");
    setAnswerTimerSeconds(0);
    setFocusSkills([]);
    setInterviewerTitle("Lead Interviewer");
    setInterviewerVoice(DEFAULT_AI_INTERVIEWER_VOICE);
    setOpeningRemark("");
    setInterviewerBridge("");
    setClosingRemark("");
    setSavedDashboardReportId(null);
    setScreeningDecision("");
    setScreeningDecisionReason("");
    setPendingRoundStart(null);
    setRoundQuestionText("");
    setRoundQuestionReply("");
    setInterimTranscript("");
    setTtsLoading(false);
    setPrejoinModalOpen(false);
    setRoomStage("not_started");
    setInterviewerJoined(false);
    setJoinLoading(false);
    setIsListening(false);
    autoSpokenQuestionRef.current = "";
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  };

  const handleStartSimulator = async () => {
    if (!authResolved) {
      setSimulatorError("Checking account session. Please retry in a moment.");
      return;
    }
    if (candidateName.trim().length < 2) {
      setSimulatorError("Enter your name before starting the interview.");
      return;
    }
    if (role.trim().length < 2) {
      setSimulatorError("Enter a target role before starting.");
      return;
    }
    if (setupRequiresResumeAndJd && !hasResumeContext) {
      setSimulatorError("Upload or paste your resume before starting.");
      return;
    }
    if (setupRequiresResumeAndJd && !hasJobDescriptionContext) {
      setSimulatorError("Upload or paste the JD before starting.");
      return;
    }

    setSimulatorError("");
    stopQuestionAudioPlayback();
    clearPrefetchedQuestionAudio();
    autoSpokenQuestionRef.current = "";
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setRoomStage("not_started");
    setInterviewerJoined(false);
    setJoinLoading(false);
    setStartLoading(true);
    setSubmitLoading(false);
    setPendingRoundStart(null);
    setRoundQuestionText("");
    setRoundQuestionReply("");
    const startedAt = Date.now();
    try {
      const payload = await fetchJsonWithWakeAndRetry<SimulatorStartPayload>({
        apiUrl: simulatorApiUrl,
        path: "/analysis/interview-simulator/start",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authHeader || {}),
          },
          body: JSON.stringify({
            candidate_name: candidateName.trim(),
            role: role.trim(),
            industry: industry.trim() || "General",
            difficulty,
            mode: simulatorMode,
            resume_text: resumeText.trim(),
            job_description: jobDescription.trim(),
            auth_token: authToken || undefined,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "Simulator initialization is taking longer than expected. Please retry.",
      });

      const elapsed = Date.now() - startedAt;
      if (elapsed < SIMULATOR_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, SIMULATOR_MIN_LOADING_MS - elapsed));
      }

      setSessionId(payload.session_id);
      setSessionSecret(payload.session_secret || "");
      setSimulatorMode(normalizeSimulatorMode(payload.mode));
      setCandidateName(payload.candidate_name || candidateName.trim());
      setInterviewerName(payload.interviewer_name || "Avery Bennett");
      setInterviewerTitle(payload.interviewer_title || "Lead Interviewer");
      setInterviewerVoice(payload.interviewer_voice || DEFAULT_AI_INTERVIEWER_VOICE);
      setOpeningRemark(payload.opening_remark || "");
      setInterviewerBridge("");
      setClosingRemark(payload.closing_remark || "");
      setSavedDashboardReportId(null);
      setScreeningDecision("");
      setScreeningDecisionReason("");
      setGuestFreeInterviewsRemaining(payload.guest_free_interviews_remaining ?? null);
      setCurrentQuestion(payload.current_question || "");
      setRoundNumber(payload.round_number || 1);
      setCurrentStageLabel(payload.current_stage_label || "Screening");
      setQuestionNumberInStage(payload.question_number_in_stage || 1);
      setTotalRounds(payload.total_rounds || 4);
      setProgressPercent(payload.progress_percent || 0);
      setPendingRoundStart(null);
      setRoundQuestionText("");
      setRoundQuestionReply("");
      setFocusSkills(sanitizeFocusSkillsForDisplay(payload.focus_skills || []));
      setTurnHistory([]);
      setReport(null);
      setAnswerText("");
      setAnswerTimerSeconds(0);
      speechBaseAnswerRef.current = "";
      speechFinalTranscriptRef.current = "";
      setRoomStage("ready_to_join");
      setPrejoinModalOpen(true);
      setInterviewerJoined(false);
      setSetupExpanded(false);
      storeSessionRef(payload.session_id, payload.session_secret || "", "ready_to_join");
      trackEvent("interview_simulator_start", {
        role: role.trim(),
        difficulty,
        mode: normalizeSimulatorMode(payload.mode),
        rounds: payload.total_rounds || 4,
      });
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < SIMULATOR_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, SIMULATOR_MIN_LOADING_MS - elapsed));
      }
      const message = error instanceof Error ? error.message : "Unable to start simulator right now.";
      if (!authToken && /free guest interview|already used/i.test(message)) {
        setGuestFreeInterviewsRemaining(0);
      }
      setSimulatorError(message);
    } finally {
      setStartLoading(false);
    }
  };

  const handleSubmitAnswer = async ({
    overrideAnswer,
    initiatedByVoice = false,
  }: {
    overrideAnswer?: string;
    initiatedByVoice?: boolean;
  } = {}) => {
    if (!sessionId || !sessionSecret) {
      setSimulatorError("Start a simulator session first.");
      return;
    }
    if (pendingRoundStart) {
      setSimulatorError(`Round ${pendingRoundStart.completedRoundNumber} is complete. Start the next round to continue.`);
      return;
    }
    clearAutoListenTimeout();
    clearAutoSubmitTimeout();
    const preparedAnswer = normalizeSpeechText(
      overrideAnswer || (isListening ? composeSpeechAnswer(answerText, speechFinalTranscriptRef.current, interimTranscriptRef.current) : answerText.trim())
    );
    if (isListening && !initiatedByVoice) {
      stopVoiceCapture();
      setAnswerText(preparedAnswer);
    }
    if (preparedAnswer.trim().length < 18) {
      setSimulatorError("Answer is too short. Add more context before submitting.");
      return;
    }

    setSimulatorError("");
    setSubmitLoading(true);
    const startedAt = Date.now();
    try {
      const payload = await fetchJsonWithWakeAndRetry<SimulatorTurnPayload>({
        apiUrl: simulatorApiUrl,
        path: "/analysis/interview-simulator/turn",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authHeader || {}),
          },
          body: JSON.stringify({
            session_id: sessionId,
            session_secret: sessionSecret,
            answer_text: preparedAnswer.trim(),
            response_time_seconds: answerTimerSeconds,
            auth_token: authToken || undefined,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
        abortErrorMessage: "AI scoring is taking longer than expected. Please retry.",
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < SIMULATOR_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, SIMULATOR_MIN_LOADING_MS - elapsed));
      }
      setSimulatorMode(normalizeSimulatorMode(payload.mode));

      const nextTurnHistory = payload.turn_feedback ? [...turnHistory, payload.turn_feedback as SimulatorTurnFeedback] : turnHistory;
      if (payload.turn_feedback) {
        setTurnHistory(nextTurnHistory);
      }
      const nextScreeningDecision = payload.screening_decision || payload.turn_feedback?.screening_decision || screeningDecision;
      const nextScreeningDecisionReason = payload.screening_decision_reason || payload.turn_feedback?.screening_decision_reason || screeningDecisionReason;
      setScreeningDecision(nextScreeningDecision);
      setScreeningDecisionReason(nextScreeningDecisionReason);
      setRoundNumber(payload.round_number || roundNumber);
      setCurrentStageLabel(payload.current_stage_label || payload.turn_feedback?.stage_label || currentStageLabel);
      setQuestionNumberInStage(payload.question_number_in_stage || questionNumberInStage);
      setTotalRounds(payload.total_rounds || totalRounds);
      setProgressPercent(payload.progress_percent || progressPercent);
      setAnswerText("");
      setAnswerTimerSeconds(0);
      setInterimTranscript("");
      speechBaseAnswerRef.current = "";
      speechFinalTranscriptRef.current = "";
      pendingVoiceAutoSubmitRef.current = "";

      if (payload.completed) {
        setPendingRoundStart(null);
        setRoundQuestionText("");
        setRoundQuestionReply("");
        stopQuestionAudioPlayback();
        clearPrefetchedQuestionAudio();
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
        keepListeningRef.current = false;
        interimTranscriptRef.current = "";
        speechBaseAnswerRef.current = "";
        speechFinalTranscriptRef.current = "";
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch {}
        }
        const farewell =
          payload.closing_remark?.trim() ||
          `Thanks for joining today, ${candidateName || "there"}. Your interview report is ready below.`;
        setCurrentQuestion("");
        setInterviewerBridge("");
        setReport(payload.report || null);
        setInterviewerTitle(payload.interviewer_title || interviewerTitle);
        setInterviewerVoice(payload.interviewer_voice || interviewerVoice);
        setClosingRemark(farewell);
        setSavedDashboardReportId(payload.saved_report_id ?? null);
        setScreeningDecision(payload.screening_decision || payload.report?.screening_decision || screeningDecision);
        setScreeningDecisionReason(payload.screening_decision_reason || payload.report?.screening_decision_reason || screeningDecisionReason);
        setPrejoinModalOpen(false);
        setRoomStage("ended");
        setInterviewerJoined(false);
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        void speakCurrentQuestion({
          force: true,
          silentErrors: true,
          trigger: "auto",
          overrideText: farewell,
        });
        trackEvent("interview_simulator_complete", {
          rounds_completed: payload.report?.rounds_completed || payload.round_number || 0,
          score: clampPercent(payload.report?.overall_score || 0),
        });
      } else {
        const answeredStageKey = (payload.turn_feedback?.stage_key || "").trim().toLowerCase();
        const nextStageKey = (payload.current_stage_key || "").trim().toLowerCase();
        const normalizedRoundDecision = (payload.round_decision || "").trim().toLowerCase();
        const stageTransitionDetected =
          Boolean(payload.next_question) &&
          Boolean(answeredStageKey) &&
          Boolean(nextStageKey) &&
          normalizedRoundDecision === "shortlisted" &&
          answeredStageKey !== nextStageKey &&
          (payload.question_number_in_stage || 1) <= 1;

        if (stageTransitionDetected) {
          const completedStageTurns = nextTurnHistory.filter(
            (turn) => (turn.stage_key || "").trim().toLowerCase() === answeredStageKey
          );
          const completedStageAverageScore =
            completedStageTurns.length > 0
              ? completedStageTurns.reduce((total, turn) => total + (turn.scores?.overall || 0), 0) / completedStageTurns.length
              : payload.turn_feedback?.scores?.overall || 0;
          const completedRoundNumber = payload.turn_feedback?.round_number || roundNumber || 1;
          const completedStageLabel = payload.turn_feedback?.stage_label || currentStageLabel || "Round";
          const completedStageDecision =
            normalizedRoundDecision === "shortlisted"
              ? "shortlisted"
              : normalizedRoundDecision === "rejected"
                ? "rejected"
                : "pending";
          const stageDecisionLabel =
            completedStageDecision === "shortlisted"
              ? `${formatRoundLabel(completedRoundNumber, completedStageLabel)} complete: Shortlisted`
              : completedStageDecision === "rejected"
                ? `${formatRoundLabel(completedRoundNumber, completedStageLabel)} complete: Not shortlisted`
                : `${formatRoundLabel(completedRoundNumber, completedStageLabel)} completed`;
          const stageDecisionReason =
            completedStageDecision === "shortlisted"
              ? payload.round_decision_reason ||
                `You can view your round-${completedRoundNumber} performance now. Join round ${payload.round_number || completedRoundNumber + 1} when ready.`
              : completedStageDecision === "rejected"
                ? payload.round_decision_reason ||
                  "You can view your results now. Further rounds are closed for this interview."
                : payload.round_decision_reason || payload.turn_feedback?.feedback_summary || "This round has been evaluated.";
          setRoundQuestionText("");
          setRoundQuestionReply("");
          setPendingRoundStart({
            completedRoundNumber,
            completedStageLabel,
            completedStageKey: answeredStageKey,
            completedStageDecision,
            completedStageAverageScore,
            completedStageQuestionCount: Math.max(1, completedStageTurns.length || (payload.turn_feedback ? 1 : 0)),
            stageDecisionLabel,
            stageDecisionReason,
            nextRoundNumber: payload.round_number || completedRoundNumber + 1,
            nextStageLabel: payload.current_stage_label || "Next Round",
            nextQuestion: payload.next_question || "",
            nextInterviewerBridge: payload.interviewer_bridge || payload.turn_feedback?.interviewer_bridge || "",
          });
          setCurrentQuestion("");
          setInterviewerBridge("");
          setRoundNumber(completedRoundNumber);
          setCurrentStageLabel(completedStageLabel);
          setQuestionNumberInStage(payload.turn_feedback?.question_number_in_stage || 1);
        } else {
          setPendingRoundStart(null);
          setRoundQuestionText("");
          setRoundQuestionReply("");
          setCurrentQuestion(payload.next_question || "");
          setInterviewerBridge(payload.interviewer_bridge || payload.turn_feedback?.interviewer_bridge || "");
        }
        if (roomStage === "live") {
          setInterviewerJoined(true);
        }
      }
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < SIMULATOR_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, SIMULATOR_MIN_LOADING_MS - elapsed));
      }
      setSimulatorError(error instanceof Error ? error.message : "Unable to submit answer right now.");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleStartNextRound = () => {
    if (!pendingRoundStart) return;
    if (pendingRoundStart.completedStageDecision !== "shortlisted") {
      setSimulatorError("This round was not shortlisted. The interview is complete.");
      return;
    }
    setSimulatorError("");
    setRoundNumber(pendingRoundStart.nextRoundNumber);
    setCurrentStageLabel(pendingRoundStart.nextStageLabel || "Round");
    setQuestionNumberInStage(1);
    setCurrentQuestion(pendingRoundStart.nextQuestion || "");
    setInterviewerBridge(pendingRoundStart.nextInterviewerBridge || "");
    setPendingRoundStart(null);
    setRoundQuestionText("");
    setRoundQuestionReply("");
    stopQuestionAudioPlayback();
    clearPrefetchedQuestionAudio();
    setPrejoinModalOpen(true);
    setRoomStage("ready_to_join");
    setInterviewerJoined(false);
    if (sessionId && sessionSecret) {
      storeSessionRef(sessionId, sessionSecret, "ready_to_join");
    }
  };

  const handleRefreshReport = async () => {
    if (!sessionId || !sessionSecret) return;
    setLoadingReport(true);
    try {
      const payload = await fetchJsonWithWakeAndRetry<SimulatorReportPayload>({
        apiUrl: simulatorApiUrl,
        path: "/analysis/interview-simulator/report",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authHeader || {}),
          },
          body: JSON.stringify({
            session_id: sessionId,
            session_secret: sessionSecret,
            auth_token: authToken || undefined,
          }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: parseApiError,
      });
      setTurnHistory(payload.turns || []);
      setFocusSkills(sanitizeFocusSkillsForDisplay(payload.focus_skills || []));
      setCurrentQuestion(payload.current_question || "");
      setRoundNumber(payload.round_number || roundNumber);
      setCurrentStageLabel(payload.current_stage_label || currentStageLabel);
      setQuestionNumberInStage(payload.question_number_in_stage || questionNumberInStage);
      setTotalRounds(payload.total_rounds || 0);
      setCandidateName(payload.candidate_name || candidateName);
      setInterviewerName(payload.interviewer_name || interviewerName);
      setInterviewerTitle(payload.interviewer_title || interviewerTitle);
      setInterviewerVoice(payload.interviewer_voice || interviewerVoice);
      setOpeningRemark(payload.opening_remark || openingRemark);
      const previousTurn = payload.turns && payload.turns.length > 0 ? payload.turns[payload.turns.length - 1] : null;
      setInterviewerBridge(previousTurn?.interviewer_bridge || "");
      setClosingRemark(payload.closing_remark || closingRemark);
      setSavedDashboardReportId(payload.saved_report_id ?? null);
      setScreeningDecision(payload.screening_decision || payload.report?.screening_decision || "");
      setScreeningDecisionReason(payload.screening_decision_reason || payload.report?.screening_decision_reason || "");
      setSimulatorMode(normalizeSimulatorMode(payload.mode || payload.report?.mode));
      setPendingRoundStart(null);
      setRoundQuestionText("");
      setRoundQuestionReply("");
      if (payload.status === "completed") {
        stopQuestionAudioPlayback();
        clearPrefetchedQuestionAudio();
        setReport(payload.report || null);
        setCurrentQuestion("");
        setInterviewerBridge("");
        setRoundNumber(payload.report?.rounds_completed || payload.round_number || roundNumber);
        setCurrentStageLabel(payload.current_stage_label || previousTurn?.stage_label || "Completed");
        setQuestionNumberInStage(payload.question_number_in_stage || previousTurn?.question_number_in_stage || 0);
        setAnswerText("");
        setInterimTranscript("");
        speechBaseAnswerRef.current = "";
        speechFinalTranscriptRef.current = "";
        setProgressPercent(100);
        setPrejoinModalOpen(false);
        setRoomStage("ended");
        setInterviewerJoined(false);
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (error) {
      setSimulatorError(error instanceof Error ? error.message : "Unable to refresh report.");
    } finally {
      setLoadingReport(false);
    }
  };

  const startVoiceCapture = async ({ autoStart = false }: { autoStart?: boolean } = {}) => {
    if (!speechSupported) {
      if (!autoStart) setSimulatorError("Speech recognition is not supported in this browser.");
      return;
    }
    if (isListening) return;
    if (!sessionId || report) {
      if (!autoStart) setSimulatorError("Start a live interview round before using mic capture.");
      return;
    }
    if (pendingRoundStart) {
      if (!autoStart) setSimulatorError("Start the next round before turning on the mic.");
      return;
    }
    if (roomStage !== "live") {
      if (!autoStart) setSimulatorError("Join the interview room before using mic capture.");
      return;
    }
    if (isQuestionAudioPlaying) {
      if (!autoStart) setSimulatorError("Wait until the interviewer finishes speaking before turning on the mic.");
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setSimulatorError("Mic capture requires HTTPS secure context.");
      return;
    }
    clearAutoListenTimeout();
    clearAutoSubmitTimeout();
    setSimulatorError("");
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setSpeechSupported(false);
      if (!autoStart) setSimulatorError("Speech recognition is unavailable.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      if (!autoStart) setSimulatorError("Microphone access is not supported in this browser.");
      return;
    }
    try {
      const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      testStream.getTracks().forEach((track) => track.stop());
    } catch {
      setSimulatorError("Microphone permission denied. Allow mic access and retry.");
      return;
    }

    const recognition = recognitionRef.current || new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let finalChunk = "";
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index]?.[0]?.transcript || "";
        if (event.results[index]?.isFinal) {
          finalChunk += `${transcript} `;
        } else {
          interim += `${transcript} `;
        }
      }
      if (finalChunk.trim()) {
        speechFinalTranscriptRef.current = normalizeSpeechText(`${speechFinalTranscriptRef.current} ${finalChunk}`);
      }
      interimTranscriptRef.current = normalizeSpeechText(interim);
      setInterimTranscript(interimTranscriptRef.current);
      const composedAnswer = composeSpeechAnswer(speechBaseAnswerRef.current, speechFinalTranscriptRef.current, interimTranscriptRef.current);
      setAnswerText(composedAnswer);
      if (interimTranscriptRef.current) {
        clearAutoSubmitTimeout();
        return;
      }
      if (speechFinalTranscriptRef.current && composedAnswer.length >= 18 && roomStage === "live" && !submitLoading && !report && !pendingRoundStart) {
        clearAutoSubmitTimeout();
        autoSubmitTimeoutRef.current = window.setTimeout(() => {
          const nextAnswer = normalizeSpeechText(
            composeSpeechAnswer(speechBaseAnswerRef.current, speechFinalTranscriptRef.current, interimTranscriptRef.current)
          );
          if (nextAnswer.length < 18 || roomStage !== "live" || Boolean(report) || submitLoading || Boolean(pendingRoundStart)) return;
          pendingVoiceAutoSubmitRef.current = nextAnswer;
          keepListeningRef.current = false;
          try {
            recognition.stop();
          } catch {
            pendingVoiceAutoSubmitRef.current = "";
            void handleSubmitAnswer({ overrideAnswer: nextAnswer, initiatedByVoice: true });
          }
        }, AUTO_SUBMIT_SILENCE_MS);
      }
    };
    recognition.onend = () => {
      clearAutoSubmitTimeout();
      const composedAnswer = composeSpeechAnswer(speechBaseAnswerRef.current, speechFinalTranscriptRef.current, interimTranscriptRef.current);
      const pendingVoiceAnswer = normalizeSpeechText(pendingVoiceAutoSubmitRef.current || composedAnswer);
      if (keepListeningRef.current) {
        try {
          recognition.start();
          return;
        } catch {}
      }
      setAnswerText(composedAnswer);
      interimTranscriptRef.current = "";
      setInterimTranscript("");
      speechBaseAnswerRef.current = "";
      speechFinalTranscriptRef.current = "";
      setIsListening(false);
      if (pendingVoiceAutoSubmitRef.current && pendingVoiceAnswer.length >= 18 && roomStage === "live" && !report && !pendingRoundStart) {
        pendingVoiceAutoSubmitRef.current = "";
        void handleSubmitAnswer({ overrideAnswer: pendingVoiceAnswer, initiatedByVoice: true });
        return;
      }
      pendingVoiceAutoSubmitRef.current = "";
    };
    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const errorCode = (event?.error || "").toLowerCase();
      const composedAnswer = normalizeSpeechText(
        composeSpeechAnswer(speechBaseAnswerRef.current, speechFinalTranscriptRef.current, interimTranscriptRef.current)
      );
      clearAutoSubmitTimeout();
      if (errorCode === "not-allowed" || errorCode === "service-not-allowed" || errorCode === "audio-capture") {
        keepListeningRef.current = false;
        setSimulatorError("Mic capture blocked. Check browser microphone permissions.");
      } else if (errorCode === "no-speech" && composedAnswer.length >= 18 && roomStage === "live" && !report && !pendingRoundStart) {
        pendingVoiceAutoSubmitRef.current = composedAnswer;
        keepListeningRef.current = false;
        try {
          recognition.stop();
          return;
        } catch {
          pendingVoiceAutoSubmitRef.current = "";
          void handleSubmitAnswer({ overrideAnswer: composedAnswer, initiatedByVoice: true });
          return;
        }
      } else if (errorCode && errorCode !== "aborted" && errorCode !== "no-speech") {
        setSimulatorError(`Mic capture error: ${errorCode}. Try again.`);
      } else if (errorCode === "no-speech") {
        setSimulatorError("No speech detected. Speak closer to mic and retry.");
      }
      pendingVoiceAutoSubmitRef.current = "";
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    keepListeningRef.current = true;
    speechBaseAnswerRef.current = answerText.trim();
    speechFinalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setInterimTranscript("");
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      keepListeningRef.current = false;
      setIsListening(false);
      setSimulatorError("Unable to start microphone capture right now.");
    }
  };

  const stopVoiceCapture = () => {
    clearAutoSubmitTimeout();
    pendingVoiceAutoSubmitRef.current = "";
    setAnswerText(composeSpeechAnswer(speechBaseAnswerRef.current, speechFinalTranscriptRef.current, interimTranscriptRef.current));
    interimTranscriptRef.current = "";
    keepListeningRef.current = false;
    speechBaseAnswerRef.current = "";
    speechFinalTranscriptRef.current = "";
    if (!recognitionRef.current) {
      setIsListening(false);
      setInterimTranscript("");
      return;
    }
    try {
      recognitionRef.current.stop();
    } catch {}
    setIsListening(false);
    setInterimTranscript("");
  };

  const handleJoinInterviewRoom = async () => {
    if (!sessionId || (!currentQuestion && !pendingRoundStart?.nextQuestion) || report) {
      setSimulatorError("Start an interview session first.");
      return;
    }
    if (roomStage === "live" || joinLoading) return;

    setSimulatorError("");
    setJoinLoading(true);
    setPrejoinModalOpen(false);
    setRoomStage("joining");
    setInterviewerJoined(false);
    try {
      await playMeetingJoinChime();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 950));
      setInterviewerJoined(true);
      setRoomStage("live");
      storeSessionRef(sessionId, sessionSecret, "live");
      trackEvent("interview_simulator_room_join", {
        round_number: roundNumber || 1,
      });
    } catch {
      setSimulatorError("Unable to join the interview room right now.");
      setPrejoinModalOpen(true);
      setRoomStage("ready_to_join");
    } finally {
      setJoinLoading(false);
    }
  };

  const speakCurrentQuestion = async ({
    force = false,
    silentErrors = false,
    trigger = "manual",
    overrideText,
  }: {
    force?: boolean;
    silentErrors?: boolean;
    trigger?: "manual" | "auto";
    overrideText?: string;
  } = {}) => {
    const questionText = normalizeSpeechText(overrideText || spokenQuestionText);
    const shouldAutoListenAfterPlayback = !overrideText && roomStage === "live" && !report;
    if (!questionText) return;

    if (isQuestionAudioPlaying && !force) {
      stopQuestionAudioPlayback();
      return;
    }

    if (!silentErrors) {
      setSimulatorError("");
    }
    setTtsLoading(true);
    if (isListening) {
      stopVoiceCapture();
    }
    clearAutoListenTimeout();
    stopQuestionAudioPlayback();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    try {
      const prefetchKey = `${sessionId}:${roundNumber}:${questionText}`;
      let payload:
        | {
            blob: Blob;
            modelLabel: string;
            voiceLabel: string;
          }
        | undefined;

      if (prefetchedQuestionAudioRef.current?.key === prefetchKey) {
        payload = {
          blob: prefetchedQuestionAudioRef.current.blob,
          modelLabel: prefetchedQuestionAudioRef.current.modelLabel,
          voiceLabel: prefetchedQuestionAudioRef.current.voiceLabel,
        };
      } else if (prefetchingQuestionKeyRef.current === prefetchKey && prefetchedQuestionAudioPromiseRef.current) {
        const prefetched = await prefetchedQuestionAudioPromiseRef.current;
        if (prefetched?.key === prefetchKey) {
          payload = {
            blob: prefetched.blob,
            modelLabel: prefetched.modelLabel,
            voiceLabel: prefetched.voiceLabel,
          };
        }
      }

      if (!payload) {
        let fetchError: unknown;
        for (let attempt = 0; attempt < 2 && !payload; attempt += 1) {
          const controller = new AbortController();
          questionAudioAbortRef.current = controller;
          const timeoutHandle = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
          try {
            payload = await fetchAiQuestionAudio(questionText, controller.signal);
          } catch (error) {
            fetchError = error;
            if (controller.signal.aborted || attempt >= 1) {
              throw error;
            }
            await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
          } finally {
            window.clearTimeout(timeoutHandle);
            questionAudioAbortRef.current = null;
          }
        }
        if (!payload && fetchError) {
          throw fetchError;
        }
      } else {
        questionAudioAbortRef.current = null;
      }
      if (!payload) {
        throw new Error("ai_audio_empty");
      }

      const audioUrl = URL.createObjectURL(payload.blob);
      questionAudioUrlRef.current = audioUrl;
      const audio = new Audio(audioUrl);
      let playbackSettled = false;
      const finalizePlayback = () => {
        if (playbackSettled) return;
        playbackSettled = true;
        if (questionAudioRef.current === audio) {
          questionAudioRef.current = null;
        }
        if (questionAudioUrlRef.current === audioUrl) {
          URL.revokeObjectURL(audioUrl);
          questionAudioUrlRef.current = "";
        }
        setIsQuestionAudioPlaying(false);
        const autoListenAfterPlayback = questionPlaybackAutoListenRef.current;
        questionPlaybackAutoListenRef.current = false;
        if (autoListenAfterPlayback) {
          scheduleAutomaticVoiceCapture();
        }
      };
      audio.preload = "auto";
      questionPlaybackAutoListenRef.current = shouldAutoListenAfterPlayback;
      audio.onended = finalizePlayback;
      audio.onpause = finalizePlayback;
      questionAudioRef.current = audio;
      await audio.play();
      setIsQuestionAudioPlaying(true);
      if (trigger === "manual") {
        trackEvent("interview_simulator_question_audio_play", {
          round_number: roundNumber,
          source: prefetchedQuestionAudioRef.current?.key === prefetchKey ? "prefetch" : "live",
        });
      }
    } catch (error) {
      questionAudioAbortRef.current = null;
      if (questionAudioRef.current) {
        questionAudioRef.current = null;
      }
      if (questionAudioUrlRef.current) {
        URL.revokeObjectURL(questionAudioUrlRef.current);
        questionAudioUrlRef.current = "";
      }
      try {
        await playBrowserSpeechFallback(questionText, shouldAutoListenAfterPlayback);
        if (!silentErrors) {
          setSimulatorError("AI voice unavailable right now. Using browser voice fallback.");
        }
      } catch {
        if (!silentErrors) {
          const errorMessage = error instanceof Error ? error.message : "Unable to play question audio.";
          setSimulatorError(errorMessage || "Unable to play question audio.");
        }
      }
    } finally {
      setTtsLoading(false);
    }
  };

  const toggleCameraPreview = async () => {
    if (cameraEnabled) {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      mediaStreamRef.current = null;
      if (prejoinVideoRef.current) prejoinVideoRef.current.srcObject = null;
      if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
      setCameraEnabled(false);
      setCameraError("");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      mediaStreamRef.current = stream;
      if (prejoinVideoRef.current) {
        prejoinVideoRef.current.srcObject = stream;
        await prejoinVideoRef.current.play().catch(() => undefined);
      }
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play().catch(() => undefined);
      }
      setCameraEnabled(true);
      setCameraError("");
    } catch {
      setCameraEnabled(false);
      setCameraError("Camera permission denied or unavailable.");
    }
  };

  const downloadSimulatorReport = () => {
    if (!report) return;
    const lines = [
      "HireScore Live Interview Simulator Report",
      `Generated At: ${new Date().toLocaleString()}`,
      `Candidate: ${candidateName || "Candidate"}`,
      `Interviewer: ${interviewerName || "Avery Bennett"}`,
      `Role: ${role || "Target role"}`,
      `Industry: ${industry || "General"}`,
      `Difficulty: ${difficulty}`,
      `Overall Score: ${clampPercent(report.overall_score)}%`,
      `Readiness: ${(report.readiness_label || "medium").toUpperCase()}`,
      "",
      "Score Breakdown:",
      `- Communication: ${clampPercent(report.score_breakdown.communication)}%`,
      `- Clarity: ${clampPercent(report.score_breakdown.clarity)}%`,
      `- Domain Depth: ${clampPercent(report.score_breakdown.domain_depth)}%`,
      `- Confidence: ${clampPercent(report.score_breakdown.confidence)}%`,
      "",
      "Strength Signals:",
      ...(report.strength_signals || []).map((item) => `- ${item}`),
      "",
      "Improvement Signals:",
      ...(report.improvement_signals || []).map((item) => `- ${item}`),
      "",
      "Next Steps:",
      ...(report.next_steps || []).map((item, index) => `${index + 1}. ${item}`),
      "",
      "Round Summary:",
      ...((report.stage_summaries || []).flatMap((item) => [
        `- ${formatRoundLabel(item.stage_number, item.stage_label)} | Questions: ${item.question_count} | Average Score: ${clampPercent(item.average_score)}%`,
      ])),
      "",
      "Turn-by-Turn Feedback:",
      ...turnHistory.flatMap((turn) => [
        `${formatRoundLabel(turn.round_number, turn.stage_label || "Round")} | Question ${turn.question_number_in_stage || 1}: ${turn.question}`,
        `Answer Time: ${turn.response_time_seconds}s | Words: ${turn.answer_word_count}`,
        `Scores: Communication ${turn.scores.communication}% | Clarity ${turn.scores.clarity}% | Domain ${turn.scores.domain_depth}% | Confidence ${turn.scores.confidence}%`,
        `Summary: ${turn.feedback_summary}`,
        `Strengths: ${(turn.strengths || []).join("; ")}`,
        `Improvements: ${(turn.improvements || []).join("; ")}`,
        "",
      ]),
      closingRemark ? `Closing Note: ${closingRemark}` : "",
    ];
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `interview-simulator-report-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const hasRequiredSessionContext = isDemoMode || (hasResumeContext && hasJobDescriptionContext);
  const canStartSession =
    hasCandidateName &&
    hasTargetRole &&
    hasRequiredSessionContext &&
    !startLoading &&
    !submitLoading &&
    !resumeFileUploading &&
    !jdFileUploading;
  const startButtonLiveState = canStartSession && !startLoading;
  const setupMissingRequirements = [
    hasCandidateName ? "" : "Name",
    hasTargetRole ? "" : "Target role",
    isDemoMode || hasResumeContext ? "" : "Resume",
    isDemoMode || hasJobDescriptionContext ? "" : "JD",
  ].filter(Boolean);
  const setupReadinessLabel =
    setupMissingRequirements.length > 0
      ? `Required before start: ${setupMissingRequirements.join(", ")}`
      : isDemoMode
        ? "Demo setup complete. You can start the 90-second interview now."
        : "Setup complete. You can start the interview now.";
  const canSubmitAnswer =
    Boolean(sessionId) &&
    Boolean(sessionSecret) &&
    roomStage === "live" &&
    (isListening || answerText.trim().length >= 18) &&
    !startLoading &&
    !submitLoading &&
    !report &&
    !joinLoading &&
    !pendingRoundStart;
  const joinButtonDisabled = !sessionId || Boolean(report) || roomStage === "live" || joinLoading || startLoading;
  const joinButtonLabel = !sessionId
    ? "Start Interview First"
    : roomStage === "live"
      ? "Interview Live"
      : joinLoading
        ? "Joining..."
        : "Join Interview";
  const interviewOverlayActive = (prejoinModalOpen || roomStage === "joining" || roomStage === "live") && !report;
  const showPrejoinOverlay = prejoinModalOpen && roomStage !== "joining" && roomStage !== "live" && !report;
  const reportArchiveNote = savedDashboardReportId
    ? "Saved to your dashboard archive."
    : report
      ? authToken
        ? "Report ready. Dashboard save is pending confirmation."
        : "Sign in before your next run to archive reports to the dashboard."
      : authToken
        ? "Completed interview reports save automatically to your dashboard."
        : "Sign in to archive completed interview reports.";
  const guestInterviewNote = authToken
    ? "Signed-in mode keeps unlimited simulator runs and auto-saves every completed report to dashboard."
    : isDemoMode
      ? "90-second demo is always free. Full adaptive simulation remains 1 free run without login."
      : guestFreeInterviewsRemaining === 0
        ? "Your 1 free guest interview is used. Sign in to continue and keep reports in dashboard."
        : "1 full interview simulation is free without login.";
  const interviewerRoomStatus =
    roomStage === "live"
      ? pendingRoundStart
        ? `${formatRoundLabel(pendingRoundStart.completedRoundNumber, pendingRoundStart.completedStageLabel)} finished. Check your result and join the next round if shortlisted.`
        : interviewerJoined && isQuestionAudioPlaying
          ? `${interviewerName} is asking the next question.`
          : `${interviewerName} is listening to your answer.`
      : roomStage === "joining"
        ? `${interviewerName} is joining the room.`
        : roomStage === "ended"
          ? "Interview room closed. Report generated."
          : "Preview the room, then join when you are ready.";
  const setupChips = [
    candidateName ? `Candidate: ${candidateName}` : "",
    role ? `Role: ${role}` : "",
    `Industry: ${industry || "General"}`,
    `Difficulty: ${difficulty}`,
    isDemoMode ? "Mode: 90-second demo" : "Mode: Full simulation",
    isDemoMode ? "Screening preview flow" : "Adaptive 4-round flow",
  ].filter(Boolean);
  const pendingRoundStartCtaLabel = pendingRoundStart
    ? pendingRoundStart.completedStageDecision === "shortlisted"
      ? /hr/i.test(pendingRoundStart.nextStageLabel || "")
        ? "Join Final Round (HR)"
        : `Join Round ${pendingRoundStart.nextRoundNumber}: ${pendingRoundStart.nextStageLabel}`
      : "Round Closed"
    : "";
  const pendingRoundFollowUpMessage = pendingRoundStart
    ? pendingRoundStart.completedStageDecision === "shortlisted"
      ? `You are shortlisted. Review your round-${pendingRoundStart.completedRoundNumber} score below, then join ${formatRoundLabel(
          pendingRoundStart.nextRoundNumber,
          pendingRoundStart.nextStageLabel
        )}.`
      : "You can view your results now. Further rounds are closed for this interview."
    : "";
  const isFirstInterviewPrompt = roundNumber <= 1 && questionNumberInStage <= 1 && turnHistory.length === 0;
  const liveInterviewerIntro =
    isFirstInterviewPrompt
      ? openingRemark || `Hi ${candidateName || "there"}, good to meet you. I'm ${interviewerName}, ${interviewerTitle}, and I'll guide this interview one question at a time.`
      : interviewerBridge || `Thanks ${candidateName || "there"}. Let's continue.`;
  const reportFinalRoundDecision = useMemo(() => {
    if (!report?.round_decisions?.length) return "";
    const ordered = [...report.round_decisions].sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0));
    const last = ordered[ordered.length - 1];
    if (!last) return "";
    if (last.stage_key === "hr" && last.decision === "shortlisted") return "offer_ready";
    if (last.decision === "shortlisted") return "shortlisted";
    if (last.decision === "rejected") return "rejected";
    return "";
  }, [report]);
  const reportSessionMode = normalizeSimulatorMode(report?.mode || simulatorMode);

  useEffect(() => {
    if (!interviewOverlayActive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [interviewOverlayActive]);

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

      {interviewOverlayActive ? (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-[#020611]/58 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pt-[max(1.5rem,env(safe-area-inset-top))]">
          <div className="mx-auto flex min-h-full w-full max-w-[1480px] items-start justify-center">
            {showPrejoinOverlay ? (
              <div className="w-full max-w-4xl rounded-[2rem] border border-cyan-100/20 bg-[linear-gradient(160deg,rgba(6,18,34,0.97),rgba(4,12,24,0.98))] p-5 shadow-[0_26px_80px_rgba(2,8,22,0.6)] sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-cyan-100/10 bg-[#06152a]/94 px-3 py-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/72">Interview Preview</p>
                    <h2 className="mt-2 text-2xl font-semibold text-cyan-50 sm:text-3xl">Review the room before you join.</h2>
                    <p className="mt-2 max-w-2xl text-sm text-cyan-50/74">
                      {openingRemark || `${interviewerName} will greet ${candidateName || "you"} and begin the interview immediately after join.`}
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                    <div className="rounded-full border border-cyan-100/18 bg-cyan-100/8 px-3 py-1 text-[11px] text-cyan-100/76 break-all">{meetingRoomCode}</div>
                    <button
                      type="button"
                      onClick={() => void handleJoinInterviewRoom()}
                      disabled={joinButtonDisabled}
                      className="w-full rounded-full border border-emerald-200/36 bg-emerald-300/18 px-4 py-2 text-xs font-semibold text-emerald-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      {joinButtonLabel}
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <article className="relative overflow-hidden rounded-[1.6rem] border border-cyan-100/18 bg-[#030913]">
                    <p className="absolute left-4 top-4 z-10 rounded-full border border-cyan-100/20 bg-[#071627]/78 px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100/78">
                      You
                    </p>
                    <video
                      ref={prejoinVideoRef}
                      muted
                      playsInline
                      autoPlay
                      className={`h-[280px] w-full object-cover transition ${cameraEnabled ? "opacity-100" : "opacity-0"}`}
                    />
                    {!cameraEnabled ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.18),rgba(2,6,23,0.96))]">
                        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-cyan-100/18 bg-cyan-100/10 text-2xl font-semibold text-cyan-50">
                          {(candidateName || "You").slice(0, 1).toUpperCase()}
                        </div>
                        <p className="mt-3 text-sm text-cyan-50/80">{candidateName || "Candidate preview"}</p>
                        <p className="mt-1 text-xs text-cyan-100/70">Camera off</p>
                      </div>
                    ) : null}
                  </article>

                  <article className="relative overflow-hidden rounded-[1.6rem] border border-cyan-100/18 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),rgba(4,10,18,0.96))] p-6">
                    <p className="rounded-full border border-cyan-100/20 bg-[#071627]/78 px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100/78">
                      AI Interviewer
                    </p>
                    <div className="mt-10 flex flex-col items-center justify-center text-center">
                      <div className="flex h-24 w-24 items-center justify-center rounded-full border border-emerald-200/26 bg-emerald-200/12 text-3xl font-semibold text-emerald-50">
                        {interviewerName
                          .split(" ")
                          .map((part) => part.slice(0, 1).toUpperCase())
                          .join("")
                          .slice(0, 2)}
                      </div>
                      <h3 className="mt-4 text-2xl font-semibold text-cyan-50">{interviewerName}</h3>
                      <p className="mt-2 text-sm text-cyan-50/80">{interviewerTitle}</p>
                      <p className="mt-1 text-sm text-cyan-50/68">Role-specific interviewer for {role || "your target role"}</p>
                      <div className="mt-5 rounded-2xl border border-cyan-100/16 bg-[#071425]/70 p-4 text-left">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/66">Introduction</p>
                        <p className="mt-2 text-sm text-cyan-50/84">{liveInterviewerIntro}</p>
                        <p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-cyan-100/66">Opening Question</p>
                        <p className="mt-2 text-sm text-cyan-50/80">{currentQuestion || "Your first question will appear here."}</p>
                      </div>
                    </div>
                  </article>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border border-cyan-100/16 bg-[#071425]/72 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleCameraPreview()}
                      disabled={joinLoading}
                      className="w-full rounded-full border border-cyan-100/22 bg-cyan-100/10 px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/18 disabled:opacity-60 sm:w-auto"
                    >
                      {cameraEnabled ? "Camera Preview On" : "Enable Camera Preview"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPrejoinModalOpen(false);
                        setSetupExpanded(true);
                      }}
                      disabled={joinLoading}
                      className="w-full rounded-full border border-cyan-100/22 bg-transparent px-4 py-2 text-xs font-semibold text-cyan-50/84 transition hover:bg-cyan-100/10 disabled:opacity-60 sm:w-auto"
                    >
                      Edit Setup
                    </button>
                  </div>
                  <p className="text-[11px] text-cyan-100/68">Camera is local preview only for interview presence. It is not recorded.</p>
                </div>
              </div>
            ) : (
              <div className="w-full rounded-[2rem] border border-cyan-100/18 bg-[linear-gradient(160deg,rgba(6,18,34,0.98),rgba(4,12,24,0.99))] p-4 shadow-[0_30px_90px_rgba(2,8,22,0.68)] sm:p-6">
                <div className="grid gap-5">
                  <section className="space-y-5">
                    <article className="overflow-hidden rounded-[2rem] border border-cyan-100/18 bg-[#040911] shadow-[0_22px_60px_rgba(2,8,22,0.46)]">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-100/10 bg-[#07101b]/88 px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              roomStage === "live"
                                ? "bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.7)]"
                                : "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.7)]"
                            }`}
                          />
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/66">Interview Room</p>
                            <p className="text-sm text-cyan-50">{interviewerRoomStatus}</p>
                          </div>
                        </div>
                        <div className="text-right text-xs text-cyan-100/74">
                          <p>{roomStage === "live" ? formatRoomTime(roomClock) : "Connecting..."}</p>
                          <p className="mt-1">{meetingRoomCode}</p>
                        </div>
                      </div>

                      <div className="relative min-h-[520px] overflow-hidden bg-[radial-gradient(circle_at_top,rgba(21,94,117,0.28),rgba(2,6,23,0.98)_68%)] px-4 pb-5 pt-4 sm:px-6 sm:pt-6">
                        <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.16),transparent_72%)]" />
                        <div className="relative min-h-[520px] rounded-[1.9rem] border border-cyan-100/16 bg-[linear-gradient(160deg,rgba(8,18,34,0.72),rgba(6,12,22,0.92))] p-4 sm:p-6">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <article className="relative overflow-hidden rounded-[1.5rem] border border-cyan-100/16 bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.12),rgba(2,6,23,0.96))] p-4 sm:min-h-[290px]">
                              <div className="flex items-center justify-between">
                                <p className="rounded-full border border-cyan-100/18 bg-[#071627]/84 px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100/78">
                                  AI Interviewer
                                </p>
                                <span className="text-[10px] uppercase tracking-[0.12em] text-cyan-100/72">{formatRoundLabel(roundNumber, currentStageLabel)}</span>
                              </div>
                              <div className="mt-8 flex flex-col items-center text-center">
                                <div className="flex h-24 w-24 items-center justify-center rounded-full border border-emerald-200/24 bg-emerald-200/12 text-3xl font-semibold text-emerald-50">
                                  {interviewerName
                                    .split(" ")
                                    .map((part) => part.slice(0, 1).toUpperCase())
                                    .join("")
                                    .slice(0, 2)}
                                </div>
                                <h2 className="mt-4 text-3xl font-semibold text-cyan-50">{interviewerName}</h2>
                                <p className="mt-2 text-sm text-cyan-100/76">{interviewerTitle}</p>
                                <p className="mt-3 max-w-lg text-sm text-cyan-50/74">
                                  {roomStage === "live" && isFirstInterviewPrompt ? liveInterviewerIntro : interviewerRoomStatus}
                                </p>
                              </div>
                            </article>

                            <article className="relative overflow-hidden rounded-[1.5rem] border border-cyan-100/16 bg-[#030913] shadow-[0_18px_40px_rgba(2,8,22,0.34)] sm:min-h-[290px]">
                              <div className="flex items-center justify-between border-b border-cyan-100/10 px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-cyan-100/70">
                                <span className="truncate">{candidateName || "You"}</span>
                                <span>{cameraEnabled ? "Preview On" : "Preview Off"}</span>
                              </div>
                              <div className="relative h-[220px] sm:h-[250px]">
                                <video
                                  ref={liveVideoRef}
                                  muted
                                  playsInline
                                  autoPlay
                                  className={`h-full w-full object-cover transition ${cameraEnabled ? "opacity-100" : "opacity-0"}`}
                                />
                                {!cameraEnabled ? (
                                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.16),rgba(2,6,23,0.96))]">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-cyan-100/18 bg-cyan-100/10 text-xl font-semibold text-cyan-50">
                                      {(candidateName || "You").slice(0, 1).toUpperCase()}
                                    </div>
                                    <p className="mt-2 text-xs text-cyan-100/76">Camera preview off</p>
                                  </div>
                                ) : null}
                              </div>
                              <p className="border-t border-cyan-100/10 px-3 py-2 text-[11px] text-cyan-100/68">Local camera preview only. Not shared with interviewer AI.</p>
                            </article>
                          </div>

                          {roomStage === "live" && pendingRoundStart ? (
                            <div className="mt-4 rounded-[1.4rem] border border-emerald-200/20 bg-emerald-200/10 p-5">
                              <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-100/74">
                                {formatRoundLabel(pendingRoundStart.completedRoundNumber, pendingRoundStart.completedStageLabel)} Completed
                              </p>
                              <p className="mt-3 text-lg text-emerald-50 sm:text-xl">{pendingRoundStart.stageDecisionLabel}</p>
                              <p className="mt-2 text-sm text-emerald-50/86">{pendingRoundStart.stageDecisionReason}</p>
                              <p className="mt-3 text-xs text-emerald-100/76">{pendingRoundFollowUpMessage}</p>
                              <div className="mt-4 rounded-xl border border-emerald-200/18 bg-emerald-200/8 p-3">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-emerald-100/74">Questions Before Next Round?</p>
                                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                  <input
                                    value={roundQuestionText}
                                    onChange={(event) => setRoundQuestionText(event.target.value)}
                                    placeholder="Ask the interviewer about next steps, role, feedback, or timeline"
                                    className="w-full rounded-lg border border-emerald-200/20 bg-[#061827]/70 px-3 py-2 text-xs text-emerald-50 placeholder:text-emerald-100/52 outline-none focus:border-emerald-200/48"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const reply = buildInterviewerRoundAnswer(
                                        roundQuestionText,
                                        pendingRoundStart.completedStageLabel,
                                        pendingRoundStart.completedStageDecision
                                      );
                                      if (!reply) {
                                        setSimulatorError("Add your question first.");
                                        return;
                                      }
                                      setSimulatorError("");
                                      setRoundQuestionReply(reply);
                                    }}
                                    className="rounded-full border border-emerald-200/30 bg-emerald-300/18 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/26"
                                  >
                                    Ask Interviewer
                                  </button>
                                </div>
                                {roundQuestionReply ? <p className="mt-2 text-xs text-emerald-50/88">{roundQuestionReply}</p> : null}
                              </div>
                              <button
                                type="button"
                                onClick={handleStartNextRound}
                                disabled={
                                  pendingRoundStart.completedStageDecision !== "shortlisted" ||
                                  !pendingRoundStart.nextQuestion ||
                                  submitLoading ||
                                  joinLoading
                                }
                                className="mt-4 w-full rounded-full border border-emerald-200/34 bg-emerald-300/18 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:brightness-110 disabled:opacity-60 sm:w-auto"
                              >
                                {pendingRoundStartCtaLabel || "Start Next Round"}
                              </button>
                            </div>
                          ) : (
                            <div className="mt-4 rounded-2xl border border-cyan-100/18 bg-[#020915]/92 px-5 py-4 text-center shadow-[0_10px_26px_rgba(2,8,22,0.42)]">
                              <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/68">
                                {formatRoundLabel(roundNumber, currentStageLabel)} • Question {Math.max(1, questionNumberInStage)}
                              </p>
                              {interviewerBridge && !isFirstInterviewPrompt ? (
                                <p className="mt-2 text-sm text-cyan-100/82">{interviewerBridge}</p>
                              ) : null}
                              <p className="mt-2 text-lg leading-relaxed text-cyan-50 sm:text-2xl">
                                {currentQuestion || "Preparing the next interview prompt..."}
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-cyan-100/12 bg-[#0c1422]/84 px-3 py-3 shadow-[0_20px_50px_rgba(2,8,22,0.44)] sm:rounded-full">
                          <button
                            type="button"
                            onClick={isListening ? stopVoiceCapture : () => void startVoiceCapture()}
                            disabled={!speechSupported || !sessionId || roomStage !== "live" || submitLoading || Boolean(report) || isQuestionAudioPlaying || Boolean(pendingRoundStart)}
                            className={`w-full rounded-full border px-4 py-2 text-xs font-semibold transition disabled:opacity-50 sm:w-auto ${
                              isListening
                                ? "border-emerald-200/32 bg-emerald-300/18 text-emerald-50"
                                : "border-cyan-100/22 bg-cyan-100/10 text-cyan-50 hover:bg-cyan-100/18"
                            }`}
                          >
                            {speechSupported ? (isListening ? "Mic On" : "Start Mic") : "Mic Unsupported"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleCameraPreview()}
                            disabled={submitLoading}
                            className="w-full rounded-full border border-cyan-100/22 bg-cyan-100/10 px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/18 disabled:opacity-60 sm:w-auto"
                          >
                            {cameraEnabled ? "Camera Preview On" : "Enable Camera Preview"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void speakCurrentQuestion()}
                            disabled={!currentQuestion || roomStage !== "live" || submitLoading || ttsLoading}
                            className="w-full rounded-full border border-cyan-100/22 bg-cyan-100/10 px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/18 disabled:opacity-60 sm:w-auto"
                          >
                            {ttsLoading ? "Interviewer Speaking..." : isQuestionAudioPlaying ? "Stop Voice" : "Hear Question"}
                          </button>
                          {pendingRoundStart ? (
                            <button
                              type="button"
                              onClick={handleStartNextRound}
                              disabled={
                                pendingRoundStart.completedStageDecision !== "shortlisted" ||
                                !pendingRoundStart.nextQuestion ||
                                submitLoading ||
                                joinLoading
                              }
                              className="w-full rounded-full border border-emerald-200/34 bg-emerald-300/18 px-4 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/24 disabled:opacity-60 sm:w-auto"
                            >
                              {pendingRoundStartCtaLabel || "Start Next Round"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleSubmitAnswer()}
                              disabled={!canSubmitAnswer}
                              className="w-full rounded-full border border-cyan-100/28 bg-cyan-200/18 px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/26 disabled:opacity-60 sm:w-auto"
                            >
                              {submitLoading ? "Scoring Answer..." : "Submit Answer"}
                            </button>
                          )}
                          {sessionId && !report ? (
                            <button
                              type="button"
                              onClick={() => {
                                stopQuestionAudioPlayback();
                                if (isListening) stopVoiceCapture();
                                setInterviewerJoined(false);
                                setRoomStage("ready_to_join");
                                setPrejoinModalOpen(true);
                                storeSessionRef(sessionId, sessionSecret, "ready_to_join");
                              }}
                              disabled={joinLoading || submitLoading}
                              className="w-full rounded-full border border-rose-200/26 bg-rose-300/18 px-4 py-2 text-xs font-semibold text-rose-50 transition hover:bg-rose-300/24 disabled:opacity-60 sm:w-auto"
                            >
                              Leave Room
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="border-t border-cyan-100/10 bg-[linear-gradient(180deg,rgba(6,14,24,0.95),rgba(4,10,18,0.98))] p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/68">Your Answer</p>
                            <p className="mt-1 text-sm text-cyan-50/72">
                              Type or speak your answer after the interviewer stops speaking. Voice replies auto-submit once you pause.
                            </p>
                          </div>
                          <div className="rounded-full border border-cyan-100/16 bg-cyan-100/8 px-3 py-1 text-xs text-cyan-100/78">
                            Timer {formatSeconds(answerTimerSeconds)}
                          </div>
                        </div>
                        <textarea
                          value={answerText}
                          onChange={(event) => setAnswerText(event.target.value)}
                          placeholder={pendingRoundStart ? "Round complete. Check result and join the next round if shortlisted." : "Your response appears here."}
                          disabled={roomStage !== "live" || Boolean(report) || Boolean(pendingRoundStart)}
                          className={`${textAreaClass} mt-4 min-h-[170px] disabled:cursor-not-allowed disabled:opacity-60`}
                        />
                        {pendingRoundStart ? (
                          <p className="mt-3 rounded-xl border border-emerald-200/18 bg-emerald-200/10 px-3 py-2 text-xs text-emerald-50/86">
                            {pendingRoundStart.stageDecisionLabel}. {pendingRoundFollowUpMessage}
                          </p>
                        ) : null}
                        {interimTranscript ? (
                          <p className="mt-3 rounded-xl border border-cyan-100/14 bg-cyan-100/8 px-3 py-2 text-xs text-cyan-100/80">
                            Live transcript: {interimTranscript}
                          </p>
                        ) : null}
                        {cameraError ? <p className="mt-3 text-xs text-amber-100">{cameraError}</p> : null}
                        {simulatorError ? <p className="mt-3 text-xs text-amber-100">{simulatorError}</p> : null}
                      </div>
                    </article>
                  </section>

                  {null}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <section className="mx-auto max-w-[1320px] rounded-[2rem] border border-cyan-100/22 bg-[linear-gradient(150deg,rgba(8,26,48,0.94),rgba(4,14,30,0.96)_52%,rgba(7,30,52,0.92))] p-6 shadow-[0_20px_54px_rgba(2,8,22,0.48)] sm:p-8">
        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/78">Live AI Interview Lab</p>
            <h1 className="mt-3 text-3xl font-semibold text-cyan-50 sm:text-5xl">Interview Simulator</h1>
            <p className="mt-3 max-w-3xl text-sm text-cyan-50/78 sm:text-base">
              This is HireScore’s core differentiator: a meet-style, human-like interview simulation that adapts by round, scores relevance in real time, and saves report history to dashboard.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3">
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/68">Step 1</p>
                <p className="mt-1 text-xs text-cyan-50/84">
                  {isDemoMode
                    ? "Add your name and target role to run the 90-second screening demo. The setup card collapses only after you click Start Interview."
                    : "Add your name, target role, resume, and JD. The setup card collapses only after you click Start Interview."}
                </p>
              </div>
              <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3">
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/68">Step 2</p>
                <p className="mt-1 text-xs text-cyan-50/84">Review the pre-join room preview, then join the interview with camera and mic controls.</p>
              </div>
              <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3">
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/68">Step 3</p>
                <p className="mt-1 text-xs text-cyan-50/84">
                  {isDemoMode
                    ? "The demo runs a single screening round with 3 adaptive questions and instant result."
                    : "The simulator moves through screening, technical, in-depth, and HR rounds only when your performance justifies them."}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-100/22 bg-[#061a32]/72 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/72">Session Status</p>
            <p className="mt-2 text-sm text-cyan-50/84">{authEmail ? `Signed in as ${authEmail}` : "Guest mode active"}</p>
            <p className="mt-1 text-xs text-cyan-100/74">{wallet ? `Wallet: ${wallet.credits} credits` : "No wallet required in guest mode"}</p>
            <p className="mt-1 text-xs text-cyan-100/74">{guestInterviewNote}</p>
            <p className="mt-3 rounded-xl border border-cyan-100/16 bg-cyan-100/8 px-3 py-2 text-xs text-cyan-100/80">{reportArchiveNote}</p>
            {authError ? (
              <div className="mt-3 rounded-xl border border-amber-100/34 bg-amber-100/12 p-3">
                <p className="text-xs text-amber-50">{authError}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-6 max-w-[1320px] space-y-5">
        {shouldShowCompactSetup ? (
          <article className="flex flex-col gap-4 rounded-[1.7rem] border border-cyan-100/18 bg-[linear-gradient(145deg,rgba(7,22,43,0.92),rgba(4,14,29,0.96))] p-4 shadow-[0_14px_38px_rgba(2,8,22,0.34)] sm:p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/72">Simulation Setup</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {setupChips.map((chip) => (
                  <span key={chip} className="rounded-full border border-cyan-100/18 bg-cyan-100/8 px-3 py-1 text-xs text-cyan-50/82">
                    {chip}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-cyan-100/72">
                {isDemoMode
                  ? "Demo mode active: resume and JD are optional."
                  : `${resumeUploadedFileName ? `Resume: ${resumeUploadedFileName}` : "Resume ready"} • ${
                      jdUploadedFileName ? `JD: ${jdUploadedFileName}` : "JD ready"
                    }`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {sessionId && !report ? (
                <button
                  type="button"
                  onClick={() => setPrejoinModalOpen(true)}
                  className="rounded-full border border-emerald-200/28 bg-emerald-300/16 px-4 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/24"
                >
                  {roomStage === "live" ? "Interview Live" : "Open Room Preview"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSetupExpanded(true)}
                className="rounded-full border border-cyan-100/22 bg-transparent px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/10"
              >
                Edit Setup
              </button>
            </div>
          </article>
        ) : (
          <article className="rounded-[1.9rem] border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(7,22,43,0.94),rgba(4,14,29,0.98))] p-5 shadow-[0_18px_44px_rgba(2,8,22,0.36)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/72">Simulation Setup</p>
                <h2 className="mt-2 text-2xl font-semibold text-cyan-50">Prepare the interview room.</h2>
              </div>
              {sessionId || report ? (
                <button
                  type="button"
                  onClick={() => setSetupExpanded(false)}
                  className="rounded-full border border-cyan-100/22 bg-transparent px-4 py-2 text-xs font-semibold text-cyan-50/84 transition hover:bg-cyan-100/10"
                >
                  Minimize
                </button>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-100/16 bg-cyan-100/8 px-3 py-3">
              <p className="text-xs text-cyan-100/80">{setupReadinessLabel}</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleStartSimulator()}
                  disabled={!canStartSession}
                  className={`inline-flex items-center rounded-full border px-5 py-2.5 text-sm font-semibold text-cyan-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${
                    startButtonLiveState
                      ? "animate-pulse border-emerald-200/60 bg-gradient-to-r from-emerald-300/32 via-cyan-200/24 to-sky-200/24 shadow-[0_0_0_1px_rgba(167,243,208,0.38),0_0_24px_rgba(16,185,129,0.36)]"
                      : "border-cyan-100/32 bg-gradient-to-r from-cyan-200/18 via-sky-200/16 to-emerald-200/16"
                  }`}
                >
                  {startButtonLiveState ? (
                    <span className="relative mr-2 inline-flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-100/85" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-50" />
                    </span>
                  ) : null}
                  {startLoading ? "Initializing Interview..." : isDemoMode ? "Start 90-Second Demo" : "Start Interview"}
                </button>
                <button
                  type="button"
                  onClick={resetSimulationState}
                  disabled={startLoading || submitLoading}
                  className="rounded-full border border-cyan-100/22 bg-transparent px-5 py-2.5 text-xs font-semibold text-cyan-50/84 transition hover:bg-cyan-100/10 disabled:opacity-60"
                >
                  Reset Session
                </button>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-cyan-100/16 bg-cyan-100/8 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/72">Simulation Mode</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setSimulatorMode("full")}
                  disabled={startLoading || submitLoading}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    simulatorMode === "full"
                      ? "border-emerald-200/40 bg-emerald-300/16 text-emerald-50"
                      : "border-cyan-100/22 bg-transparent text-cyan-50/84 hover:bg-cyan-100/10"
                  }`}
                >
                  Full Simulation
                </button>
                <button
                  type="button"
                  onClick={() => setSimulatorMode("demo")}
                  disabled={startLoading || submitLoading}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    simulatorMode === "demo"
                      ? "border-emerald-200/40 bg-emerald-300/16 text-emerald-50"
                      : "border-cyan-100/22 bg-transparent text-cyan-50/84 hover:bg-cyan-100/10"
                  }`}
                >
                  90-Second Demo
                </button>
              </div>
              <p className="mt-2 text-xs text-cyan-100/72">
                {isDemoMode
                  ? "Demo asks 3 screening questions with instant decision preview."
                  : "Full mode uses resume + JD and unlocks adaptive multi-round interview flow."}
              </p>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-5">
              <label className="grid gap-1 lg:col-span-1">
                <span className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/70">Name (Required)</span>
                <input
                  value={candidateName}
                  onChange={(event) => setCandidateName(event.target.value)}
                  placeholder="Your name"
                  className={fieldClass}
                />
              </label>
              <label className="grid gap-1 lg:col-span-2">
                <span className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/70">Target Role (Required)</span>
                <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Target role" className={fieldClass} />
              </label>
              <label className="grid gap-1 lg:col-span-1">
                <span className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/70">Industry</span>
                <input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="Industry" className={fieldClass} />
              </label>
              <label className="grid gap-1 lg:col-span-1">
                <span className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/70">Difficulty</span>
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as "foundation" | "standard" | "advanced")}
                  className={fieldClass}
                >
                  <option value="foundation">Foundation</option>
                  <option value="standard">Standard</option>
                  <option value="advanced">Advanced</option>
                </select>
              </label>
            </div>
            {setupRequiresResumeAndJd ? (
              <>
                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr,1fr,180px]">
                  <button
                    type="button"
                    onClick={() => resumeFileInputRef.current?.click()}
                    disabled={resumeFileUploading}
                    className="rounded-xl border border-cyan-100/28 bg-cyan-100/10 px-3 py-2.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:opacity-60"
                  >
                    {resumeFileUploading ? "Extracting Resume..." : "Upload Resume"}
                  </button>
                  <button
                    type="button"
                    onClick={() => jdFileInputRef.current?.click()}
                    disabled={jdFileUploading}
                    className="rounded-xl border border-cyan-100/28 bg-cyan-100/10 px-3 py-2.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:opacity-60"
                  >
                    {jdFileUploading ? "Extracting JD..." : "Upload JD"}
                  </button>
                  <div className="flex items-center rounded-xl border border-cyan-100/18 bg-cyan-100/8 px-3 py-2.5 text-xs text-cyan-50/84">
                    Adaptive rounds: Screening, Technical, In-Depth, HR
                  </div>
                </div>
                {(resumeUploadedFileName || jdUploadedFileName) ? (
                  <p className="mt-3 text-xs text-cyan-100/74">
                    {resumeUploadedFileName ? `Resume: ${resumeUploadedFileName}` : "Resume loaded"} •{" "}
                    {jdUploadedFileName ? `JD: ${jdUploadedFileName}` : "JD loaded"}
                  </p>
                ) : null}
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <textarea
                    value={resumeText}
                    onChange={(event) => setResumeText(event.target.value)}
                    placeholder="Resume context"
                    className={`${textAreaClass} min-h-[180px]`}
                  />
                  <textarea
                    value={jobDescription}
                    onChange={(event) => setJobDescription(event.target.value)}
                    placeholder="JD context"
                    className={`${textAreaClass} min-h-[180px]`}
                  />
                </div>
              </>
            ) : (
              <div className="mt-3 rounded-xl border border-cyan-100/16 bg-cyan-100/8 px-3 py-3 text-xs text-cyan-100/80">
                Resume and JD are optional in demo mode. Add them and switch to Full Simulation for deeper adaptive rounds and dashboard-grade analysis.
              </div>
            )}
            {focusSkillsForDisplay.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-cyan-100/16 bg-cyan-100/6 p-4">
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/72">Focus Skills</p>
                <p className="mt-1 text-xs text-cyan-100/72">
                  {isDemoMode ? "Short role keywords extracted from role context." : "Short role keywords extracted from your JD and resume."}
                </p>
                <p className="mt-2 text-sm text-cyan-50/82">{focusSkillsForDisplay.join(", ")}</p>
              </div>
            ) : null}
            {simulatorError ? <p className="mt-4 text-xs text-amber-100">{simulatorError}</p> : null}
          </article>
        )}

        <div className={`grid gap-5 ${report ? "xl:grid-cols-[1.7fr_0.8fr]" : ""}`}>
          <section className="space-y-5">
            <article className="overflow-hidden rounded-[2rem] border border-cyan-100/18 bg-[#040911] shadow-[0_22px_60px_rgba(2,8,22,0.46)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-100/10 bg-[#07101b]/88 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      interviewOverlayActive
                        ? "bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.7)]"
                        : report
                          ? "bg-cyan-200 shadow-[0_0_18px_rgba(103,232,249,0.55)]"
                          : "bg-cyan-100/60"
                    }`}
                  />
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/66">Interview Room</p>
                    <p className="text-sm text-cyan-50">
                      {interviewOverlayActive
                        ? "Interview is running in focused mode. Finish the session to unlock the full page again."
                        : sessionId
                          ? "Your interview opens in a focused popup card."
                          : "Complete the setup card above to generate your interview room."}
                    </p>
                  </div>
                </div>
                <div className="text-right text-xs text-cyan-100/74">
                  <p>{report ? "Completed" : interviewOverlayActive ? formatRoomTime(roomClock) : "Ready"}</p>
                  <p className="mt-1">{meetingRoomCode}</p>
                </div>
              </div>
              <div className="grid gap-4 bg-[radial-gradient(circle_at_top,rgba(21,94,117,0.18),rgba(2,6,23,0.96)_72%)] p-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[1.4rem] border border-cyan-100/14 bg-cyan-100/8 p-5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/66">Focused Interview Mode</p>
                  <h3 className="mt-3 text-2xl font-semibold text-cyan-50">Popup interview room</h3>
                  <p className="mt-3 text-sm text-cyan-50/76">
                    Once you join, the interview takes over the screen in a dedicated popup card with the rest of the dashboard blurred behind it.
                  </p>
                  <div className="mt-5 space-y-3 text-sm text-cyan-50/80">
                    <div className="rounded-xl border border-cyan-100/14 bg-[#071425]/78 p-3">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/66">Required fields</p>
                      <p className="mt-2">Name and target role must be filled before interview start.</p>
                    </div>
                    <div className="rounded-xl border border-cyan-100/14 bg-[#071425]/78 p-3">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/66">Interviewer intro</p>
                      <p className="mt-2">{liveInterviewerIntro}</p>
                    </div>
                    <div className="rounded-xl border border-cyan-100/14 bg-[#071425]/78 p-3">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/66">Adaptive rounds</p>
                      <p className="mt-2">The simulator always starts with screening, then unlocks technical, in-depth, and HR rounds only when performance supports them.</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-[1.4rem] border border-cyan-100/14 bg-[#071425]/74 p-5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/66">Room Actions</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {sessionId && !report ? (
                      <button
                        type="button"
                        onClick={() => setPrejoinModalOpen(true)}
                        className="rounded-full border border-emerald-200/26 bg-emerald-300/16 px-4 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/24"
                      >
                        {roomStage === "live" ? "Return to Interview" : "Open Interview Popup"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSetupExpanded(true)}
                      className="rounded-full border border-cyan-100/22 bg-transparent px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/10"
                    >
                      Edit Setup
                    </button>
                  </div>
                  {simulatorError ? <p className="mt-4 text-xs text-amber-100">{simulatorError}</p> : null}
                  {cameraError ? <p className="mt-2 text-xs text-amber-100">{cameraError}</p> : null}
                </div>
              </div>
            </article>
          </section>

          {report ? (
            <aside className="space-y-5">
              <article className="rounded-[1.7rem] border border-cyan-100/18 bg-[linear-gradient(145deg,rgba(8,24,44,0.9),rgba(5,16,31,0.96))] p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Session Snapshot</p>
                  <button
                    type="button"
                    onClick={() => void handleRefreshReport()}
                    disabled={!sessionId || loadingReport}
                    className="rounded-full border border-cyan-100/20 bg-cyan-100/8 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-100/14 disabled:opacity-60"
                  >
                    {loadingReport ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                <div className="mt-4 space-y-3 text-sm text-cyan-50/80">
                  <div className="rounded-xl border border-cyan-100/14 bg-cyan-100/8 p-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/66">Candidate</p>
                    <p className="mt-1 text-sm text-cyan-50">{candidateName || "Pending"}</p>
                  </div>
                  <div className="rounded-xl border border-cyan-100/14 bg-cyan-100/8 p-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/66">Round Progress</p>
                    <p className="mt-1 text-sm text-cyan-50">
                      {formatRoundLabel(roundNumber, currentStageLabel)} of {Math.max(0, totalRounds)}
                    </p>
                    <p className="mt-1 text-xs text-cyan-100/72">Question {Math.max(1, questionNumberInStage)} in this round</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full border border-cyan-100/16 bg-cyan-100/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-300/80 via-sky-300/80 to-emerald-200/80 transition-all duration-500"
                        style={{ width: `${clampPercent(progressPercent)}%` }}
                      />
                    </div>
                  </div>
                  {focusSkillsForDisplay.length > 0 ? (
                    <div className="rounded-xl border border-cyan-100/14 bg-cyan-100/8 p-3">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/66">Focus Skills</p>
                      <p className="mt-2 text-xs text-cyan-50/80">{focusSkillsForDisplay.join(", ")}</p>
                    </div>
                  ) : null}
                </div>
              </article>

              <article className="rounded-[1.7rem] border border-cyan-100/18 bg-[linear-gradient(145deg,rgba(8,24,44,0.9),rgba(5,16,31,0.96))] p-5">
                <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Session Scoreboard</p>
                {!latestTurnFeedback ? (
                  <p className="mt-4 text-sm text-cyan-50/72">No scored answers available for this session.</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {[
                      { label: "Communication", value: latestTurnFeedback.scores.communication },
                      { label: "Clarity", value: latestTurnFeedback.scores.clarity },
                      { label: "Domain Depth", value: latestTurnFeedback.scores.domain_depth },
                      { label: "Confidence", value: latestTurnFeedback.scores.confidence },
                      { label: "Overall", value: latestTurnFeedback.scores.overall || 0 },
                    ].map((metric) => (
                      <div key={metric.label}>
                        <div className="flex items-center justify-between text-xs text-cyan-100/80">
                          <span>{metric.label}</span>
                          <span>{clampPercent(metric.value)}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full border border-cyan-100/16 bg-[#061a34]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-300 to-emerald-200 transition-all duration-700"
                            style={{ width: `${clampPercent(metric.value)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    <p className="rounded-xl border border-cyan-100/16 bg-cyan-100/8 px-3 py-2 text-xs text-cyan-100/78">
                      {latestTurnFeedback.feedback_summary}
                    </p>
                  </div>
                )}
              </article>

              <article className="rounded-[1.7rem] border border-cyan-100/18 bg-[linear-gradient(145deg,rgba(8,24,44,0.9),rgba(5,16,31,0.96))] p-5">
                <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Turn History</p>
                {turnHistory.length === 0 ? (
                  <p className="mt-4 text-sm text-cyan-50/72">No interview answers scored yet.</p>
                ) : (
                  <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                    {turnHistory.map((turn, index) => (
                      <article key={`turn-${turn.round_number}-${turn.question_number_in_stage || 1}-${index}`} className="rounded-xl border border-cyan-100/16 bg-cyan-100/8 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-cyan-100">{formatRoundLabel(turn.round_number, turn.stage_label || "Round")}</p>
                          <span className="text-[11px] text-cyan-100/70">{turn.response_time_seconds}s</span>
                        </div>
                        <p className="mt-2 text-[11px] text-cyan-100/68">Question {turn.question_number_in_stage || 1}</p>
                        <p className="mt-2 text-[11px] text-cyan-50/84">{turn.feedback_summary}</p>
                        <p className="mt-2 text-[11px] text-cyan-100/70">Overall {clampPercent(turn.scores.overall || 0)}%</p>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            </aside>
          ) : null}
        </div>
      </section>

      {report ? (
        <section className="mx-auto mt-6 max-w-[1320px] rounded-[2rem] border border-emerald-200/22 bg-[linear-gradient(160deg,rgba(6,26,42,0.92),rgba(6,18,34,0.96))] p-6 shadow-[0_18px_48px_rgba(2,8,22,0.4)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-emerald-100/78">Final Report</p>
              <h2 className="mt-2 text-2xl font-semibold text-cyan-50 sm:text-3xl">Interview Readiness: {clampPercent(report.overall_score)}%</h2>
              <p className="mt-1 text-sm text-cyan-100/80">Readiness band: {report.readiness_label.replace(/_/g, " ")}</p>
              {report.shortlist_prediction ? <p className="mt-1 text-sm text-cyan-100/76">{report.shortlist_prediction}</p> : null}
              <p className="mt-3 rounded-xl border border-emerald-200/18 bg-emerald-200/10 px-3 py-2 text-xs text-emerald-50/88">{reportArchiveNote}</p>
              {reportSessionMode === "demo" ? (
                <div className="mt-3 rounded-xl border border-cyan-100/20 bg-cyan-100/8 px-3 py-2">
                  <p className="text-xs text-cyan-100/84">Demo complete. Switch to full simulation with resume + JD for multi-round depth and stronger dashboard insights.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSimulatorMode("full");
                      setSetupExpanded(true);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="mt-2 rounded-full border border-cyan-100/28 bg-cyan-200/14 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
                  >
                    Switch to Full Simulation
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadSimulatorReport}
                className="rounded-xl border border-emerald-200/28 bg-emerald-200/12 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-200/22"
              >
                Download Report
              </button>
              <TrackedLink
                href={addUtmParams("/dashboard", {
                  source: "interview_simulator_report",
                  medium: "internal",
                  campaign: "simulator_to_dashboard",
                })}
                eventName="cta_dashboard_archive_click"
                eventParams={{ cta_location: "interview_simulator_report", cta_label: "Open Dashboard Archive" }}
                className="rounded-xl border border-cyan-100/30 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
              >
                Open Dashboard
              </TrackedLink>
              <button
                type="button"
                onClick={resetSimulationState}
                className="rounded-xl border border-cyan-100/24 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16"
              >
                Start New Session
              </button>
            </div>
          </div>

          {reportFinalRoundDecision ? (
            <article
              className={`mt-4 rounded-xl border p-4 ${
                reportFinalRoundDecision === "offer_ready" || reportFinalRoundDecision === "shortlisted"
                  ? "border-emerald-200/24 bg-emerald-200/10"
                  : "border-rose-200/24 bg-rose-200/10"
              }`}
            >
              <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Final Outcome</p>
              <p className="mt-2 text-base font-semibold text-cyan-50">
                {reportFinalRoundDecision === "offer_ready"
                  ? "Congratulations. Final HR round shortlisted."
                  : reportFinalRoundDecision === "shortlisted"
                    ? "Shortlisted for final decision."
                    : "Not shortlisted for further process."}
              </p>
              <p className="mt-2 text-sm text-cyan-50/84">
                {reportFinalRoundDecision === "offer_ready"
                  ? "Thank you for your time. Offer-stage discussion can begin based on final evaluation."
                  : reportFinalRoundDecision === "shortlisted"
                    ? "Thank you for your time. You are progressing based on interview performance."
                    : "Thank you for your time. Review this report to improve for your next attempt."}
              </p>
            </article>
          ) : null}

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {report.screening_decision ? (
              <article className={`rounded-xl border p-4 ${report.screening_decision === "shortlisted" ? "border-emerald-200/24 bg-emerald-200/10" : "border-rose-200/24 bg-rose-200/10"}`}>
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Round 1 Decision</p>
                <p className="mt-2 text-base font-semibold text-cyan-50">
                  {report.screening_decision === "shortlisted" ? "Shortlisted for Round 2" : "Rejected After Screening"}
                </p>
                <p className="mt-2 text-sm text-cyan-50/84">
                  {report.screening_decision_reason || "The simulator evaluated your screening answers and set the round-one outcome."}
                </p>
              </article>
            ) : null}
            {report.round_decisions && report.round_decisions.length > 0 ? (
              <article className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-4">
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Round Decisions</p>
                <div className="mt-2 space-y-2">
                  {report.round_decisions.slice(0, 4).map((item, index) => (
                    <div key={`round-decision-${item.stage_key}-${index}`} className="rounded-lg border border-cyan-100/14 bg-[#071425]/72 p-2.5">
                      <p className="text-xs font-semibold text-cyan-50">
                        {formatRoundLabel(item.stage_number, item.stage_label)}: {item.decision === "shortlisted" ? "Shortlisted" : "Rejected"}
                      </p>
                      {item.reason ? <p className="mt-1 text-xs text-cyan-100/76">{item.reason}</p> : null}
                    </div>
                  ))}
                </div>
              </article>
            ) : null}
            <article className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-4">
              <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Matched Strengths</p>
              <ul className="mt-2 space-y-1 text-sm text-cyan-50/84">
                {(report.strength_signals || []).slice(0, 6).map((item, index) => (
                  <li key={`strength-${item}-${index}`}>- {item}</li>
                ))}
              </ul>
            </article>
            <article className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-4">
              <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Improvement Signals</p>
              <ul className="mt-2 space-y-1 text-sm text-cyan-50/84">
                {(report.improvement_signals || []).slice(0, 6).map((item, index) => (
                  <li key={`improve-${item}-${index}`}>- {item}</li>
                ))}
              </ul>
            </article>
          </div>

          {report.stage_summaries && report.stage_summaries.length > 0 ? (
            <article className="mt-4 rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-4">
              <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Round Summary</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {report.stage_summaries.slice(0, 4).map((item) => (
                  <div key={`stage-summary-${item.stage_key}`} className="rounded-xl border border-cyan-100/14 bg-[#071425]/72 p-3">
                    <p className="text-sm font-semibold text-cyan-50">{formatRoundLabel(item.stage_number, item.stage_label)}</p>
                    <p className="mt-1 text-xs text-cyan-100/72">Questions: {item.question_count}</p>
                    <p className="mt-1 text-xs text-cyan-100/72">Average score: {clampPercent(item.average_score)}%</p>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <article className="mt-4 rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-4">
            <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/70">Next Steps</p>
            <ol className="mt-2 space-y-1 text-sm text-cyan-50/84">
              {(report.next_steps || []).slice(0, 5).map((step, index) => (
                <li key={`next-step-${index}`}>{index + 1}. {step}</li>
              ))}
            </ol>
          </article>

          <div className="mt-5 flex flex-wrap gap-3">
            <TrackedLink
              href={addUtmParams("/interview-prep", {
                source: "interview_simulator_report",
                medium: "internal",
                campaign: "simulator_to_interview_prep",
              })}
              eventName="cta_interview_copilot_click"
              eventParams={{ cta_location: "interview_simulator_report", cta_label: "Open Interview Prep" }}
              className="rounded-xl border border-cyan-100/30 bg-cyan-200/16 px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
            >
              Open Interview Prep
            </TrackedLink>
            <TrackedLink
              href={addUtmParams("/pricing", {
                source: "interview_simulator_report",
                medium: "internal",
                campaign: "simulator_to_pricing",
              })}
              eventName="cta_view_premium_plans_click"
              eventParams={{ cta_location: "interview_simulator_report", cta_label: "View Premium Plans" }}
              className="rounded-xl border border-cyan-100/24 bg-transparent px-4 py-2 text-xs font-semibold text-cyan-50/84 transition hover:bg-cyan-100/10"
            >
              View Premium Plans
            </TrackedLink>
          </div>
        </section>
      ) : null}
    </main>
  );
}
