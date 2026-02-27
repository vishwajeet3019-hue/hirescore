"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJsonWithWakeAndRetry, warmBackend } from "@/lib/backend-warm";

type AdminAnalytics = {
  users_total: number;
  signups_total: number;
  logins_total: number;
  analyses_total: number;
  feedback_total: number;
  feedback_avg_rating: number;
  payments_total: number;
  credits_sold_total: number;
  revenue_inr_total: number;
  stripe_enabled: boolean;
  razorpay_enabled?: boolean;
  payment_gateway?: string;
};

type AdminUser = {
  id: number;
  name: string;
  email: string;
  plan: string;
  credits: number;
  created_at: string;
  analyze_count: number;
  feedback_submitted: boolean;
  feedback_required: boolean;
};

type AdminEvent = {
  id: number;
  user_id: number | null;
  email: string;
  event_type: string;
  event_name: string;
  meta: Record<string, unknown>;
  created_at: string;
};

type AdminFeedback = {
  id: number;
  user_id: number;
  email: string;
  rating: number;
  comment: string;
  source: string;
  created_at: string;
};

type AdminCreditTx = {
  id: number;
  user_id: number;
  email: string;
  action: string;
  delta: number;
  balance_after: number;
  meta: Record<string, unknown>;
  created_at: string;
};

type AdminChatThread = {
  user_id: number;
  name: string;
  email: string;
  plan: string;
  credits: number;
  total_messages: number;
  unread_by_admin: number;
  unread_by_user: number;
  last_sender_role: string;
  last_message: string;
  last_created_at: string;
};

type AdminChatMessage = {
  id: number;
  user_id: number;
  sender_role: string;
  message: string;
  created_at: string;
};

type AdminChatUser = {
  id: number;
  name: string;
  email: string;
  plan: string;
  credits: number;
};

