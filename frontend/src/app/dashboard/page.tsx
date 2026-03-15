"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { addAuthChangeListener, resolveAuthSession } from "@/lib/public-access";
import { addUtmParams } from "@/lib/utm";
import TrackedLink from "../components/tracked-link";

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

type AuthPayload = {
  user?: {
    email?: string;
    created_at?: string;
  };
  wallet?: CreditWallet;
};

type FeatureFlags = {
  onboarding_copy_variant?: "A" | "B";
  roadmap_prompt_variant?: "A" | "B";
  pricing_cta_variant?: "A" | "B";
};

type AnalysisReportSummary = {
  id: number;
  source: string;
  industry: string;
  role: string;
  overall_score: number | null;
  shortlist_prediction: string;
  created_at: string;
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
  milestones: GoalRoadmapMilestone[];
  total_milestones: number;
  completed_milestones: number;
  progress_percent: number;
  created_at: string;
  updated_at: string;
};

type GoalRoadmapPayload = {
  roadmap?: GoalRoadmap | null;
  roadmaps?: GoalRoadmap[];
  count?: number;
  action?: string;
  created_new_track?: boolean;
  added_milestones?: number;
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

type WeeklyExecutionCoach = {
  title: string;
  coach_note: string;
  week_focus: string;
  next_three_tasks: {
    id: string;
    title: string;
    detail: string;
    timeframe: string;
    done_when: string;
  }[];
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

type DashboardBootstrapPayload = {
  auth?: AuthPayload;
  reports?: AnalysisReportSummary[];
  roadmap?: GoalRoadmap | null;
  roadmaps?: GoalRoadmap[];
  analysis_comparison?: AnalysisComparison;
  weekly_execution_coach?: WeeklyExecutionCoach | null;
  role_benchmark?: RoleBenchmark | null;
  feature_flags?: FeatureFlags;
};

type RoadmapCelebration = {
  kind: "milestone" | "goal";
  milestoneTitle: string;
  goalTitle: string;
  progressPercent: number;
  completedMilestones: number;
  totalMilestones: number;
};

type MilestoneEvidenceDraft = {
  note: string;
  link: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const formatReportDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown time";
  return parsed.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};
const formatReportSource = (value: string) => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "interview_simulator") return "Interview Simulator";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "Analysis";
};
const downloadFilename = (response: Response, fallback: string) => {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
  return match?.[1] ? decodeURIComponent(match[1].replace(/\"/g, "")) : fallback;
};

export default function DashboardPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({});
  const [reports, setReports] = useState<AnalysisReportSummary[]>([]);
  const [reportsError, setReportsError] = useState("");
  const [analysisComparison, setAnalysisComparison] = useState<AnalysisComparison | null>(null);
  const [weeklyCoach, setWeeklyCoach] = useState<WeeklyExecutionCoach | null>(null);
  const [roleBenchmark, setRoleBenchmark] = useState<RoleBenchmark | null>(null);
  const [roadmaps, setRoadmaps] = useState<GoalRoadmap[]>([]);
  const [roadmapError, setRoadmapError] = useState("");
  const [roadmapUpdatingMilestoneId, setRoadmapUpdatingMilestoneId] = useState<string | null>(null);
  const [roadmapSavingEvidenceMilestoneId, setRoadmapSavingEvidenceMilestoneId] = useState<string | null>(null);
  const [milestoneEvidenceDrafts, setMilestoneEvidenceDrafts] = useState<Record<string, MilestoneEvidenceDraft>>({});
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<number | null>(null);
  const [showAllRoadmapMilestones, setShowAllRoadmapMilestones] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<"roadmaps" | "reports">("roadmaps");
  const [downloadingReportId, setDownloadingReportId] = useState<number | null>(null);
  const [roadmapCelebration, setRoadmapCelebration] = useState<RoadmapCelebration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dashboardRunAnalysisHref = addUtmParams("/upload", {
    source: "dashboard",
    medium: "internal",
    campaign: "dashboard",
  });
  const dashboardPricingHref = addUtmParams("/pricing", {
    source: "dashboard",
    medium: "internal",
    campaign: "dashboard",
  });
  const dashboardStudioHref = addUtmParams("/studio", {
    source: "dashboard",
    medium: "internal",
    campaign: "dashboard",
  });
  const dashboardApplicationCopilotHref = addUtmParams("/application-copilot", {
    source: "dashboard",
    medium: "internal",
    campaign: "dashboard",
  });

  useEffect(() => {
    let cancelled = false;
    const loadDashboard = async () => {
      setError("");
      const session = await resolveAuthSession<AuthPayload>();
      if (cancelled) return;
      if (session.error) {
        setLoading(false);
        setError(session.error.message);
        return;
      }
      const authToken = session.token || "";
      if (!authToken) {
        setLoading(false);
        setError("Login required to open dashboard.");
        return;
      }
      setToken(authToken);
      try {
        const response = await fetch(apiUrl("/dashboard/bootstrap?reports_limit=30&roadmap_limit=24"), {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        if (!response.ok) throw new Error("Session expired. Please login again.");
        const payload = (await response.json()) as DashboardBootstrapPayload;
        const authPayload = payload.auth || {};
        const reportsPayload = Array.isArray(payload.reports) ? payload.reports : [];
        const roadmapTracks = Array.isArray(payload.roadmaps)
          ? payload.roadmaps
          : payload.roadmap
            ? [payload.roadmap]
            : [];

        setEmail(authPayload.user?.email || "");
        setWallet(authPayload.wallet || null);
        setFeatureFlags(payload.feature_flags || {});
        setReports(reportsPayload);
        setReportsError("");
        setRoadmaps(roadmapTracks);
        setSelectedRoadmapId(roadmapTracks[0]?.id ?? null);
        setRoadmapError("");
        setAnalysisComparison(payload.analysis_comparison || null);
        setWeeklyCoach(payload.weekly_execution_coach || null);
        setRoleBenchmark(payload.role_benchmark || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load dashboard.");
      } finally {
        setLoading(false);
      }
    };
    void loadDashboard();
    const unsubscribe = addAuthChangeListener(() => {
      setLoading(true);
      void loadDashboard();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!roadmapCelebration) return;
    const timeoutMs = roadmapCelebration.kind === "goal" ? 4200 : 2800;
    const timer = window.setTimeout(() => {
      setRoadmapCelebration(null);
    }, timeoutMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [roadmapCelebration]);

  const handleDownloadReport = async (reportId: number) => {
    if (!token) {
      setError("Login required to download reports.");
      return;
    }
    setReportsError("");
    setDownloadingReportId(reportId);
    try {
      const response = await fetch(apiUrl(`/analysis/reports/${reportId}/download`), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Unable to download this report.");
      }
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = downloadFilename(response, `analysis-report-${reportId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setReportsError(err instanceof Error ? err.message : "Unable to download this report.");
    } finally {
      setDownloadingReportId(null);
    }
  };

  const handleToggleRoadmapMilestone = async (milestoneId: string, completed: boolean) => {
    if (!token) {
      setError("Login required to update roadmap.");
      return;
    }
    const activeRoadmap = roadmaps.find((item) => item.id === selectedRoadmapId) || roadmaps[0];
    if (!activeRoadmap) {
      setRoadmapError("No roadmap track selected.");
      return;
    }
    setRoadmapError("");
    setRoadmapUpdatingMilestoneId(milestoneId);
    try {
      const response = await fetch(apiUrl(`/roadmap/${activeRoadmap.id}/milestones/${encodeURIComponent(milestoneId)}/toggle`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ completed }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Unable to update this milestone.");
      }
      const payload = (await response.json()) as GoalRoadmapPayload;
      const nextTracks = Array.isArray(payload.roadmaps)
        ? payload.roadmaps
        : payload.roadmap
          ? [payload.roadmap]
          : [];
      if (!nextTracks.length) {
        throw new Error("Roadmap payload missing.");
      }

      const resolvedRoadmapId = payload.roadmap?.id || activeRoadmap.id;
      const refreshedActiveRoadmap = nextTracks.find((item) => item.id === resolvedRoadmapId) || nextTracks[0];

      if (completed && refreshedActiveRoadmap) {
        const previousCompletedCount = activeRoadmap.completed_milestones;
        const nextCompletedCount = refreshedActiveRoadmap.completed_milestones;
        if (nextCompletedCount > previousCompletedCount) {
          const milestoneTitle =
            activeRoadmap.milestones.find((item) => item.id === milestoneId)?.title ||
            refreshedActiveRoadmap.milestones.find((item) => item.id === milestoneId)?.title ||
            "Milestone completed";
          const goalReached =
            refreshedActiveRoadmap.total_milestones > 0 &&
            refreshedActiveRoadmap.completed_milestones >= refreshedActiveRoadmap.total_milestones;
          setRoadmapCelebration({
            kind: goalReached ? "goal" : "milestone",
            milestoneTitle,
            goalTitle: refreshedActiveRoadmap.goal_title || "Goal completed",
            progressPercent: refreshedActiveRoadmap.progress_percent,
            completedMilestones: refreshedActiveRoadmap.completed_milestones,
            totalMilestones: refreshedActiveRoadmap.total_milestones,
          });
        }
      }

      setRoadmaps(nextTracks);
      setSelectedRoadmapId(resolvedRoadmapId);
    } catch (err) {
      setRoadmapError(err instanceof Error ? err.message : "Unable to update this milestone.");
    } finally {
      setRoadmapUpdatingMilestoneId(null);
    }
  };

  const handleSaveMilestoneEvidence = async (milestoneId: string) => {
    if (!token) {
      setError("Login required to update roadmap evidence.");
      return;
    }
    const activeRoadmap = roadmaps.find((item) => item.id === selectedRoadmapId) || roadmaps[0];
    if (!activeRoadmap) {
      setRoadmapError("No roadmap track selected.");
      return;
    }

    const draft = milestoneEvidenceDrafts[milestoneId] || { note: "", link: "" };
    setRoadmapError("");
    setRoadmapSavingEvidenceMilestoneId(milestoneId);
    try {
      const response = await fetch(apiUrl(`/roadmap/${activeRoadmap.id}/milestones/${encodeURIComponent(milestoneId)}/evidence`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          note: draft.note,
          link: draft.link,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Unable to save milestone evidence.");
      }
      const payload = (await response.json()) as GoalRoadmapPayload;
      const nextTracks = Array.isArray(payload.roadmaps)
        ? payload.roadmaps
        : payload.roadmap
          ? [payload.roadmap]
          : [];
      if (!nextTracks.length) {
        throw new Error("Roadmap payload missing.");
      }
      const resolvedRoadmapId = payload.roadmap?.id || activeRoadmap.id;
      setRoadmaps(nextTracks);
      setSelectedRoadmapId(resolvedRoadmapId);
    } catch (err) {
      setRoadmapError(err instanceof Error ? err.message : "Unable to save milestone evidence.");
    } finally {
      setRoadmapSavingEvidenceMilestoneId(null);
    }
  };

  const activeRoadmap = useMemo(
    () => roadmaps.find((item) => item.id === selectedRoadmapId) || roadmaps[0] || null,
    [roadmaps, selectedRoadmapId]
  );

  useEffect(() => {
    if (!activeRoadmap) {
      setMilestoneEvidenceDrafts({});
      return;
    }
    const drafts: Record<string, MilestoneEvidenceDraft> = {};
    for (const milestone of activeRoadmap.milestones || []) {
      drafts[milestone.id] = {
        note: milestone.evidence_note || "",
        link: milestone.evidence_link || "",
      };
    }
    setMilestoneEvidenceDrafts(drafts);
  }, [activeRoadmap]);
  const roadmapMilestones = useMemo(() => activeRoadmap?.milestones || [], [activeRoadmap]);
  const nextMilestone = useMemo(
    () => roadmapMilestones.find((milestone) => !milestone.completed) || null,
    [roadmapMilestones]
  );
  const visibleRoadmapMilestones = useMemo(() => {
    if (showAllRoadmapMilestones) return roadmapMilestones;
    const pending = roadmapMilestones.filter((milestone) => !milestone.completed).slice(0, 3);
    const latestCompleted = roadmapMilestones.filter((milestone) => milestone.completed).slice(0, 1);
    return [...pending, ...latestCompleted];
  }, [showAllRoadmapMilestones, roadmapMilestones]);
  const hiddenMilestonesCount = Math.max(0, roadmapMilestones.length - visibleRoadmapMilestones.length);
  const scoreGap =
    activeRoadmap && typeof activeRoadmap.target_score === "number" && typeof activeRoadmap.current_score === "number"
      ? Math.max(0, activeRoadmap.target_score - activeRoadmap.current_score)
      : null;

  const priorityToneClass = (priority?: string | null) => {
    const normalized = (priority || "").toLowerCase();
    if (normalized === "critical") return "border-rose-200/40 bg-rose-200/14 text-rose-100";
    if (normalized === "high") return "border-amber-200/40 bg-amber-200/14 text-amber-100";
    if (normalized === "low") return "border-cyan-200/35 bg-cyan-200/10 text-cyan-100";
    return "border-cyan-100/26 bg-cyan-100/8 text-cyan-100/88";
  };

  const priorityLabel = (priority?: string | null) => {
    const normalized = (priority || "").toLowerCase();
    if (normalized === "critical") return "Critical";
    if (normalized === "high") return "High";
    if (normalized === "low") return "Low";
    return "Medium";
  };
  const formatDelta = (value: number, suffix = "") => {
    const normalized = Number.isFinite(value) ? value : 0;
    const sign = normalized > 0 ? "+" : "";
    return `${sign}${normalized}${suffix}`;
  };
  const estimatedRunsLeft = wallet ? Math.floor(wallet.credits / Math.max(1, wallet.pricing.analyze)) : 0;
  const roadmapProgress = activeRoadmap?.progress_percent ?? 0;
  const premiumNudgeText = roleBenchmark
    ? `Top ${Math.max(1, 100 - roleBenchmark.percentile)}% gap left to dominate your bracket.`
    : "Get premium role benchmarks and conversion signals with more runs.";

  const cardClass =
    "rounded-3xl border border-cyan-100/20 bg-[linear-gradient(150deg,rgba(7,28,52,0.9),rgba(6,20,40,0.86))] p-5 shadow-[0_22px_50px_rgba(2,8,22,0.42)]";

  return (
    <main className="min-h-screen px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <AnimatePresence>
        {roadmapCelebration && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[160] flex items-center justify-center px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-[#020a18]/72 backdrop-blur-[4px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-cyan-100/38 bg-[linear-gradient(150deg,rgba(8,27,52,0.96),rgba(4,18,38,0.95))] shadow-[0_28px_80px_rgba(2,9,24,0.68)]"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 16 }}
              transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <motion.div
                className="absolute -left-14 -top-12 h-44 w-44 rounded-full bg-cyan-300/28 blur-3xl"
                animate={{ scale: [1, 1.25, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div
                className="absolute -bottom-16 -right-10 h-52 w-52 rounded-full bg-emerald-200/22 blur-3xl"
                animate={{ scale: [1.15, 0.95, 1.15], opacity: [0.5, 0.9, 0.5] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-100/80 to-transparent"
                animate={{ opacity: [0.25, 1, 0.25], scaleX: [0.75, 1, 0.75] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />

              <div className="relative z-10 p-5 sm:p-6">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/76">
                  {roadmapCelebration.kind === "goal" ? "Goal Achieved" : "Milestone Completed"}
                </p>
                <h3 className="mt-2 text-xl font-semibold text-cyan-50 sm:text-2xl">
                  {roadmapCelebration.kind === "goal" ? roadmapCelebration.goalTitle : roadmapCelebration.milestoneTitle}
                </h3>
                <p className="mt-2 text-sm text-cyan-50/76">
                  {roadmapCelebration.kind === "goal"
                    ? `All ${roadmapCelebration.totalMilestones} milestones are complete. Your target roadmap is now fully executed.`
                    : `${roadmapCelebration.completedMilestones} of ${roadmapCelebration.totalMilestones} milestones are now complete.`}
                </p>

                <div className="mt-4 overflow-hidden rounded-xl border border-cyan-100/24 bg-cyan-100/8 p-3">
                  <div className="relative h-2 overflow-hidden rounded-full border border-cyan-100/18 bg-[#051730]">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, Math.max(0, roadmapCelebration.progressPercent))}%` }}
                      transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
                    />
                    <motion.div
                      className="absolute inset-y-0 w-20 bg-gradient-to-r from-transparent via-cyan-50/70 to-transparent"
                      animate={{ x: ["-110%", "220%"] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-cyan-100/78">
                    <span>
                      Progress: {roadmapCelebration.completedMilestones}/{roadmapCelebration.totalMilestones}
                    </span>
                    <span>{roadmapCelebration.progressPercent}%</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <section className="mx-auto max-w-[1320px]">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/72">Post-Login Experience</p>
        <h1 className="mt-2 text-3xl font-semibold text-cyan-50 sm:text-5xl">HireScore Growth Cockpit</h1>
        <p className="mt-2 max-w-3xl text-sm text-cyan-50/72">
          Built to persuade action: clear momentum, clear execution, clear ROI.
        </p>

        {loading && <p className="mt-5 text-sm text-cyan-100/76">Loading your dashboard...</p>}

        {!loading && error && (
          <div className="mt-5 rounded-xl border border-amber-100/34 bg-amber-100/12 p-4">
            <p className="text-sm text-amber-50">{error}</p>
            <TrackedLink
              href={dashboardRunAnalysisHref}
              eventName="cta_check_my_score_click"
              eventParams={{ cta_location: "dashboard_error", cta_label: "Go To Analyze + Login" }}
              className="mt-3 inline-flex rounded-xl border border-cyan-100/35 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
            >
              Go To Analyze + Login
            </TrackedLink>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="mt-6 grid gap-4 xl:grid-cols-12">
              <section className="xl:col-span-8 rounded-[2rem] border border-cyan-100/26 bg-[linear-gradient(130deg,rgba(8,33,58,0.95)_0%,rgba(9,25,44,0.94)_56%,rgba(40,29,16,0.82)_100%)] p-5 shadow-[0_28px_65px_rgba(2,8,22,0.45)] sm:p-7">
                <h2 className="mt-3 text-2xl font-semibold text-cyan-50 sm:text-4xl">Improve your profile to get more interview calls.</h2>
                <p className="mt-1 break-all text-xs uppercase tracking-[0.12em] text-cyan-100/74">Profile: {email || "User"}</p>
                <p className="mt-2 text-sm text-cyan-50/74">
                  {nextMilestone
                    ? `Next highest-impact move: ${nextMilestone.title}`
                    : "Start a fresh analysis to unlock your next growth track."}
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <article className="rounded-2xl border border-cyan-100/22 bg-[#071f39]/72 p-4">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/70">Wallet</p>
                    <p className="mt-1 text-3xl font-semibold text-emerald-100">{wallet?.credits ?? 0}</p>
                    <p className="text-xs text-cyan-100/64">Credits available</p>
                  </article>
                  <article className="rounded-2xl border border-cyan-100/22 bg-[#071f39]/72 p-4">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/70">Roadmap</p>
                    <p className="mt-1 text-3xl font-semibold text-cyan-50">{roadmapProgress}%</p>
                    <p className="text-xs text-cyan-100/64">Execution complete</p>
                  </article>
                  <article className="rounded-2xl border border-cyan-100/22 bg-[#071f39]/72 p-4">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/70">Runs Left</p>
                    <p className="mt-1 text-3xl font-semibold text-cyan-50">{estimatedRunsLeft}</p>
                    <p className="text-xs text-cyan-100/64">At {wallet?.pricing.analyze ?? 0} credits/run</p>
                  </article>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <article className="rounded-2xl border border-cyan-100/20 bg-cyan-100/8 p-4">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/70">Latest Momentum</p>
                    {analysisComparison?.latest ? (
                      <>
                        <p className="mt-1 text-sm font-semibold text-cyan-50">
                          {analysisComparison.latest.role || "Latest run"} • {analysisComparison.latest.overall_score}%
                        </p>
                        <p className="mt-1 text-xs text-cyan-100/70">
                          Confidence {analysisComparison.latest.confidence}% • {formatReportDate(analysisComparison.latest.created_at)}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-cyan-50/72">No latest run yet. Launch analysis to start trend tracking.</p>
                    )}
                  </article>
                  <article className="rounded-2xl border border-amber-100/22 bg-amber-100/10 p-4">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-amber-100/80">Upgrade Signal</p>
                    <p className="mt-1 text-sm font-semibold text-amber-50">More runs = sharper positioning = higher shortlist odds.</p>
                    <p className="mt-1 text-xs text-amber-100/74">{premiumNudgeText}</p>
                  </article>
                </div>
              </section>

              <aside className="xl:col-span-4 rounded-[2rem] border border-amber-100/28 bg-[linear-gradient(160deg,rgba(51,35,12,0.72),rgba(16,23,36,0.96))] p-5 shadow-[0_28px_65px_rgba(2,8,22,0.45)] sm:p-6">
                <p className="text-xs uppercase tracking-[0.14em] text-amber-100/76">Premium Advantage</p>
                <h3 className="mt-2 text-2xl font-semibold text-amber-50">Increase Interview Velocity</h3>
                <p className="mt-2 text-sm text-amber-50/82">
                  Purchase credits to run focused analyses weekly, keep roadmap momentum, and improve callback conversion faster.
                </p>
                <div className="mt-4 space-y-2 rounded-2xl border border-amber-100/24 bg-[#2b2516]/45 p-4 text-sm text-amber-50/86">
                  <p>Analyze cost: {wallet?.pricing.analyze ?? 0} credits</p>
                  <p>Resume AI build: {wallet?.pricing.ai_resume_generation ?? 0} credits</p>
                  <p>ATS PDF download: {wallet?.pricing.template_pdf_download ?? 0} credits</p>
                </div>
                <TrackedLink
                  href={dashboardPricingHref}
                  eventName="cta_view_premium_plans_click"
                  eventParams={{ cta_location: "dashboard_sidebar", cta_label: "Upgrade Credits Now" }}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-amber-100/42 bg-amber-200/22 px-4 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-200/30"
                >
                  Upgrade Credits Now
                </TrackedLink>
                <TrackedLink
                  href={dashboardRunAnalysisHref}
                  eventName="cta_check_my_score_click"
                  eventParams={{ cta_location: "dashboard_sidebar", cta_label: "Run Analysis First" }}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-cyan-100/32 bg-cyan-100/10 px-4 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-100/18"
                >
                  Run Analysis First
                </TrackedLink>
              </aside>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <TrackedLink
                href={dashboardRunAnalysisHref}
                eventName="cta_check_my_score_click"
                eventParams={{ cta_location: "dashboard_tiles", cta_label: "Run New Analysis" }}
                className="rounded-2xl border border-cyan-100/28 bg-[#0a223d]/80 px-4 py-4 text-left transition hover:bg-[#0e2b4c]"
              >
                <p className="text-sm font-semibold text-cyan-50">Run New Analysis</p>
                <p className="mt-1 text-xs text-cyan-100/72">Get fresh shortlist and callback intelligence.</p>
              </TrackedLink>
              <TrackedLink
                href={dashboardStudioHref}
                eventName="cta_studio_open"
                eventParams={{ cta_location: "dashboard_tiles", cta_label: "Resume Studio" }}
                className="rounded-2xl border border-cyan-100/28 bg-[#0a223d]/80 px-4 py-4 text-left transition hover:bg-[#0e2b4c]"
              >
                <p className="text-sm font-semibold text-cyan-50">Resume Studio</p>
                <p className="mt-1 text-xs text-cyan-100/72">Apply fixes with guided resume writing workflows.</p>
              </TrackedLink>
              <TrackedLink
                href={dashboardApplicationCopilotHref}
                eventName="cta_application_copilot_open"
                eventParams={{ cta_location: "dashboard_tiles", cta_label: "Application Copilot" }}
                className="rounded-2xl border border-cyan-100/28 bg-[#0a223d]/80 px-4 py-4 text-left transition hover:bg-[#0e2b4c]"
              >
                <p className="text-sm font-semibold text-cyan-50">Application Copilot</p>
                <p className="mt-1 text-xs text-cyan-100/72">Run JD match, resume fixes, and interview prep in one flow.</p>
              </TrackedLink>
              <button
                type="button"
                onClick={() => setActiveWorkspace("roadmaps")}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  activeWorkspace === "roadmaps"
                    ? "border-emerald-100/45 bg-emerald-200/18"
                    : "border-cyan-100/28 bg-[#0a223d]/80 hover:bg-[#0e2b4c]"
                }`}
              >
                <p className="text-sm font-semibold text-cyan-50">Roadmap Control</p>
                <p className="mt-1 text-xs text-cyan-100/72">Track milestones and execution evidence.</p>
              </button>
              <button
                type="button"
                onClick={() => setActiveWorkspace("reports")}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  activeWorkspace === "reports"
                    ? "border-emerald-100/45 bg-emerald-200/18"
                    : "border-cyan-100/28 bg-[#0a223d]/80 hover:bg-[#0e2b4c]"
                }`}
              >
                <p className="text-sm font-semibold text-cyan-50">Report Vault</p>
                <p className="mt-1 text-xs text-cyan-100/72">Download past analysis reports instantly.</p>
              </button>
            </div>

            <section className="mt-6 grid gap-4 lg:grid-cols-3">
              <article className={cardClass}>
                <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/72">Latest Analysis Delta</p>
                {analysisComparison?.latest ? (
                  <>
                    <p className="mt-2 text-sm font-semibold text-cyan-50">
                      {analysisComparison.latest.role || "Latest run"} • {formatReportDate(analysisComparison.latest.created_at)}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2 py-1.5 text-cyan-100/82">
                        Score {analysisComparison.latest.overall_score}%
                      </div>
                      <div className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2 py-1.5 text-cyan-100/82">
                        Confidence {analysisComparison.latest.confidence}%
                      </div>
                    </div>
                    {analysisComparison.delta && (
                      <p className="mt-2 text-xs text-emerald-100/88">
                        Score {formatDelta(analysisComparison.delta.overall_score)} • Callback{" "}
                        {formatDelta(analysisComparison.delta.estimated_callback_rate, "%")}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-cyan-50/72">Run analysis to unlock trend delta.</p>
                )}
              </article>

              <article className={cardClass}>
                <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/72">Weekly Execution Coach</p>
                {weeklyCoach ? (
                  <>
                    <p className="mt-2 text-sm font-semibold text-cyan-50">{weeklyCoach.week_focus}</p>
                    <p className="mt-1 text-xs text-cyan-50/70">{weeklyCoach.coach_note}</p>
                    <ul className="mt-3 space-y-1.5 text-xs text-cyan-100/82">
                      {(weeklyCoach.next_three_tasks || []).slice(0, 3).map((task) => (
                        <li key={task.id || task.title}>• {task.title}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-cyan-50/72">No coach actions yet. Add your first roadmap track.</p>
                )}
              </article>

              <article className={cardClass}>
                <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/72">Role Benchmark</p>
                {roleBenchmark ? (
                  <>
                    <p className="mt-2 text-sm font-semibold text-cyan-50">
                      {roleBenchmark.band_label} • {roleBenchmark.percentile}th percentile
                    </p>
                    <p className="mt-1 text-xs text-cyan-50/70">
                      {roleBenchmark.role} • {roleBenchmark.industry}
                    </p>
                    <p className="mt-1 text-xs text-cyan-100/82">
                      Peer sample: {roleBenchmark.peer_count} • Score: {roleBenchmark.score}%
                    </p>
                    {roleBenchmark.benchmarks && (
                      <p className="mt-2 text-[11px] text-cyan-100/74">
                        P50 {roleBenchmark.benchmarks.p50}% • P75 {roleBenchmark.benchmarks.p75}% • P90 {roleBenchmark.benchmarks.p90}%
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-cyan-50/72">Benchmark appears after your first analysis report.</p>
                )}
              </article>
            </section>

            <section className="mt-6 rounded-[2rem] border border-cyan-100/22 bg-[linear-gradient(145deg,rgba(8,29,55,0.84),rgba(5,18,36,0.82))] p-5 shadow-[0_20px_55px_rgba(2,8,22,0.45)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/72">Workspace Navigator</p>
                  <h2 className="mt-2 text-xl font-semibold text-cyan-50">Choose Your Execution Lane</h2>
                  <p className="mt-1 text-sm text-cyan-50/70">
                    {featureFlags.roadmap_prompt_variant === "B"
                      ? "Switch between roadmap execution and report downloads based on your current objective."
                      : "Use focused workspace modes to keep actions clear and high-converting."}
                  </p>
                </div>
                <div className="flex rounded-xl border border-cyan-100/24 bg-cyan-100/8 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveWorkspace("roadmaps")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeWorkspace === "roadmaps" ? "bg-cyan-200/22 text-cyan-50" : "text-cyan-100/74"
                    }`}
                  >
                    Roadmap
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveWorkspace("reports")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeWorkspace === "reports" ? "bg-cyan-200/22 text-cyan-50" : "text-cyan-100/74"
                    }`}
                  >
                    Reports
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        {!loading && !error && activeWorkspace === "roadmaps" && (
          <section className="mt-6 rounded-[2rem] border border-emerald-100/24 bg-[linear-gradient(145deg,rgba(8,39,47,0.86),rgba(6,20,30,0.9))] p-5 shadow-[0_20px_55px_rgba(2,8,22,0.45)]">
            <p className="text-xs uppercase tracking-[0.14em] text-emerald-100/76">Roadmap Tracking</p>
            <h2 className="mt-2 text-xl font-semibold text-emerald-50">Growth Roadmap Engine</h2>

            {roadmapError && <p className="mt-3 text-xs text-amber-100">{roadmapError}</p>}

            {!activeRoadmap ? (
              <div className="mt-4 rounded-xl border border-cyan-100/16 bg-[#041634]/55 p-4">
                <p className="text-sm text-cyan-50/76">No roadmap generated yet. Run analysis and choose Add To Roadmap when prompted.</p>
                <TrackedLink
                  href={dashboardRunAnalysisHref}
                  eventName="cta_check_my_score_click"
                  eventParams={{ cta_location: "dashboard_reports", cta_label: "Run Analysis" }}
                  className="mt-3 inline-flex rounded-xl border border-cyan-100/34 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
                >
                  Run Analysis
                </TrackedLink>
              </div>
            ) : (
              <>
                {roadmaps.length > 1 && (
                  <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                    {roadmaps.map((track, index) => (
                      <button
                        key={track.id}
                        type="button"
                        onClick={() => {
                          setSelectedRoadmapId(track.id);
                          setShowAllRoadmapMilestones(false);
                        }}
                        className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs transition ${
                          selectedRoadmapId === track.id
                            ? "border-cyan-100/50 bg-cyan-200/18 text-cyan-50"
                            : "border-cyan-100/24 bg-cyan-100/8 text-cyan-100/80 hover:bg-cyan-100/12"
                        }`}
                      >
                        <p className="font-semibold">Track {index + 1}</p>
                        <p className="mt-0.5 text-[11px]">{track.target_role || "Role track"}</p>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="rounded-xl border border-cyan-100/16 bg-[#041634]/55 p-4">
                    <p className="text-sm font-semibold text-cyan-50">{activeRoadmap.goal_title}</p>
                    {activeRoadmap.goal_context && <p className="mt-1 text-xs text-cyan-50/72">{activeRoadmap.goal_context}</p>}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-cyan-100/72">
                      {activeRoadmap.target_role && <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1">Role: {activeRoadmap.target_role}</span>}
                      {activeRoadmap.target_industry && (
                        <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1">Industry: {activeRoadmap.target_industry}</span>
                      )}
                      <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1">
                        {activeRoadmap.progress_percent}% complete
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full border border-cyan-100/18 bg-cyan-100/7">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200 transition-all duration-500"
                        style={{ width: `${activeRoadmap.progress_percent}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-cyan-100/70">
                      {activeRoadmap.completed_milestones}/{activeRoadmap.total_milestones} milestones completed.
                    </p>
                  </div>

                  <div className="rounded-xl border border-emerald-100/22 bg-emerald-200/8 p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-emerald-100/82">How To Update Progress</p>
                    <p className="mt-2 text-sm text-emerald-50/88">
                      Click <span className="font-semibold">Mark Complete</span> on each milestone card.
                    </p>
                    {nextMilestone && (
                      <div className="mt-3 rounded-lg border border-emerald-100/28 bg-emerald-200/12 p-2.5">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-emerald-100/80">Current Focus</p>
                        <p className="mt-1 text-sm font-semibold text-emerald-50">{nextMilestone.title}</p>
                      </div>
                    )}
                    {scoreGap !== null && (
                      <p className="mt-3 text-xs text-emerald-50/82">
                        Score gap to target: <span className="font-semibold">+{scoreGap} points</span>
                      </p>
                    )}
                  </div>
                </div>

                {!visibleRoadmapMilestones.length ? (
                  <p className="mt-4 rounded-xl border border-cyan-100/16 bg-[#041634]/55 px-3 py-2 text-sm text-cyan-50/76">
                    No milestones available yet for this track.
                  </p>
                ) : (
                  <ol className="mt-4 space-y-3">
                    {visibleRoadmapMilestones.map((milestone, index) => {
                      const originalIndex = roadmapMilestones.findIndex((item) => item.id === milestone.id);
                      const stepIndex = originalIndex >= 0 ? originalIndex + 1 : index + 1;
                      const updating = roadmapUpdatingMilestoneId === milestone.id;
                      return (
                        <li key={milestone.id} className="rounded-xl border border-cyan-100/16 bg-[#041634]/55 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.11em]">
                                <span className="rounded-full border border-cyan-100/26 bg-cyan-100/8 px-2 py-1 text-cyan-100/82">Step {stepIndex}</span>
                                {milestone.category && (
                                  <span className="rounded-full border border-cyan-100/26 bg-cyan-100/8 px-2 py-1 text-cyan-100/82">{milestone.category}</span>
                                )}
                                {milestone.timeframe && (
                                  <span className="rounded-full border border-cyan-100/26 bg-cyan-100/8 px-2 py-1 text-cyan-100/82">{milestone.timeframe}</span>
                                )}
                                <span className={`rounded-full border px-2 py-1 ${priorityToneClass(milestone.priority)}`}>
                                  {priorityLabel(milestone.priority)}
                                </span>
                              </div>

                              <p className={`mt-2 text-base font-semibold ${milestone.completed ? "text-emerald-100" : "text-cyan-50"}`}>{milestone.title}</p>
                              <p className="mt-1 text-sm text-cyan-50/74">{milestone.detail}</p>

                              {Array.isArray(milestone.focus_skills) && milestone.focus_skills.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {milestone.focus_skills.map((skill) => (
                                    <span key={`${milestone.id}-${skill}`} className="rounded-md border border-cyan-100/22 bg-cyan-100/8 px-2 py-1 text-[11px] text-cyan-100/82">
                                      {skill}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {milestone.done_when && <p className="mt-2 text-xs text-emerald-100/82">Done when: {milestone.done_when}</p>}
                              {milestone.completed_at && (
                                <p className="mt-1 text-[11px] text-emerald-100/80">Completed on {formatReportDate(milestone.completed_at)}</p>
                              )}
                              {milestone.evidence_updated_at && (
                                <p className="mt-1 text-[11px] text-cyan-100/76">Evidence updated {formatReportDate(milestone.evidence_updated_at)}</p>
                              )}

                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <input
                                  type="text"
                                  value={milestoneEvidenceDrafts[milestone.id]?.note || ""}
                                  onChange={(event) =>
                                    setMilestoneEvidenceDrafts((prev) => ({
                                      ...prev,
                                      [milestone.id]: {
                                        note: event.target.value,
                                        link: prev[milestone.id]?.link || "",
                                      },
                                    }))
                                  }
                                  placeholder="Evidence note"
                                  className="rounded-lg border border-cyan-100/24 bg-cyan-100/8 px-3 py-2 text-xs text-cyan-50 placeholder:text-cyan-100/42 outline-none transition focus:border-cyan-100/55"
                                />
                                <input
                                  type="url"
                                  value={milestoneEvidenceDrafts[milestone.id]?.link || ""}
                                  onChange={(event) =>
                                    setMilestoneEvidenceDrafts((prev) => ({
                                      ...prev,
                                      [milestone.id]: {
                                        note: prev[milestone.id]?.note || "",
                                        link: event.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Proof link (optional)"
                                  className="rounded-lg border border-cyan-100/24 bg-cyan-100/8 px-3 py-2 text-xs text-cyan-50 placeholder:text-cyan-100/42 outline-none transition focus:border-cyan-100/55"
                                />
                              </div>
                            </div>

                            <div className="w-full lg:w-[190px]">
                              <button
                                type="button"
                                onClick={() => void handleToggleRoadmapMilestone(milestone.id, !milestone.completed)}
                                disabled={updating}
                                className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${
                                  milestone.completed
                                    ? "border-amber-100/32 bg-amber-100/14 text-amber-50 hover:bg-amber-100/20"
                                    : "border-emerald-200/40 bg-emerald-200/18 text-emerald-50 hover:bg-emerald-200/24"
                                }`}
                                aria-label={milestone.completed ? "Mark milestone as incomplete" : "Mark milestone as complete"}
                              >
                                {updating ? "Updating..." : milestone.completed ? "Mark Incomplete" : "Mark Complete"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleSaveMilestoneEvidence(milestone.id)}
                                disabled={roadmapSavingEvidenceMilestoneId === milestone.id}
                                className="mt-2 w-full rounded-lg border border-cyan-100/28 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/14 disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                {roadmapSavingEvidenceMilestoneId === milestone.id ? "Saving..." : "Save Evidence"}
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {(hiddenMilestonesCount > 0 || showAllRoadmapMilestones) && (
                  <button
                    type="button"
                    onClick={() => setShowAllRoadmapMilestones((prev) => !prev)}
                    className="mt-4 rounded-xl border border-cyan-100/28 bg-cyan-100/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/14"
                  >
                    {showAllRoadmapMilestones ? "Show Focused View" : `Show All Milestones (+${hiddenMilestonesCount})`}
                  </button>
                )}
              </>
            )}
          </section>
        )}

        {!loading && !error && activeWorkspace === "reports" && (
          <section className="mt-6 rounded-[2rem] border border-amber-100/28 bg-[linear-gradient(145deg,rgba(45,33,14,0.78),rgba(13,20,33,0.92))] p-5 shadow-[0_20px_55px_rgba(2,8,22,0.45)]">
            <p className="text-xs uppercase tracking-[0.14em] text-amber-100/76">Saved Analysis Reports</p>
            <h2 className="mt-2 text-xl font-semibold text-amber-50">Offer Intelligence Archive</h2>
            <p className="mt-1 text-sm text-cyan-50/70">Each analysis and completed interview simulator report is auto-saved to your account dashboard.</p>
            {reportsError && <p className="mt-3 text-xs text-amber-100">{reportsError}</p>}
            {!reports.length ? (
              <p className="mt-4 text-sm text-cyan-50/70">No reports saved yet. Run analysis or complete an interview simulation while signed in to see reports here.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {reports.map((report) => (
                  <article
                    key={report.id}
                    className="flex flex-col gap-3 rounded-xl border border-cyan-100/16 bg-[#041634]/55 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-cyan-50">{report.role || "Target role not set"}</p>
                      <p className="mt-1 text-xs text-cyan-50/72">
                        {report.industry || "General"} • {formatReportDate(report.created_at)}
                      </p>
                      <p className="mt-1 text-xs text-cyan-50/68">
                        {formatReportSource(report.source)} • Score: {report.overall_score ?? "N/A"} •{" "}
                        {report.shortlist_prediction || "Prediction unavailable"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDownloadReport(report.id)}
                      disabled={downloadingReportId === report.id}
                      className="rounded-xl border border-cyan-100/34 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {downloadingReportId === report.id ? "Downloading..." : "Download PDF"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

      </section>
    </main>
  );
}
