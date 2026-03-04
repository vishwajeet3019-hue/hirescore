"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

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

type AnalysisReportSummary = {
  id: number;
  source: string;
  industry: string;
  role: string;
  overall_score: number | null;
  shortlist_prediction: string;
  created_at: string;
};

type AnalysisReportsPayload = {
  reports?: AnalysisReportSummary[];
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

type RoadmapCelebration = {
  kind: "milestone" | "goal";
  milestoneTitle: string;
  goalTitle: string;
  progressPercent: number;
  completedMilestones: number;
  totalMilestones: number;
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
const downloadFilename = (response: Response, fallback: string) => {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
  return match?.[1] ? decodeURIComponent(match[1].replace(/\"/g, "")) : fallback;
};

export default function DashboardPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [reports, setReports] = useState<AnalysisReportSummary[]>([]);
  const [reportsError, setReportsError] = useState("");
  const [roadmaps, setRoadmaps] = useState<GoalRoadmap[]>([]);
  const [roadmapError, setRoadmapError] = useState("");
  const [roadmapUpdatingMilestoneId, setRoadmapUpdatingMilestoneId] = useState<string | null>(null);
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<number | null>(null);
  const [showAllRoadmapMilestones, setShowAllRoadmapMilestones] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<"roadmaps" | "reports">("roadmaps");
  const [downloadingReportId, setDownloadingReportId] = useState<number | null>(null);
  const [roadmapCelebration, setRoadmapCelebration] = useState<RoadmapCelebration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadDashboard = async () => {
      const authToken = window.localStorage.getItem("hirescore_auth_token") || "";
      if (!authToken) {
        setLoading(false);
        setError("Login required to open dashboard.");
        return;
      }
      setToken(authToken);
      try {
        const response = await fetch(apiUrl("/auth/me"), {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        if (!response.ok) throw new Error("Session expired. Please login again.");
        const payload = (await response.json()) as AuthPayload;
        setEmail(payload.user?.email || "");
        setWallet(payload.wallet || null);
        const [reportsResult, roadmapResult] = await Promise.allSettled([
          fetch(apiUrl("/analysis/reports?limit=30"), {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          }),
          fetch(apiUrl("/roadmap/list?limit=24"), {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          }),
        ]);

        if (reportsResult.status === "fulfilled") {
          if (!reportsResult.value.ok) {
            setReportsError("Unable to load saved reports.");
          } else {
            const reportsPayload = (await reportsResult.value.json()) as AnalysisReportsPayload;
            setReports(Array.isArray(reportsPayload.reports) ? reportsPayload.reports : []);
          }
        } else {
          setReportsError("Unable to load saved reports.");
        }

        if (roadmapResult.status === "fulfilled") {
          if (!roadmapResult.value.ok) {
            setRoadmapError("Unable to load your roadmap right now.");
          } else {
            const roadmapPayload = (await roadmapResult.value.json()) as GoalRoadmapPayload;
            const roadmapTracks = Array.isArray(roadmapPayload.roadmaps)
              ? roadmapPayload.roadmaps
              : roadmapPayload.roadmap
                ? [roadmapPayload.roadmap]
                : [];
            setRoadmaps(roadmapTracks);
            setSelectedRoadmapId(roadmapTracks[0]?.id ?? null);
          }
        } else {
          setRoadmapError("Unable to load your roadmap right now.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load dashboard.");
      } finally {
        setLoading(false);
      }
    };
    void loadDashboard();
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

  const activeRoadmap = useMemo(
    () => roadmaps.find((item) => item.id === selectedRoadmapId) || roadmaps[0] || null,
    [roadmaps, selectedRoadmapId]
  );
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

  const cardClass = "rounded-2xl border border-cyan-100/20 bg-cyan-100/8 p-5";

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
              className="absolute inset-0 bg-[#020a18]/72 backdrop-blur-md"
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
      <section className="mx-auto max-w-6xl">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/72">User Dashboard</p>
        <h1 className="mt-2 text-3xl font-semibold text-cyan-50 sm:text-4xl">Your Progress Hub</h1>
        <p className="mt-2 text-sm text-cyan-50/72">Track wallet usage and continue from the right next step.</p>

        {loading && <p className="mt-5 text-sm text-cyan-100/76">Loading your dashboard...</p>}

        {!loading && error && (
          <div className="mt-5 rounded-xl border border-amber-100/34 bg-amber-100/12 p-4">
            <p className="text-sm text-amber-50">{error}</p>
            <Link
              href="/upload"
              className="mt-3 inline-flex rounded-xl border border-cyan-100/35 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
            >
              Go To Analyze + Login
            </Link>
          </div>
        )}

        {!loading && !error && wallet && (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <article className={cardClass}>
              <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Signed In As</p>
              <p className="mt-2 text-sm font-semibold text-cyan-50">{email || "User"}</p>
              <p className="mt-2 text-xs text-cyan-50/64">Session token active: {token ? "Yes" : "No"}</p>
            </article>
            <article className={cardClass}>
              <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Wallet Balance</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-100">{wallet.credits}</p>
              <p className="mt-1 text-xs text-cyan-50/66">Analyze cost: {wallet.pricing.analyze} credits</p>
            </article>
            <article className={cardClass}>
              <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Estimated Uses Left</p>
              <p className="mt-2 text-3xl font-semibold text-cyan-50">{Math.floor(wallet.credits / Math.max(1, wallet.pricing.analyze))}</p>
              <p className="mt-1 text-xs text-cyan-50/66">Resume AI build: {wallet.pricing.ai_resume_generation} credits</p>
            </article>
          </div>
        )}

        {!loading && !error && (
          <section className="mt-6 rounded-2xl border border-cyan-100/20 bg-cyan-100/8 p-5">
            <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Dashboard Workspaces</p>
            <h2 className="mt-2 text-xl font-semibold text-cyan-50">Choose What You Want To Work On</h2>
            <p className="mt-1 text-sm text-cyan-50/70">Interactive cards keep roadmap tracking and report downloads cleanly separated.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                {
                  id: "roadmaps" as const,
                  title: "Roadmap Tracking",
                  subtitle: "Manage milestones and mark progress clearly",
                  meta: `${roadmaps.length} track${roadmaps.length === 1 ? "" : "s"}`,
                },
                {
                  id: "reports" as const,
                  title: "Report Downloads",
                  subtitle: "Access and download past analysis PDFs",
                  meta: `${reports.length} report${reports.length === 1 ? "" : "s"}`,
                },
              ].map((card) => (
                <motion.button
                  key={card.id}
                  type="button"
                  whileHover={{ y: -3, scale: 1.01 }}
                  whileTap={{ scale: 0.995 }}
                  onClick={() => setActiveWorkspace(card.id)}
                  className={`relative overflow-hidden rounded-2xl border p-4 text-left transition ${
                    activeWorkspace === card.id
                      ? "border-cyan-100/50 bg-cyan-200/18"
                      : "border-cyan-100/20 bg-[#041634]/55 hover:bg-[#072042]/62"
                  }`}
                >
                  <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan-300/18 blur-2xl" />
                  <p className="text-sm font-semibold text-cyan-50">{card.title}</p>
                  <p className="mt-1 text-xs text-cyan-50/72">{card.subtitle}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.12em] text-cyan-100/82">{card.meta}</p>
                </motion.button>
              ))}
            </div>
          </section>
        )}

        {!loading && !error && activeWorkspace === "roadmaps" && (
          <section className="mt-6 rounded-2xl border border-cyan-100/20 bg-cyan-100/8 p-5">
            <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Roadmap Tracking</p>
            <h2 className="mt-2 text-xl font-semibold text-cyan-50">Focused Milestone Workspace</h2>

            {roadmapError && <p className="mt-3 text-xs text-amber-100">{roadmapError}</p>}

            {!activeRoadmap ? (
              <div className="mt-4 rounded-xl border border-cyan-100/16 bg-[#041634]/55 p-4">
                <p className="text-sm text-cyan-50/76">No roadmap generated yet. Run analysis and choose Add To Roadmap when prompted.</p>
                <Link
                  href="/upload"
                  className="mt-3 inline-flex rounded-xl border border-cyan-100/34 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
                >
                  Run Analysis
                </Link>
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
                            </div>

                            <div className="w-full lg:w-[180px]">
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
          <section className="mt-6 rounded-2xl border border-cyan-100/20 bg-cyan-100/8 p-5">
            <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Saved Analysis Reports</p>
            <h2 className="mt-2 text-xl font-semibold text-cyan-50">Download Your Past Reports</h2>
            <p className="mt-1 text-sm text-cyan-50/70">Each analysis is auto-saved to your account dashboard.</p>
            {reportsError && <p className="mt-3 text-xs text-amber-100">{reportsError}</p>}
            {!reports.length ? (
              <p className="mt-4 text-sm text-cyan-50/70">No reports saved yet. Run one analysis to see it here.</p>
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
                        Score: {report.overall_score ?? "N/A"} • {report.shortlist_prediction || "Prediction unavailable"}
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

        {!loading && !error && (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Link
              href="/upload"
              className="rounded-2xl border border-cyan-100/34 bg-cyan-200/15 px-4 py-3 text-center text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
            >
              Run New Analysis
            </Link>
            <Link
              href="/studio"
              className="rounded-2xl border border-cyan-100/34 bg-cyan-100/10 px-4 py-3 text-center text-sm font-semibold text-cyan-50 transition hover:bg-cyan-100/18"
            >
              Build Resume
            </Link>
            <Link
              href="/pricing"
              className="rounded-2xl border border-cyan-100/34 bg-cyan-100/10 px-4 py-3 text-center text-sm font-semibold text-cyan-50 transition hover:bg-cyan-100/18"
            >
              Buy Credits
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
