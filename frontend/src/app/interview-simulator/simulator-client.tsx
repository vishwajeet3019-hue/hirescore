"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";
import { addUtmParams } from "@/lib/utm";
import { trackEvent } from "@/lib/analytics";
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

type SimulatorScoreBreakdown = {
  communication: number;
  clarity: number;
  domain_depth: number;
  confidence: number;
  overall?: number;
};

type SimulatorTurnFeedback = {
  round_number: number;
  question: string;
  answer: string;
  answer_word_count: number;
  response_time_seconds: number;
  scores: SimulatorScoreBreakdown;
  matched_focus_skills?: string[];
  missing_focus_skills?: string[];
  feedback_summary: string;
  strengths: string[];
  improvements: string[];
  next_focus_skill?: string;
  ai?: {
    used?: boolean;
    model?: string | null;
    reason?: string;
  };
  created_at?: string;
};

type SimulatorReport = {
  overall_score: number;
  readiness_label: string;
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
  total_rounds: number;
};

type SimulatorStartPayload = {
  session_id: string;
  session_secret?: string;
  role: string;
  industry: string;
  difficulty: string;
  focus_skills: string[];
  round_number: number;
  total_rounds: number;
  progress_percent: number;
  current_question: string;
  status: string;
  report?: SimulatorReport | null;
  ai?: {
    used?: boolean;
    model?: string | null;
    reason?: string;
  };
};

type SimulatorTurnPayload = {
  session_id: string;
  completed: boolean;
  round_number: number;
  total_rounds: number;
  progress_percent: number;
  next_question?: string | null;
  turn_feedback?: SimulatorTurnFeedback | null;
  report?: SimulatorReport | null;
  status: string;
};

type SimulatorReportPayload = {
  session_id: string;
  role: string;
  industry: string;
  difficulty: string;
  total_rounds: number;
  status: string;
  focus_skills: string[];
  turns: SimulatorTurnFeedback[];
  report: SimulatorReport;
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
};

type UploadExtractPayload = {
  extracted_text?: string;
  job_description?: string;
  extracted_chars: number;
  file_name: string;
  file_type?: string;
};

type InterviewRoomStage = "not_started" | "ready_to_join" | "joining" | "live";

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
const SIMULATOR_API_BASE_URL =
  process.env.NEXT_PUBLIC_INTERVIEW_SIMULATOR_API_BASE_URL?.trim() || "https://backend-six-gilt-84.vercel.app";