type RowEditorState = {
  name: string;
  email: string;
  password: string;
  plan: string;
  creditsSet: string;
  delta: string;
  reason: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const AUTH_REQUEST_TIMEOUT_MS = 70000;

const defaultRowEditor = (): RowEditorState => ({
  name: "",
  email: "",
  password: "",
  plan: "",
  creditsSet: "",
  delta: "",
  reason: "",
});

const planOptions = ["all", "free", "starter", "pro", "elite"] as const;

const formatDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AdminPage() {
  const [adminLoginId, setAdminLoginId] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminToken, setAdminToken] = useState("");

  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<(typeof planOptions)[number]>("all");

  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [feedbackRows, setFeedbackRows] = useState<AdminFeedback[]>([]);
  const [transactions, setTransactions] = useState<AdminCreditTx[]>([]);
  const [chatThreads, setChatThreads] = useState<AdminChatThread[]>([]);
  const [activeChatUser, setActiveChatUser] = useState<AdminChatUser | null>(null);
  const [chatMessages, setChatMessages] = useState<AdminChatMessage[]>([]);
  const [chatReplyText, setChatReplyText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [activityTab, setActivityTab] = useState<"feedback" | "events" | "credits">("feedback");

  const [rowEditors, setRowEditors] = useState<Record<number, RowEditorState>>({});
  const [rowBusy, setRowBusy] = useState<Record<number, boolean>>({});
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  const canLoad = useMemo(() => adminToken.trim().length > 0, [adminToken]);

  useEffect(() => {
    void warmBackend(apiUrl);
  }, []);

  useEffect(() => {
    const existingToken = window.localStorage.getItem("hirescore_admin_token");
    const existingLogin = window.localStorage.getItem("hirescore_admin_login_id");
    if (existingToken) {
      setAdminToken(existingToken);
    }
    if (existingLogin) {
      setAdminLoginId(existingLogin);
    }
  }, []);

  const getRowEditor = (userId: number): RowEditorState => rowEditors[userId] || defaultRowEditor();

  const setRowEditor = (userId: number, updater: (prev: RowEditorState) => RowEditorState) => {
    setRowEditors((prev) => {
      const current = prev[userId] || defaultRowEditor();
      return {
        ...prev,
        [userId]: updater(current),
      };
    });
  };

  const adminFetch = async <T,>(path: string, init?: RequestInit, tokenOverride?: string): Promise<T> => {
    const effectiveToken = (tokenOverride ?? adminToken).trim();
    return fetchJsonWithWakeAndRetry<T>({
      apiUrl,
      path,
      init: {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${effectiveToken}`,
          ...(init?.headers || {}),
        },
      },
      timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      parseError: async (response) => {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        return payload?.detail || `Request failed (${response.status})`;
      },
      abortErrorMessage: "Server wake-up is taking longer than expected. Please wait 10-20 seconds and try again.",
    });
  };

  const loadAdminData = async (tokenOverride?: string) => {
    const effectiveToken = (tokenOverride ?? adminToken).trim();
    if (!effectiveToken) return;
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const query = new URLSearchParams();
      query.set("limit", "120");
      if (search.trim()) query.set("q", search.trim());
      if (planFilter !== "all") query.set("plan", planFilter);
      const chatQuery = new URLSearchParams();
      chatQuery.set("limit", "120");
      if (search.trim()) chatQuery.set("q", search.trim());

      const [analyticsData, usersData, eventsData, feedbackData, txData, chatsData] = await Promise.all([
        adminFetch<AdminAnalytics>("/admin/analytics", undefined, effectiveToken),
        adminFetch<{ users: AdminUser[] }>(`/admin/users?${query.toString()}`, undefined, effectiveToken),
        adminFetch<{ events: AdminEvent[] }>("/admin/events?limit=120", undefined, effectiveToken),
        adminFetch<{ feedback: AdminFeedback[] }>("/admin/feedback?limit=120", undefined, effectiveToken),
        adminFetch<{ transactions: AdminCreditTx[] }>("/admin/credit-transactions?limit=120", undefined, effectiveToken),
        adminFetch<{ threads: AdminChatThread[] }>(`/admin/chats?${chatQuery.toString()}`, undefined, effectiveToken),
      ]);

      setAnalytics(analyticsData);
      setUsers(usersData.users || []);
      setEvents(eventsData.events || []);
      setFeedbackRows(feedbackData.feedback || []);
      setTransactions(txData.transactions || []);
      const nextThreads = chatsData.threads || [];
      setChatThreads(nextThreads);
      setActiveChatUser((prev) => {
        if (!prev) return null;
        const matching = nextThreads.find((item) => item.user_id === prev.id);
        if (!matching) return null;
        return {
          id: matching.user_id,
          name: matching.name,
          email: matching.email,
          plan: matching.plan,
          credits: matching.credits,
        };
      });
      setConnected(true);
      window.localStorage.setItem("hirescore_admin_token", effectiveToken);
      if (adminLoginId.trim()) {
        window.localStorage.setItem("hirescore_admin_login_id", adminLoginId.trim());
      }
    } catch (err) {
      setConnected(false);
      setError(err instanceof Error ? err.message : "Unable to load admin data.");
      if (err instanceof Error && err.message.toLowerCase().includes("authentication")) {
        setAdminToken("");
        window.localStorage.removeItem("hirescore_admin_token");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    const loginId = adminLoginId.trim();
    const password = adminPassword;
    if (!loginId || !password) {
      setError("Enter admin login id and password.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const payload = await fetchJsonWithWakeAndRetry<{ admin_token?: string }>({
        apiUrl,
        path: "/admin/auth/login",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login_id: loginId, password }),
        },
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        parseError: async (response) => {
          const parsed = (await response.json().catch(() => null)) as { detail?: string } | null;
          return parsed?.detail || "Invalid admin login.";
        },
        abortErrorMessage: "Server wake-up is taking longer than expected. Please wait 10-20 seconds and try again.",
      });
      if (!payload?.admin_token) throw new Error("Invalid admin login.");
      setAdminToken(payload.admin_token);
      setAdminPassword("");
      setSuccess("Admin login successful.");
      window.localStorage.setItem("hirescore_admin_token", payload.admin_token);
      window.localStorage.setItem("hirescore_admin_login_id", loginId);
      await loadAdminData(payload.admin_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to login.");
    } finally {
      setLoading(false);
    }
  };

  const loadChatConversation = async (userId: number, tokenOverride?: string) => {
    const effectiveToken = (tokenOverride ?? adminToken).trim();
    if (!effectiveToken || userId <= 0) return;
    setChatLoading(true);
    setError("");
    try {
      const payload = await adminFetch<{ user?: AdminChatUser; messages?: AdminChatMessage[] }>(
        `/admin/chats/${userId}?limit=300`,
        undefined,
        effectiveToken,
      );
      setActiveChatUser(payload.user || null);
      setChatMessages(payload.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load chat conversation.");
    } finally {
      setChatLoading(false);
    }
  };

  const openChatThread = async (thread: AdminChatThread) => {
    setActiveChatUser({
      id: thread.user_id,
      name: thread.name,
      email: thread.email,
      plan: thread.plan,
      credits: thread.credits,
    });
    await loadChatConversation(thread.user_id);
    await loadAdminData();
  };

  const sendChatReply = async () => {
    const targetUser = activeChatUser;
    if (!targetUser || chatSending) return;
    const message = chatReplyText.trim();
    if (message.length < 2) {
      setError("Reply message is too short.");
      return;
    }

    setChatSending(true);
    setError("");
    try {
      await adminFetch(`/admin/chats/${targetUser.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setChatReplyText("");
      await loadChatConversation(targetUser.id);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send reply.");
    } finally {
      setChatSending(false);
    }
  };

  const runUserUpdate = async (userId: number) => {
    const row = getRowEditor(userId);
    const payload: { name?: string; email?: string; password?: string; credits_set?: number; plan?: string } = {};

    if (row.name.trim()) payload.name = row.name.trim();
    if (row.email.trim()) payload.email = row.email.trim();
    if (row.password.trim()) payload.password = row.password.trim();
    if (row.plan.trim()) payload.plan = row.plan.trim().toLowerCase();
    if (row.creditsSet.trim()) {
      const value = Number(row.creditsSet);
      if (!Number.isFinite(value)) {
        setError("Set credits value must be numeric.");
        return;
      }
      payload.credits_set = Math.max(0, Math.floor(value));
    }

    if (Object.keys(payload).length === 0) {
      setError("Add at least one field to update.");
      return;
    }

    setRowBusy((prev) => ({ ...prev, [userId]: true }));
    setError("");
    setSuccess("");
    try {
      await adminFetch(`/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setSuccess(`User ${userId} updated.`);
      setRowEditor(userId, () => defaultRowEditor());
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update user.");
    } finally {
      setRowBusy((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const runCreditAdjust = async (userId: number) => {
    const row = getRowEditor(userId);
    const deltaValue = Number(row.delta);
    if (!Number.isFinite(deltaValue) || Math.floor(deltaValue) === 0) {
      setError("Enter a positive or negative number, for example 10 or -10.");
      return;
    }

    setRowBusy((prev) => ({ ...prev, [userId]: true }));
    setError("");
    setSuccess("");
    try {
      await adminFetch(`/admin/users/${userId}/credits`, {
        method: "POST",
        body: JSON.stringify({
          delta: Math.floor(deltaValue),
          reason: row.reason.trim() || "admin_panel",
        }),
      });
      setSuccess(`Credits updated for user ${userId}.`);
      setRowEditor(userId, (prev) => ({ ...prev, delta: "", reason: "" }));
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to adjust credits.");
    } finally {
      setRowBusy((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const runUserDelete = async (userId: number) => {
    if (!window.confirm(`Delete user #${userId}? This cannot be undone.`)) return;
    setRowBusy((prev) => ({ ...prev, [userId]: true }));
    setError("");
    setSuccess("");
    try {
      await adminFetch(`/admin/users/${userId}`, { method: "DELETE" });
      setSuccess(`User ${userId} deleted.`);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete user.");
    } finally {
      setRowBusy((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const downloadAdminExport = async (path: string, fallbackName: string, key: string) => {
    const effectiveToken = adminToken.trim();
    if (!effectiveToken) {
      setError("Admin session token missing. Please login again.");
      return;
    }
    setExportingKey(key);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(apiUrl(path), {
        method: "GET",
        headers: { Authorization: `Bearer ${effectiveToken}` },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || `Download failed (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
      const fileName = match?.[1] || fallbackName;
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      setSuccess(`Downloaded ${fileName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to download export.");
    } finally {
      setExportingKey(null);
    }
  };

  const metricCardClass =
    "rounded-2xl border border-slate-200/16 bg-gradient-to-br from-slate-900/82 via-slate-900/70 to-indigo-900/36 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.4)]";
  const inputClass =
    "rounded-xl border border-slate-300/18 bg-[#0b1120]/94 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-300/45 outline-none transition focus:border-sky-300/65";

  const metricRows = analytics
    ? [
        { label: "Total Users", value: analytics.users_total },
        { label: "Signups", value: analytics.signups_total },
        { label: "Logins", value: analytics.logins_total },
        { label: "Analyses", value: analytics.analyses_total },
        { label: "Feedback", value: analytics.feedback_total },
        { label: "Avg Rating", value: analytics.feedback_avg_rating },
        { label: "Payments", value: analytics.payments_total },
        { label: "Revenue (INR)", value: analytics.revenue_inr_total },
        { label: "Credits Sold", value: analytics.credits_sold_total },
        { label: "Gateway", value: (analytics.payment_gateway || "none").toUpperCase() },
      ]
    : [];

  if (!connected) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.12),_transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(251,146,60,0.12),_transparent_42%),linear-gradient(180deg,#060910_0%,#0a1020_100%)] px-4 pb-14 pt-7 sm:px-6 lg:px-8">
        <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center justify-center">
          <aside className="w-full rounded-[2rem] border border-slate-200/16 bg-gradient-to-b from-slate-900/95 via-slate-900/88 to-indigo-950/70 p-6 shadow-[0_24px_70px_rgba(8,15,36,0.55)] sm:p-7">
            <p className="text-xs uppercase tracking-[0.16em] text-sky-100/70">Master Control</p>
            <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">CRM Admin Console</h1>
            <p className="mt-2 text-sm text-slate-200/75">Login to access user management, credits, plans, analytics, and event logs.</p>

            <div className="mt-5 space-y-2">
              <label className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">Admin Login ID</label>
              <input
                type="text"
                value={adminLoginId}
                onChange={(event) => setAdminLoginId(event.target.value)}
                placeholder="vishwajeet3019@gmail.com"
                className="w-full rounded-xl border border-slate-200/16 bg-[#090f1e] px-3.5 py-3 text-sm text-slate-100 placeholder:text-slate-400/60 outline-none transition focus:border-sky-300/65"
              />
              <input
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                placeholder="Password"
                className="w-full rounded-xl border border-slate-200/16 bg-[#090f1e] px-3.5 py-3 text-sm text-slate-100 placeholder:text-slate-400/60 outline-none transition focus:border-sky-300/65"
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleAdminLogin()}
                disabled={loading}
                className="rounded-xl border border-sky-300/36 bg-sky-400/16 px-3 py-2.5 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/24 disabled:opacity-55"
              >
                {loading ? "Please wait..." : "Login"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminLoginId("");
                  setAdminPassword("");
                  setError("");
                  setSuccess("");
                  setAdminToken("");
                  setChatThreads([]);
                  setActiveChatUser(null);
                  setChatMessages([]);
                  setChatReplyText("");
                  window.localStorage.removeItem("hirescore_admin_token");
                }}
                className="rounded-xl border border-rose-200/28 bg-rose-300/10 px-3 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-300/16"
              >
                Reset
              </button>
            </div>

            {error && <p className="mt-3 rounded-xl border border-rose-200/26 bg-rose-300/12 px-3 py-2 text-xs text-rose-100">{error}</p>}
            {success && <p className="mt-3 rounded-xl border border-emerald-200/26 bg-emerald-300/12 px-3 py-2 text-xs text-emerald-100">{success}</p>}
          </aside>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.12),_transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(251,146,60,0.12),_transparent_42%),linear-gradient(180deg,#060910_0%,#0a1020_100%)] px-4 pb-14 pt-7 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px]">
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-[2rem] border border-slate-200/16 bg-gradient-to-b from-slate-900/95 via-slate-900/88 to-indigo-950/70 p-5 shadow-[0_24px_70px_rgba(8,15,36,0.55)] sm:p-6">
            <p className="text-xs uppercase tracking-[0.16em] text-sky-100/70">Master Control</p>
            <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">CRM Admin Console</h1>
            <p className="mt-2 text-sm text-slate-200/75">
              Manage users, credits, plans, events, and feedback from one secure admin panel.
            </p>

            <div className="mt-5 space-y-2">
              <label className="text-[11px] uppercase tracking-[0.12em] text-slate-300/70">Admin Login ID</label>
              <input
                type="text"
                value={adminLoginId}
                onChange={(event) => setAdminLoginId(event.target.value)}
                placeholder="admin@hirescore.in"
                className="w-full rounded-xl border border-slate-200/16 bg-[#090f1e] px-3.5 py-3 text-sm text-slate-100 placeholder:text-slate-400/60 outline-none transition focus:border-sky-300/65"
              />
              <input
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                placeholder="Password"
                className="w-full rounded-xl border border-slate-200/16 bg-[#090f1e] px-3.5 py-3 text-sm text-slate-100 placeholder:text-slate-400/60 outline-none transition focus:border-sky-300/65"
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleAdminLogin()}
                disabled={loading}
                className="rounded-xl border border-sky-300/36 bg-sky-400/16 px-3 py-2.5 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/24 disabled:opacity-55"
              >
                {loading ? "Please wait..." : "Login"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminPassword("");
                  setAdminToken("");
                  setConnected(false);
                  setAnalytics(null);
                  setUsers([]);
                  setEvents([]);
                  setFeedbackRows([]);
                  setTransactions([]);
                  setChatThreads([]);
                  setActiveChatUser(null);
                  setChatMessages([]);
                  setChatReplyText("");
                  setError("");
                  setSuccess("");
                  window.localStorage.removeItem("hirescore_admin_token");
                }}
                className="rounded-xl border border-rose-200/28 bg-rose-300/10 px-3 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-300/16"
              >
                Logout
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200/16 bg-slate-700/14 px-3 py-2 text-xs text-slate-200/88">
              Status: <span className="font-semibold text-white">{connected ? "Connected" : "Disconnected"}</span>
            </div>

            {error && <p className="mt-3 rounded-xl border border-rose-200/26 bg-rose-300/12 px-3 py-2 text-xs text-rose-100">{error}</p>}
            {success && <p className="mt-3 rounded-xl border border-emerald-200/26 bg-emerald-300/12 px-3 py-2 text-xs text-emerald-100">{success}</p>}
          </aside>

          <div className="space-y-6">
            <div className="rounded-[2rem] border border-slate-200/15 bg-gradient-to-br from-slate-900/92 via-slate-900/82 to-indigo-950/58 p-5 shadow-[0_24px_70px_rgba(8,15,36,0.48)] sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-sky-100/70">Control Plane</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">User + Billing Operations</h2>
                </div>
                <button
                  type="button"
                  onClick={() => void loadAdminData()}
                  disabled={!canLoad || loading}
                  className="ml-auto rounded-xl border border-sky-300/30 bg-sky-400/14 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/24 disabled:opacity-60"
                >
                  {loading ? "Refreshing..." : "Refresh Data"}
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200/14 bg-slate-900/35 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-300/72">Exports</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <button
                    type="button"
                    onClick={() => void downloadAdminExport(`/admin/export/full.json?q=${encodeURIComponent(search.trim())}&plan=${encodeURIComponent(planFilter)}`, "hirescore-admin-export.json", "full-json")}
                    disabled={!canLoad || Boolean(exportingKey)}
                    className="rounded-xl border border-cyan-200/28 bg-cyan-300/12 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-60"
                  >
                    {exportingKey === "full-json" ? "Downloading..." : "Full JSON"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadAdminExport(`/admin/export/users.csv?q=${encodeURIComponent(search.trim())}&plan=${encodeURIComponent(planFilter)}`, "hirescore-users.csv", "users-csv")}
                    disabled={!canLoad || Boolean(exportingKey)}
                    className="rounded-xl border border-cyan-200/28 bg-cyan-300/12 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-60"
                  >
                    {exportingKey === "users-csv" ? "Downloading..." : "Users CSV"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadAdminExport("/admin/export/events.csv", "hirescore-events.csv", "events-csv")}
                    disabled={!canLoad || Boolean(exportingKey)}
                    className="rounded-xl border border-cyan-200/28 bg-cyan-300/12 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-60"
                  >
                    {exportingKey === "events-csv" ? "Downloading..." : "Events CSV"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadAdminExport("/admin/export/feedback.csv", "hirescore-feedback.csv", "feedback-csv")}
                    disabled={!canLoad || Boolean(exportingKey)}
                    className="rounded-xl border border-cyan-200/28 bg-cyan-300/12 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-60"
                  >
                    {exportingKey === "feedback-csv" ? "Downloading..." : "Feedback CSV"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadAdminExport("/admin/export/credit-transactions.csv", "hirescore-credit-transactions.csv", "tx-csv")}
                    disabled={!canLoad || Boolean(exportingKey)}
                    className="rounded-xl border border-cyan-200/28 bg-cyan-300/12 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-60"
                  >
                    {exportingKey === "tx-csv" ? "Downloading..." : "Credits CSV"}
                  </button>
                </div>
              </div>
            </div>

            {analytics && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {metricRows.map((item) => (
                  <article key={item.label} className={metricCardClass}>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-300/76">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-50">{item.value}</p>
                  </article>
                ))}
              </div>
            )}

            <section className="rounded-[2rem] border border-slate-200/14 bg-[#0b1120]/94 p-5 sm:p-6">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-300/70">User Management</p>
                  <h3 className="mt-1 text-xl font-semibold text-white sm:text-2xl">Search, filter, and manage accounts</h3>
                </div>

                <div className="ml-auto flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name/email"
                    className={`${inputClass} w-52`}
                  />
                  <select
                    value={planFilter}
                    onChange={(event) => setPlanFilter(event.target.value as (typeof planOptions)[number])}
                    className={inputClass}
                  >
                    {planOptions.map((plan) => (
                      <option key={plan} value={plan} className="bg-slate-900">
                        Plan: {plan}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void loadAdminData()}
                    disabled={!connected || loading}
                    className="rounded-xl border border-sky-300/28 bg-sky-400/14 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/24 disabled:opacity-60"
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {users.map((user) => {
                  const row = getRowEditor(user.id);
                  const busy = Boolean(rowBusy[user.id]);
                  const isOpen = expandedUserId === user.id;
                  return (
                    <article key={user.id} className="rounded-2xl border border-slate-200/14 bg-slate-800/38 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-100">
                        <span className="font-semibold text-sky-200">#{user.id}</span>
                        <span className="font-semibold">{user.name || "User"}</span>
                        <span>{user.email}</span>
                        <span className="rounded-full border border-slate-200/20 bg-slate-200/6 px-2 py-0.5 text-xs uppercase">{user.plan}</span>
                        <span className="rounded-full border border-slate-200/20 bg-slate-200/6 px-2 py-0.5 text-xs">Credits: {user.credits}</span>
                        <span className="rounded-full border border-slate-200/20 bg-slate-200/6 px-2 py-0.5 text-xs">Analyses: {user.analyze_count}</span>
                        <button
                          type="button"
                          onClick={() => setExpandedUserId((prev) => (prev === user.id ? null : user.id))}
                          className="ml-auto rounded-lg border border-slate-200/22 bg-slate-700/20 px-2.5 py-1 text-sm font-semibold text-slate-100 hover:bg-slate-700/30"
                          aria-label="Open user actions"
                        >
                          ...
                        </button>
                      </div>

                      {isOpen && (
                        <div className="mt-3 space-y-2 rounded-xl border border-slate-200/14 bg-slate-900/38 p-3">
                          <div className="grid gap-2 md:grid-cols-4">
                            <input
                              type="text"
                              value={row.name}
                              onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, name: event.target.value }))}
                              placeholder="Update name"
                              className={inputClass}
                            />
                            <input
                              type="email"
                              value={row.email}
                              onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, email: event.target.value }))}
                              placeholder="Update email"
                              className={inputClass}
                            />
                            <input
                              type="text"
                              value={row.password}
                              onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, password: event.target.value }))}
                              placeholder="Reset password"
                              className={inputClass}
                            />
                            <select
                              value={row.plan}
                              onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, plan: event.target.value }))}
                              className={inputClass}
                            >
                              <option value="" className="bg-slate-900">Set plan</option>
                              {planOptions.filter((p) => p !== "all").map((plan) => (
                                <option key={plan} value={plan} className="bg-slate-900">{plan}</option>
                              ))}
                            </select>
                          </div>

                          <div className="grid gap-2 md:grid-cols-[140px_140px_1fr_auto]">
                            <input
                              type="number"
                              value={row.creditsSet}
                              onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, creditsSet: event.target.value }))}
                              placeholder="Set credits"
                              className={inputClass}
                            />
                            <input
                              type="number"
                              value={row.delta}
                              onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, delta: event.target.value }))}
                              placeholder="+/- credits"
                              className={inputClass}
                            />
                            <input
                              type="text"
                              value={row.reason}
                              onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, reason: event.target.value }))}
                              placeholder="Reason for credit change"
                              className={inputClass}
                            />
                            <button
                              type="button"
                              onClick={() => void runCreditAdjust(user.id)}
                              disabled={busy}
                              className="rounded-xl border border-amber-300/30 bg-amber-300/15 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/24 disabled:opacity-60"
                            >
                              Update Credits
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void runUserUpdate(user.id)}
                              disabled={busy}
                              className="rounded-xl border border-sky-300/30 bg-sky-400/16 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/24 disabled:opacity-60"
                            >
                              Save Profile Changes
                            </button>
                            <button
                              type="button"
                              onClick={() => void runUserDelete(user.id)}
                              disabled={busy}
                              className="rounded-xl border border-rose-300/35 bg-rose-300/14 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/24 disabled:opacity-60"
                            >
                              Delete User
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
                {!users.length && <p className="text-sm text-slate-200/72">No users found.</p>}
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200/14 bg-[#0b1120]/94 p-5 sm:p-6">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-300/70">Support Inbox</p>
                  <h3 className="mt-1 text-xl font-semibold text-white sm:text-2xl">User Chat Conversations</h3>
                </div>
                <button
                  type="button"
                  onClick={() => void loadAdminData()}
                  disabled={!connected || loading}
                  className="ml-auto rounded-xl border border-sky-300/28 bg-sky-400/14 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/24 disabled:opacity-60"
                >
                  {loading ? "Refreshing..." : "Refresh Inbox"}
                </button>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="max-h-[460px] space-y-2 overflow-y-auto rounded-2xl border border-slate-200/14 bg-slate-900/38 p-3">
                  {!chatThreads.length && <p className="text-xs text-slate-300/70">No user chats yet.</p>}
                  {chatThreads.map((thread) => {
                    const isActive = activeChatUser?.id === thread.user_id;
                    return (
                      <button
                        key={thread.user_id}
                        type="button"
                        onClick={() => void openChatThread(thread)}
                        className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                          isActive
                            ? "border-sky-300/42 bg-sky-300/14"
                            : "border-slate-200/18 bg-slate-800/36 hover:bg-slate-700/36"
                        }`}
                      >
                        <p className="text-sm font-semibold text-slate-100">{thread.name}</p>
                        <p className="text-xs text-slate-300/76">{thread.email}</p>
                        <p className="mt-1 text-xs text-slate-300/80">
                          {thread.last_sender_role === "admin" ? "Admin: " : "User: "}
                          {thread.last_message || "No message preview"}
                        </p>
                        <div className="mt-1 flex items-center justify-between text-[11px] uppercase tracking-[0.1em] text-slate-400/78">
                          <span>{formatDateTime(thread.last_created_at) || "No time"}</span>
                          <span className="rounded-full border border-slate-200/16 bg-slate-700/20 px-2 py-0.5">
                            {thread.unread_by_admin > 0 ? `${thread.unread_by_admin} new` : "Seen"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </aside>

                <article className="rounded-2xl border border-slate-200/14 bg-slate-900/34 p-4">
                  {!activeChatUser && (
                    <p className="text-sm text-slate-300/72">Select a conversation from the left to read and reply.</p>
                  )}

                  {activeChatUser && (
                    <>
                      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/12 pb-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{activeChatUser.name}</p>
                          <p className="text-xs text-slate-300/76">{activeChatUser.email}</p>
                        </div>
                        <span className="ml-auto rounded-full border border-slate-200/18 bg-slate-700/18 px-2 py-1 text-[11px] uppercase text-slate-200/84">
                          {activeChatUser.plan}
                        </span>
                        <span className="rounded-full border border-emerald-200/24 bg-emerald-300/10 px-2 py-1 text-[11px] uppercase text-emerald-100">
                          Credits {activeChatUser.credits}
                        </span>
                      </div>

                      <div className="mt-3 h-[310px] space-y-2 overflow-y-auto rounded-xl border border-slate-200/14 bg-[#0a1324] p-3">
                        {chatLoading && <p className="text-xs text-slate-300/74">Loading conversation...</p>}
                        {!chatLoading && !chatMessages.length && <p className="text-xs text-slate-300/74">No messages in this thread yet.</p>}
                        {chatMessages.map((msg) => {
                          const fromAdmin = msg.sender_role === "admin";
                          return (
                            <div
                              key={msg.id}
                              className={`max-w-[86%] rounded-xl border px-3 py-2 text-sm ${
                                fromAdmin
                                  ? "ml-auto border-sky-300/30 bg-sky-300/14 text-sky-100"
                                  : "mr-auto border-amber-300/24 bg-amber-200/10 text-amber-50"
                              }`}
                            >
                              <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-white/62">
                                {fromAdmin ? "Admin" : "User"} • {formatDateTime(msg.created_at)}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 space-y-2">
                        <textarea
                          value={chatReplyText}
                          onChange={(event) => setChatReplyText(event.target.value)}
                          placeholder="Type your reply to user..."
                          className="h-24 w-full resize-none rounded-xl border border-slate-200/18 bg-[#0a1324] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400/70 outline-none transition focus:border-sky-300/62"
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => void sendChatReply()}
                            disabled={chatSending || chatLoading}
                            className="rounded-xl border border-sky-300/30 bg-sky-400/14 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/24 disabled:opacity-60"
                          >
                            {chatSending ? "Sending..." : "Send Reply"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </article>
              </div>
            </section>

            <section className="rounded-[1.8rem] border border-slate-200/14 bg-[#0b1120]/94 p-5 sm:p-6">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-300/70">Activity Stream</p>
                  <h3 className="mt-1 text-xl font-semibold text-white sm:text-2xl">Feedback, Events, and Credit Logs</h3>
                </div>

                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActivityTab("feedback")}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      activityTab === "feedback"
                        ? "border-sky-300/34 bg-sky-400/16 text-sky-100"
                        : "border-slate-200/16 bg-slate-700/20 text-slate-200/84 hover:bg-slate-700/30"
                    }`}
                  >
                    Feedback
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityTab("events")}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      activityTab === "events"
                        ? "border-sky-300/34 bg-sky-400/16 text-sky-100"
                        : "border-slate-200/16 bg-slate-700/20 text-slate-200/84 hover:bg-slate-700/30"
                    }`}
                  >
                    Events
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityTab("credits")}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      activityTab === "credits"
                        ? "border-sky-300/34 bg-sky-400/16 text-sky-100"
                        : "border-slate-200/16 bg-slate-700/20 text-slate-200/84 hover:bg-slate-700/30"
                    }`}
                  >
                    Credit Ledger
                  </button>
                </div>
              </div>

              <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {activityTab === "feedback" &&
                  feedbackRows.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200/14 bg-slate-800/36 p-3 text-xs text-slate-200/84">
                      <p className="font-semibold text-slate-100">{item.email || `User ${item.user_id}`} • {item.rating}/5</p>
                      <p className="mt-1 text-slate-300/84">{item.comment}</p>
                      <p className="mt-1 text-slate-400/78">{item.created_at}</p>
                    </div>
                  ))}

                {activityTab === "events" &&
                  events.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200/14 bg-slate-800/36 p-3 text-xs text-slate-200/84">
                      <p className="font-semibold text-slate-100">{item.event_type} / {item.event_name}</p>
                      <p className="mt-1 text-slate-300/82">{item.email || "anonymous"} • {item.created_at}</p>
                    </div>
                  ))}

                {activityTab === "credits" &&
                  transactions.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200/14 bg-slate-800/36 p-3 text-xs text-slate-200/84">
                      <p className="font-semibold text-slate-100">{item.action} • {item.delta > 0 ? "+" : ""}{item.delta} • balance {item.balance_after}</p>
                      <p className="mt-1 text-slate-300/82">{item.email || `user-${item.user_id}`} • {item.created_at}</p>
                    </div>
                  ))}

                {activityTab === "feedback" && !feedbackRows.length && <p className="text-xs text-slate-300/72">No feedback entries yet.</p>}
                {activityTab === "events" && !events.length && <p className="text-xs text-slate-300/72">No events yet.</p>}
                {activityTab === "credits" && !transactions.length && <p className="text-xs text-slate-300/72">No credit transactions yet.</p>}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
