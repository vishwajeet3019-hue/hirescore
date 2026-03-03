"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  const [roadmap, setRoadmap] = useState<GoalRoadmap | null>(null);
  const [roadmapError, setRoadmapError] = useState("");
  const [roadmapUpdatingMilestoneId, setRoadmapUpdatingMilestoneId] = useState<string | null>(null);
  const [downloadingReportId, setDownloadingReportId] = useState<number | null>(null);
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
          fetch(apiUrl("/roadmap/current"), {
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
            setRoadmap(roadmapPayload.roadmap || null);
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
    setRoadmapError("");
    setRoadmapUpdatingMilestoneId(milestoneId);
    try {
      const response = await fetch(apiUrl(`/roadmap/milestones/${encodeURIComponent(milestoneId)}/toggle`), {
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
      if (!payload.roadmap) {
        throw new Error("Roadmap payload missing.");
      }
      setRoadmap(payload.roadmap);
    } catch (err) {
      setRoadmapError(err instanceof Error ? err.message : "Unable to update this milestone.");
    } finally {
      setRoadmapUpdatingMilestoneId(null);
    }
  };

  const cardClass = "rounded-2xl border border-cyan-100/20 bg-cyan-100/8 p-5";

  return (
    <main className="min-h-screen px-4 pb-16 pt-10 sm:px-6 lg:px-8">
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
            <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/72">Goal Roadmap</p>
            <h2 className="mt-2 text-xl font-semibold text-cyan-50">Progress To Your Target Role</h2>
            <p className="mt-1 text-sm text-cyan-50/70">Complete milestones one-by-one and keep moving toward your goal.</p>

            {roadmapError && <p className="mt-3 text-xs text-amber-100">{roadmapError}</p>}

            {!roadmap ? (
              <div className="mt-4 rounded-xl border border-cyan-100/16 bg-[#041634]/55 p-4">
                <p className="text-sm text-cyan-50/76">No roadmap generated yet. Run your first analysis and close the report to auto-create it.</p>
                <Link
                  href="/upload"
                  className="mt-3 inline-flex rounded-xl border border-cyan-100/34 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
                >
                  Run Analysis
                </Link>
              </div>
            ) : (
              <>
                <div className="mt-4 rounded-xl border border-cyan-100/16 bg-[#041634]/55 p-4">
                  <p className="text-sm font-semibold text-cyan-50">{roadmap.goal_title}</p>
                  {roadmap.goal_context && <p className="mt-1 text-xs text-cyan-50/72">{roadmap.goal_context}</p>}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-cyan-100/72">
                    {roadmap.target_role && <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1">Role: {roadmap.target_role}</span>}
                    {roadmap.target_industry && (
                      <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1">Industry: {roadmap.target_industry}</span>
                    )}
                    <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1">
                      Progress: {roadmap.completed_milestones}/{roadmap.total_milestones}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full border border-cyan-100/18 bg-cyan-100/7">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200 transition-all duration-500"
                      style={{ width: `${roadmap.progress_percent}%` }}
                    />
                  </div>
                </div>

                <ol className="mt-4 space-y-3">
                  {roadmap.milestones.map((milestone, index) => {
                    const updating = roadmapUpdatingMilestoneId === milestone.id;
                    return (
                      <li key={milestone.id} className="rounded-xl border border-cyan-100/16 bg-[#041634]/55 p-4">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => void handleToggleRoadmapMilestone(milestone.id, !milestone.completed)}
                            disabled={updating}
                            className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition ${
                              milestone.completed
                                ? "border-emerald-200/55 bg-emerald-200/25 text-emerald-50"
                                : "border-cyan-100/34 bg-cyan-100/10 text-cyan-50"
                            } disabled:cursor-not-allowed disabled:opacity-55`}
                            aria-label={milestone.completed ? "Mark milestone as incomplete" : "Mark milestone as complete"}
                          >
                            {milestone.completed ? "✓" : index + 1}
                          </button>
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${milestone.completed ? "text-emerald-100" : "text-cyan-50"}`}>{milestone.title}</p>
                            <p className="mt-1 text-xs text-cyan-50/72">{milestone.detail}</p>
                            {milestone.completed_at && (
                              <p className="mt-1 text-[11px] text-emerald-100/80">Completed on {formatReportDate(milestone.completed_at)}</p>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </section>
        )}

        {!loading && !error && (
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