const AUTH_REQUEST_TIMEOUT_MS = 70000;
const SIMULATOR_MIN_LOADING_MS = 1800;
const SESSION_STORAGE_KEY = "hirescore_interview_simulator_session_id";
const PUBLIC_UPLOAD_SESSION_STORAGE_KEY = "hirescore_interview_simulator_public_upload_session_id";
const AI_INTERVIEWER_VOICE = "verse";
const JOIN_CHIME_DURATION_MS = 900;
const authApiUrl = (path: string) => `${AUTH_API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const simulatorApiUrl = (path: string) => `${SIMULATOR_API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const fieldClass =
  "w-full rounded-xl border border-cyan-100/26 bg-[#081f38]/76 px-3 py-2.5 text-sm text-cyan-50 placeholder:text-cyan-100/34 outline-none transition focus:border-cyan-100/62";
const textAreaClass = `${fieldClass} min-h-[120px] leading-relaxed`;

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

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
  const [role, setRole] = useState("");
  const [industry, setIndustry] = useState("");
  const [difficulty, setDifficulty] = useState<"foundation" | "standard" | "advanced">("standard");
  const [rounds, setRounds] = useState(5);
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
  const [totalRounds, setTotalRounds] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [answerText, setAnswerText] = useState("");
  const [answerTimerSeconds, setAnswerTimerSeconds] = useState(0);
  const [turnHistory, setTurnHistory] = useState<SimulatorTurnFeedback[]>([]);
  const [report, setReport] = useState<SimulatorReport | null>(null);
  const [sessionAiInfo, setSessionAiInfo] = useState<string>("");
  const [startLoading, setStartLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [activeVoiceName, setActiveVoiceName] = useState("");
  const [voiceEngineLabel, setVoiceEngineLabel] = useState("");
  const [isQuestionAudioPlaying, setIsQuestionAudioPlaying] = useState(false);
  const [roomStage, setRoomStage] = useState<InterviewRoomStage>("not_started");
  const [interviewerJoined, setInterviewerJoined] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState("");
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);
  const jdFileInputRef = useRef<HTMLInputElement | null>(null);

  const authHeader = useMemo(() => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined), [authToken]);
  const sessionActive = Boolean(sessionId && currentQuestion && !report);
  const latestTurnFeedback = turnHistory.length > 0 ? turnHistory[turnHistory.length - 1] : null;

  useEffect(() => {
    void warmBackend(simulatorApiUrl);
    if (AUTH_API_BASE_URL !== SIMULATOR_API_BASE_URL) {
      void warmBackend(authApiUrl);
    }
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
      const priorityMatchers = [
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
        picked = source.find((voice) => matcher.test(voice.name));
        if (picked) break;
      }
      if (!picked) {
        picked = source.find((voice) => !voice.localService) || source[0];
      }
      selectedVoiceRef.current = picked || null;
      setActiveVoiceName(picked?.name || "");
    };

    pickNaturalVoice();
    window.speechSynthesis.onvoiceschanged = pickNaturalVoice;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === pickNaturalVoice) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

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
    if (!cameraEnabled || !videoRef.current || !mediaStreamRef.current) return;
    videoRef.current.srcObject = mediaStreamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [cameraEnabled]);

  useEffect(() => {
    const syncAuth = async () => {
      const token = window.localStorage.getItem("hirescore_auth_token") || "";
      if (!token) {
        setAuthToken("");
        setWallet(null);
        setAuthEmail("");
        setAuthError("");
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
          return;
        }
        const payload = (await response.json()) as AuthPayload;
        setAuthToken(token);
        setWallet(payload.wallet || null);
        setAuthEmail(payload.user?.email || "");
        setAuthError("");
      } catch {
        setAuthError("Signed-in account check is currently unavailable. Guest mode is still active.");
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
    const questionText = currentQuestion.replace(/\s+/g, " ").trim();
    if (!questionText || !sessionId || !sessionSecret || report) {
      clearPrefetchedQuestionAudio();
      return;
    }
    const prefetchKey = `${sessionId}:${roundNumber}:${questionText}`;
    if (prefetchedQuestionAudioRef.current?.key === prefetchKey) return;
    if (prefetchingQuestionKeyRef.current === prefetchKey && prefetchedQuestionAudioPromiseRef.current) return;

    if (prefetchedQuestionAbortRef.current) {
      prefetchedQuestionAbortRef.current.abort();
      prefetchedQuestionAbortRef.current = null;
    }
    const controller = new AbortController();
    prefetchedQuestionAbortRef.current = controller;
    prefetchingQuestionKeyRef.current = prefetchKey;
    const prefetchPromise = fetchAiQuestionAudio(questionText, controller.signal)
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
  }, [currentQuestion, sessionId, sessionSecret, report, roundNumber, authHeader, authToken]);

  useEffect(() => {
    if (roomStage !== "live" || !sessionId || report) return;
    const questionText = currentQuestion.replace(/\s+/g, " ").trim();
    if (!questionText) return;
    const questionKey = `${sessionId}:${roundNumber}:${questionText}`;
    if (autoSpokenQuestionRef.current === questionKey) return;
    autoSpokenQuestionRef.current = questionKey;
    void speakCurrentQuestion({ force: true, silentErrors: true, trigger: "auto" });
  }, [roomStage, currentQuestion, sessionId, roundNumber, report]);

  useEffect(() => {
    const storedRaw = window.localStorage.getItem(SESSION_STORAGE_KEY) || "";
    if (!storedRaw) return;

    let storedSession: StoredSessionRef | null = null;
    try {
      const parsed = JSON.parse(storedRaw) as StoredSessionRef;
      if (!parsed?.session_id || !parsed?.session_secret) {
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
        setRole(payload.role || "");
        setIndustry(payload.industry || "");
        setDifficulty((payload.difficulty as "foundation" | "standard" | "advanced") || "standard");
        setTotalRounds(payload.total_rounds || 0);
        setFocusSkills(payload.focus_skills || []);
        setTurnHistory(payload.turns || []);
        setReport(payload.status === "completed" ? payload.report : null);
        if (payload.status === "completed") {
          setCurrentQuestion("");
          setRoundNumber(payload.report?.turns_completed || payload.turns?.length || 0);
          setProgressPercent(100);
          setAnswerText("");
          setRoomStage("not_started");
          setInterviewerJoined(false);
          return;
        }
        const turnsCompleted = (payload.turns || []).length;
        const questions = (payload as unknown as { questions?: string[] }).questions || [];
        const fallbackQuestion = questions.length > turnsCompleted ? questions[turnsCompleted] : questions[questions.length - 1] || "";
        setCurrentQuestion(fallbackQuestion);
        setRoundNumber(Math.max(1, turnsCompleted + 1));
        setProgressPercent(clampPercent((Math.max(1, turnsCompleted + 1) / Math.max(1, payload.total_rounds || 1)) * 100));
        setRoomStage("live");
        setInterviewerJoined(true);
      } catch {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    };
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [authToken, authHeader]);

  useEffect(() => {
    return () => {
      keepListeningRef.current = false;
      interimTranscriptRef.current = "";
      speechBaseAnswerRef.current = "";
      speechFinalTranscriptRef.current = "";
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

  const stopQuestionAudioPlayback = () => {
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
        voice: AI_INTERVIEWER_VOICE,
        auth_token: authToken || undefined,
      }),
      signal,
    });
    if (!response.ok) {
      const err = await parseApiError(response);
      throw new Error(err || `Request failed (${response.status})`);
    }
    const blob = await response.blob();
    if (!blob || blob.size < 1200) {
      throw new Error("ai_audio_empty");
    }
    return {
      blob,
      modelLabel: response.headers.get("X-Interview-TTS-Model") || "",
      voiceLabel: response.headers.get("X-Interview-TTS-Voice") || "",
    };
  };

  const playBrowserSpeechFallback = (text: string) => {
    if (typeof window === "undefined" || !ttsSupported || !("speechSynthesis" in window)) {
      throw new Error("Text-to-speech is not supported in this browser.");
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/\s+/g, " ").trim());
    const preferredVoice = selectedVoiceRef.current;
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang || "en-US";
    } else {
      utterance.lang = "en-US";
    }
    utterance.rate = 0.95;
    utterance.pitch = 1.01;
    utterance.volume = 1;
    setVoiceEngineLabel(preferredVoice?.name ? `Browser voice (${preferredVoice.name})` : "Browser voice");
    window.speechSynthesis.speak(utterance);
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
    keepListeningRef.current = false;
    interimTranscriptRef.current = "";
    speechBaseAnswerRef.current = "";
    speechFinalTranscriptRef.current = "";
    setSessionId("");
    setSessionSecret("");
    setCurrentQuestion("");
    setRoundNumber(0);
    setTotalRounds(0);
    setProgressPercent(0);
    setTurnHistory([]);
    setReport(null);
    setAnswerText("");
    setAnswerTimerSeconds(0);
    setFocusSkills([]);
    setSessionAiInfo("");
    setInterimTranscript("");
    setVoiceEngineLabel("");
    setTtsLoading(false);
    setRoomStage("not_started");
    setInterviewerJoined(false);
    setJoinLoading(false);
    autoSpokenQuestionRef.current = "";
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  };

  const handleStartSimulator = async () => {
    if (role.trim().length < 2) {
      setSimulatorError("Enter a target role before starting.");
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
            role: role.trim(),
            industry: industry.trim() || "General",
            difficulty,
            rounds,
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
      setCurrentQuestion(payload.current_question || "");
      setRoundNumber(payload.round_number || 1);
      setTotalRounds(payload.total_rounds || rounds);
      setProgressPercent(payload.progress_percent || 0);
      setFocusSkills(payload.focus_skills || []);
      setTurnHistory([]);
      setReport(null);
      setAnswerText("");
      setAnswerTimerSeconds(0);
      speechBaseAnswerRef.current = "";
      speechFinalTranscriptRef.current = "";
      setRoomStage("ready_to_join");
      setInterviewerJoined(false);
      setSessionAiInfo(
        payload.ai?.used ? `AI engine active${payload.ai.model ? ` (${payload.ai.model})` : ""}` : "Rules-first mode active"
      );
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          session_id: payload.session_id,
          session_secret: payload.session_secret || "",
        })
      );
      trackEvent("interview_simulator_start", {
        role: role.trim(),
        difficulty,
        rounds: payload.total_rounds || rounds,
      });
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < SIMULATOR_MIN_LOADING_MS) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, SIMULATOR_MIN_LOADING_MS - elapsed));
      }
      setSimulatorError(error instanceof Error ? error.message : "Unable to start simulator right now.");
    } finally {
      setStartLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!sessionId || !sessionSecret) {
      setSimulatorError("Start a simulator session first.");
      return;
    }
    if (answerText.trim().length < 18) {
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
            answer_text: answerText.trim(),
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

      if (payload.turn_feedback) {
        setTurnHistory((previous) => [...previous, payload.turn_feedback as SimulatorTurnFeedback]);
      }
      setRoundNumber(payload.round_number || roundNumber);
      setTotalRounds(payload.total_rounds || totalRounds);
      setProgressPercent(payload.progress_percent || progressPercent);
      setAnswerText("");
      setAnswerTimerSeconds(0);
      setInterimTranscript("");
      speechBaseAnswerRef.current = "";
      speechFinalTranscriptRef.current = "";

      if (payload.completed) {
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
        setCurrentQuestion("");
        setReport(payload.report || null);
        setRoomStage("not_started");
        setInterviewerJoined(false);
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        trackEvent("interview_simulator_complete", {
          rounds_completed: payload.round_number || 0,
          score: clampPercent(payload.report?.overall_score || 0),
        });
      } else {
        setCurrentQuestion(payload.next_question || "");
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
      setFocusSkills(payload.focus_skills || []);
      setTotalRounds(payload.total_rounds || 0);
      if (payload.status === "completed") {
        stopQuestionAudioPlayback();
        clearPrefetchedQuestionAudio();
        setReport(payload.report || null);
        setCurrentQuestion("");
        setAnswerText("");
        setInterimTranscript("");
        speechBaseAnswerRef.current = "";
        speechFinalTranscriptRef.current = "";
        setProgressPercent(100);
        setRoomStage("not_started");
        setInterviewerJoined(false);
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (error) {
      setSimulatorError(error instanceof Error ? error.message : "Unable to refresh report.");
    } finally {
      setLoadingReport(false);
    }
  };

  const startVoiceCapture = async () => {
    if (!speechSupported) {
      setSimulatorError("Speech recognition is not supported in this browser.");
      return;
    }
    if (isListening) return;
    if (!sessionId || report) {
      setSimulatorError("Start a live interview round before using mic capture.");
      return;
    }
    if (roomStage !== "live") {
      setSimulatorError("Join the interview room before using mic capture.");
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setSimulatorError("Mic capture requires HTTPS secure context.");
      return;
    }
    setSimulatorError("");
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setSpeechSupported(false);
      setSimulatorError("Speech recognition is unavailable.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setSimulatorError("Microphone access is not supported in this browser.");
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
      setAnswerText(composeSpeechAnswer(speechBaseAnswerRef.current, speechFinalTranscriptRef.current, interimTranscriptRef.current));
    };
    recognition.onend = () => {
      if (keepListeningRef.current) {
        try {
          recognition.start();
          return;
        } catch {}
      }
      setAnswerText(composeSpeechAnswer(speechBaseAnswerRef.current, speechFinalTranscriptRef.current, interimTranscriptRef.current));
      interimTranscriptRef.current = "";
      setInterimTranscript("");
      speechBaseAnswerRef.current = "";
      speechFinalTranscriptRef.current = "";
      setIsListening(false);
    };
    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const errorCode = (event?.error || "").toLowerCase();
      if (errorCode === "not-allowed" || errorCode === "service-not-allowed" || errorCode === "audio-capture") {
        keepListeningRef.current = false;
        setSimulatorError("Mic capture blocked. Check browser microphone permissions.");
      } else if (errorCode && errorCode !== "aborted" && errorCode !== "no-speech") {
        setSimulatorError(`Mic capture error: ${errorCode}. Try again.`);
      } else if (errorCode === "no-speech") {
        setSimulatorError("No speech detected. Speak closer to mic and retry.");
      }
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
    if (!sessionId || !currentQuestion || report) {
      setSimulatorError("Start an interview session first.");
      return;
    }
    if (roomStage === "live" || joinLoading) return;

    setSimulatorError("");
    setJoinLoading(true);
    setRoomStage("joining");
    setInterviewerJoined(false);
    try {
      await playMeetingJoinChime();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 950));
      setInterviewerJoined(true);
      setRoomStage("live");
      trackEvent("interview_simulator_room_join", {
        round_number: roundNumber || 1,
      });
    } catch {
      setSimulatorError("Unable to join the interview room right now.");
      setRoomStage("ready_to_join");
    } finally {
      setJoinLoading(false);
    }
  };

  const speakCurrentQuestion = async ({
    force = false,
    silentErrors = false,
    trigger = "manual",
  }: {
    force?: boolean;
    silentErrors?: boolean;
    trigger?: "manual" | "auto";
  } = {}) => {
    const questionText = currentQuestion.replace(/\s+/g, " ").trim();
    if (!questionText) return;

    if (isQuestionAudioPlaying && !force) {
      stopQuestionAudioPlayback();
      return;
    }

    if (!silentErrors) {
      setSimulatorError("");
    }
    setTtsLoading(true);
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
        const controller = new AbortController();
        questionAudioAbortRef.current = controller;
        const timeoutHandle = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
        try {
          payload = await fetchAiQuestionAudio(questionText, controller.signal);
        } finally {
          window.clearTimeout(timeoutHandle);
          questionAudioAbortRef.current = null;
        }
      } else {
        questionAudioAbortRef.current = null;
      }

      const audioUrl = URL.createObjectURL(payload.blob);
      questionAudioUrlRef.current = audioUrl;
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      audio.onended = () => {
        setIsQuestionAudioPlaying(false);
      };
      audio.onpause = () => {
        setIsQuestionAudioPlaying(false);
      };
      questionAudioRef.current = audio;
      setVoiceEngineLabel(`AI voice${payload.voiceLabel ? ` (${payload.voiceLabel})` : ""}${payload.modelLabel ? ` • ${payload.modelLabel}` : ""}`);
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
      try {
        playBrowserSpeechFallback(questionText);
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
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
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
      "Turn-by-Turn Feedback:",
      ...turnHistory.flatMap((turn) => [
        `Round ${turn.round_number}: ${turn.question}`,
        `Answer Time: ${turn.response_time_seconds}s | Words: ${turn.answer_word_count}`,
        `Scores: Communication ${turn.scores.communication}% | Clarity ${turn.scores.clarity}% | Domain ${turn.scores.domain_depth}% | Confidence ${turn.scores.confidence}%`,
        `Summary: ${turn.feedback_summary}`,
        `Strengths: ${(turn.strengths || []).join("; ")}`,
        `Improvements: ${(turn.improvements || []).join("; ")}`,
        "",
      ]),
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

  const canStartSession = role.trim().length >= 2 && !startLoading && !submitLoading && !resumeFileUploading && !jdFileUploading;
  const canSubmitAnswer =
    Boolean(sessionId) &&
    Boolean(sessionSecret) &&
    roomStage === "live" &&
    answerText.trim().length >= 18 &&
    !startLoading &&
    !submitLoading &&
    !report &&
    !joinLoading;
  const joinButtonDisabled = !sessionId || Boolean(report) || roomStage === "live" || joinLoading || startLoading;
  const joinButtonLabel = !sessionId
    ? "Start Step 1 First"
    : roomStage === "live"
      ? "Interview Live"
      : joinLoading
        ? "Joining..."
        : "Join Interview Room";

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
            <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/78">Live AI Interview Lab</p>
            <h1 className="mt-3 text-3xl font-semibold text-cyan-50 sm:text-5xl">Interview Simulator</h1>
            <p className="mt-3 max-w-3xl text-sm text-cyan-50/78 sm:text-base">
              Run an adaptive mock interview with live follow-up questions, real-time scoring, and targeted next-step coaching.
            </p>
            <p className="mt-4 rounded-xl border border-cyan-100/22 bg-cyan-100/8 px-3 py-2 text-xs text-cyan-100/80">
              Supports camera preview + voice transcript capture. You can answer by typing or speaking. Guest mode works without login.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3">
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/68">Step 1</p>
                <p className="mt-1 text-xs text-cyan-50/84">Set role, upload/paste resume and JD, then start interview.</p>
              </div>
              <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3">
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/68">Step 2</p>
                <p className="mt-1 text-xs text-cyan-50/84">Click Join Interview Room in Meeting Room panel and let interviewer connect.</p>
              </div>
              <div className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3">
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/68">Step 3</p>
                <p className="mt-1 text-xs text-cyan-50/84">Answer live rounds and get final readiness score + next steps.</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-100/22 bg-[#061a32]/72 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/72">Session Status</p>
            <p className="mt-2 text-sm text-cyan-50/84">{authEmail ? `Signed in as ${authEmail}` : "Guest mode active"}</p>
            <p className="mt-1 text-xs text-cyan-100/74">{wallet ? `Wallet: ${wallet.credits} credits` : "No wallet required in guest mode"}</p>
            {authError ? (
              <div className="mt-3 rounded-xl border border-amber-100/34 bg-amber-100/12 p-3">
                <p className="text-xs text-amber-50">{authError}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-6 grid max-w-[1320px] gap-5 xl:grid-cols-12">
        <aside className="space-y-4 xl:col-span-3">
          <article className="rounded-2xl border border-cyan-100/22 bg-[linear-gradient(160deg,rgba(7,22,43,0.9),rgba(4,14,29,0.95))] p-4 xl:sticky xl:top-24">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Simulation Setup</p>
            <div className="mt-3 grid gap-2">
              <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Target role (required)" className={fieldClass} />
              <input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="Industry (optional)" className={fieldClass} />
              <select
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as "foundation" | "standard" | "advanced")}
                className={fieldClass}
              >
                <option value="foundation">Foundation</option>
                <option value="standard">Standard</option>
                <option value="advanced">Advanced</option>
              </select>
              <select value={rounds} onChange={(event) => setRounds(Number(event.target.value))} className={fieldClass}>
                {[3, 4, 5, 6, 7, 8].map((item) => (
                  <option key={`round-${item}`} value={item}>
                    {item} rounds
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => resumeFileInputRef.current?.click()}
                disabled={resumeFileUploading}
                className="rounded-xl border border-cyan-100/30 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:opacity-60"
              >
                {resumeFileUploading ? "Extracting Resume..." : "Upload Resume File"}
              </button>
              <button
                type="button"
                onClick={() => jdFileInputRef.current?.click()}
                disabled={jdFileUploading}
                className="rounded-xl border border-cyan-100/30 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:opacity-60"
              >
                {jdFileUploading ? "Extracting JD..." : "Upload JD File"}
              </button>
            </div>
            {(resumeUploadedFileName || jdUploadedFileName) && (
              <p className="mt-2 text-[11px] text-cyan-100/76">
                {resumeUploadedFileName ? `Resume: ${resumeUploadedFileName}` : "Resume: not uploaded"} |{" "}
                {jdUploadedFileName ? `JD: ${jdUploadedFileName}` : "JD: not uploaded"}
              </p>
            )}
            <textarea
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              placeholder="Resume context (you can also upload resume file)"
              className={`${textAreaClass} mt-3 min-h-[100px]`}
            />
            <textarea
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              placeholder="JD context (you can also upload JD file)"
              className={`${textAreaClass} mt-3 min-h-[100px]`}
            />
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => void handleStartSimulator()}
                disabled={!canStartSession}
                className="rounded-xl border border-cyan-100/38 bg-gradient-to-r from-cyan-200/20 via-cyan-200/16 to-emerald-200/14 px-3 py-2.5 text-sm font-semibold text-cyan-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {startLoading ? "Initializing Simulator..." : "Start Interview (Step 1)"}
              </button>
              <button
                type="button"
                onClick={resetSimulationState}
                disabled={startLoading || submitLoading}
                className="rounded-xl border border-cyan-100/24 bg-cyan-100/8 px-3 py-2 text-xs font-semibold text-cyan-50/86 transition hover:bg-cyan-100/14 disabled:opacity-60"
              >
                Reset Session
              </button>
            </div>
            {sessionAiInfo && <p className="mt-3 text-xs text-cyan-100/78">{sessionAiInfo}</p>}
            {focusSkills.length > 0 && (
              <div className="mt-3 rounded-xl border border-cyan-100/18 bg-cyan-100/6 p-3">
                <p className="text-[11px] uppercase tracking-[0.11em] text-cyan-100/72">Focus Skills</p>
                <p className="mt-1 text-xs text-cyan-50/82">{focusSkills.slice(0, 10).join(", ")}</p>
              </div>
            )}
            {simulatorError && <p className="mt-3 text-xs text-amber-100">{simulatorError}</p>}
          </article>
        </aside>

        <section className="space-y-5 xl:col-span-6">
          <article className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(8,24,44,0.88),rgba(5,16,31,0.94))] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Live Round</p>
              <div className="text-xs text-cyan-100/76">
                Round {Math.max(0, roundNumber)} / {Math.max(0, totalRounds)}
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full border border-cyan-100/22 bg-cyan-100/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300/75 via-sky-300/80 to-emerald-200/80 transition-all duration-500"
                style={{ width: `${clampPercent(progressPercent)}%` }}
              />
            </div>
            <div className="mt-4 rounded-xl border border-cyan-100/20 bg-cyan-100/6 px-3 py-2 text-xs text-cyan-100/80">
              {!sessionId
                ? "Step 1: Start Interview from the left panel. Then join from the Meeting Room panel below."
                : roomStage === "live"
                  ? "Meeting room connected. Interviewer is live."
                  : "Use the Join Interview Room button in the Meeting Room panel below."}
            </div>
            {currentQuestion && roomStage === "live" ? (
              <div className="mt-4 rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/74">Current Question</p>
                <p className="mt-2 text-sm text-cyan-50/84">{currentQuestion}</p>
              </div>
            ) : report ? (
              <div className="mt-4 rounded-xl border border-emerald-200/24 bg-emerald-200/10 p-3">
                <p className="text-sm font-semibold text-emerald-100">Simulation complete. Report generated.</p>
              </div>
            ) : currentQuestion ? (
              <p className="mt-4 text-sm text-cyan-50/72">Join the interview room to begin live interviewer questions.</p>
            ) : (
              <p className="mt-4 text-sm text-cyan-50/72">Start the simulator to receive your first question.</p>
            )}

            <textarea
              value={answerText}
              onChange={(event) => setAnswerText(event.target.value)}
              placeholder="Speak or type your answer here."
              className={`${textAreaClass} mt-4 min-h-[170px]`}
            />
            <p className="mt-2 text-xs text-cyan-100/74">Tip: keep each answer around 45 to 90 seconds with one clear example.</p>
            {interimTranscript && <p className="mt-2 text-xs text-cyan-100/76">Live transcript: {interimTranscript}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSubmitAnswer()}
                disabled={!canSubmitAnswer}
                className="rounded-xl border border-cyan-100/36 bg-cyan-200/18 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/26 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitLoading ? "Scoring Answer..." : "Submit Answer (Step 2)"}
              </button>
              <button
                type="button"
                onClick={() => void speakCurrentQuestion()}
                disabled={!currentQuestion || roomStage !== "live" || submitLoading || ttsLoading}
                className="rounded-xl border border-cyan-100/28 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16 disabled:opacity-60"
              >
                {ttsLoading ? "Generating AI Voice..." : isQuestionAudioPlaying ? "Stop Question Audio" : "Play Question Audio"}
              </button>
            </div>
            <p className="mt-2 text-xs text-cyan-100/72">Current answer timer: {formatSeconds(answerTimerSeconds)}</p>
            {voiceEngineLabel ? (
              <p className="mt-1 text-xs text-cyan-100/70">Voice Engine: {voiceEngineLabel}</p>
            ) : activeVoiceName ? (
              <p className="mt-1 text-xs text-cyan-100/70">Available Browser Voice: {activeVoiceName}</p>
            ) : null}
            {cameraError && <p className="mt-2 text-xs text-amber-100">{cameraError}</p>}
          </article>

          <article className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(165deg,rgba(4,14,24,0.95),rgba(3,10,18,0.98))] p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Meeting Room</p>
              <p className="text-[11px] text-cyan-100/74">{roomStage === "live" ? "Connected" : roomStage === "joining" ? "Connecting..." : "Lobby"}</p>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="relative overflow-hidden rounded-xl border border-cyan-100/20 bg-[#020911]">
                <p className="absolute left-2 top-2 z-10 rounded-md border border-cyan-100/24 bg-[#041326]/72 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-cyan-100/80">
                  You
                </p>
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  autoPlay
                  className={`h-[220px] w-full object-cover transition ${cameraEnabled ? "opacity-100" : "opacity-0"}`}
                />
                {!cameraEnabled && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-cyan-100/64">
                    Camera off
                  </div>
                )}
              </div>
              <div className="relative overflow-hidden rounded-xl border border-cyan-100/20 bg-[#020911] p-3">
                <p className="absolute left-2 top-2 rounded-md border border-cyan-100/24 bg-[#041326]/72 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-cyan-100/80">
                  Interviewer
                </p>
                <div className="flex h-[220px] flex-col items-center justify-center">
                  <div
                    className={`flex h-20 w-20 items-center justify-center rounded-full border text-2xl font-semibold ${
                      interviewerJoined
                        ? "border-emerald-200/55 bg-emerald-200/14 text-emerald-100"
                        : roomStage === "joining"
                          ? "border-amber-200/55 bg-amber-200/14 text-amber-100"
                          : "border-cyan-100/30 bg-cyan-100/10 text-cyan-100/78"
                    }`}
                  >
                    AI
                  </div>
                  <p className="mt-3 text-sm text-cyan-50/86">
                    {interviewerJoined ? "Interviewer joined" : roomStage === "joining" ? "Joining room..." : "Waiting in lobby"}
                  </p>
                  <p className="mt-1 text-xs text-cyan-100/72">
                    {isQuestionAudioPlaying ? "Asking question..." : roomStage === "live" ? "Live interview in progress" : "Press Join Interview Room"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleJoinInterviewRoom()}
                    disabled={joinButtonDisabled}
                    className="mt-3 rounded-full border border-emerald-200/46 bg-emerald-300/22 px-4 py-2 text-xs font-semibold text-emerald-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {joinButtonLabel}
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-cyan-100/16 bg-[#061426]/70 px-3 py-2">
              <button
                type="button"
                onClick={isListening ? stopVoiceCapture : () => void startVoiceCapture()}
                disabled={!speechSupported || !sessionId || roomStage !== "live" || submitLoading || Boolean(report)}
                className="rounded-full border border-cyan-100/24 bg-cyan-100/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 transition hover:bg-cyan-100/18 disabled:opacity-60"
              >
                {speechSupported ? (isListening ? "Mic On" : "Mic") : "Mic Unsupported"}
              </button>
              <button
                type="button"
                onClick={() => void toggleCameraPreview()}
                disabled={submitLoading}
                className="rounded-full border border-cyan-100/24 bg-cyan-100/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 transition hover:bg-cyan-100/18 disabled:opacity-60"
              >
                {cameraEnabled ? "Camera On" : "Camera"}
              </button>
              <button
                type="button"
                onClick={() => void speakCurrentQuestion()}
                disabled={!currentQuestion || roomStage !== "live" || submitLoading || ttsLoading}
                className="rounded-full border border-cyan-100/24 bg-cyan-100/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 transition hover:bg-cyan-100/18 disabled:opacity-60"
              >
                {ttsLoading ? "Voice..." : "Interviewer Voice"}
              </button>
            </div>
          </article>
        </section>

        <section className="space-y-5 xl:col-span-3">
          <article className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(8,24,44,0.88),rgba(5,16,31,0.94))] p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Live Scoreboard</p>
              <button
                type="button"
                onClick={() => void handleRefreshReport()}
                disabled={!sessionId || loadingReport}
                className="rounded-lg border border-cyan-100/24 bg-cyan-100/8 px-2 py-1 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-100/14 disabled:opacity-60"
              >
                {loadingReport ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            {!latestTurnFeedback ? (
              <p className="mt-3 text-sm text-cyan-50/72">Submit your first answer to see live scoring.</p>
            ) : (
              <div className="mt-3 space-y-2.5">
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
                    <div className="mt-1 h-2 overflow-hidden rounded-full border border-cyan-100/18 bg-[#061a34]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-300 to-emerald-200 transition-all duration-700"
                        style={{ width: `${clampPercent(metric.value)}%` }}
                      />
                    </div>
                  </div>
                ))}
                <p className="rounded-lg border border-cyan-100/18 bg-cyan-100/8 px-2 py-1.5 text-xs text-cyan-100/78">
                  {latestTurnFeedback.feedback_summary}
                </p>
              </div>
            )}
          </article>

          <article className="rounded-2xl border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(8,24,44,0.88),rgba(5,16,31,0.94))] p-5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/74">Turn History</p>
            {turnHistory.length === 0 ? (
              <p className="mt-3 text-sm text-cyan-50/72">No rounds completed yet.</p>
            ) : (
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {turnHistory.map((turn) => (
                  <article key={`turn-${turn.round_number}`} className="rounded-xl border border-cyan-100/16 bg-cyan-100/8 p-2.5">
                    <p className="text-xs font-semibold text-cyan-100">Round {turn.round_number}</p>
                    <p className="mt-1 text-[11px] text-cyan-50/84">{turn.feedback_summary}</p>
                    <p className="mt-1 text-[11px] text-cyan-100/70">
                      Overall {clampPercent(turn.scores.overall || 0)}% • {turn.response_time_seconds}s
                    </p>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>
      </section>

      {report && (
        <section className="mx-auto mt-6 max-w-[1320px] rounded-2xl border border-emerald-200/24 bg-[linear-gradient(160deg,rgba(6,26,42,0.92),rgba(6,18,34,0.96))] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-emerald-100/78">Final Report</p>
              <h2 className="mt-2 text-2xl font-semibold text-cyan-50 sm:text-3xl">Interview Readiness: {clampPercent(report.overall_score)}%</h2>
              <p className="mt-1 text-sm text-cyan-100/80">Readiness band: {report.readiness_label.replace(/_/g, " ")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadSimulatorReport}
                className="rounded-xl border border-emerald-200/28 bg-emerald-200/12 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-200/22"
              >
                Download Report
              </button>
              <button
                type="button"
                onClick={resetSimulationState}
                className="rounded-xl border border-cyan-100/24 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/16"
              >
                Start New Session
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
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
              href={addUtmParams("/interview-copilot", {
                source: "interview_simulator_report",
                medium: "internal",
                campaign: "simulator_to_copilot",
              })}
              eventName="cta_interview_copilot_click"
              eventParams={{ cta_location: "interview_simulator_report", cta_label: "Open Interview Copilot" }}
              className="rounded-xl border border-cyan-100/30 bg-cyan-200/16 px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
            >
              Open Interview Copilot
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
      )}
    </main>
  );
}
