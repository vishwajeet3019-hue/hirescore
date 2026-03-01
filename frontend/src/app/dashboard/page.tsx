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
        try {
          const reportsResponse = await fetch(apiUrl("/analysis/reports?limit=30"), {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          });
          if (!reportsResponse.ok) throw new Error("Unable to load saved reports.");
          const reportsPayload = (await reportsResponse.json()) as AnalysisReportsPayload;
          setReports(Array.isArray(reportsPayload.reports) ? reportsPayload.reports : []);
        } catch (reportsErr) {
          setReportsError(reportsErr instanceof Error ? reportsErr.message : "Unable to load saved reports.");
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
