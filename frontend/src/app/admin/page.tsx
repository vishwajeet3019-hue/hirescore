"use client";

import { useEffect, useMemo, useState } from "react";

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
  email: string;
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

type RowEditorState = {
  email: string;
  password: string;
  creditsSet: string;
  delta: string;
  reason: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const defaultRowEditor = (): RowEditorState => ({
  email: "",
  password: "",
  creditsSet: "",
  delta: "",
  reason: "",
});

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [feedbackRows, setFeedbackRows] = useState<AdminFeedback[]>([]);
  const [transactions, setTransactions] = useState<AdminCreditTx[]>([]);
  const [rowEditors, setRowEditors] = useState<Record<number, RowEditorState>>({});
  const [rowBusy, setRowBusy] = useState<Record<number, boolean>>({});

  const canLoad = useMemo(() => adminKey.trim().length > 0, [adminKey]);

  useEffect(() => {
    const existing = window.localStorage.getItem("hirescore_admin_key");
    if (existing) {
      setAdminKey(existing);
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

  const adminFetch = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey.trim(),
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      throw new Error(payload?.detail || `Request failed (${response.status})`);
    }
    return (await response.json()) as T;
  };

  const loadAdminData = async () => {
    if (!canLoad) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const [analyticsData, usersData, eventsData, feedbackData, txData] = await Promise.all([
        adminFetch<AdminAnalytics>("/admin/analytics"),
        adminFetch<{ users: AdminUser[] }>(`/admin/users?limit=120&q=${encodeURIComponent(search.trim())}`),
        adminFetch<{ events: AdminEvent[] }>("/admin/events?limit=120"),
        adminFetch<{ feedback: AdminFeedback[] }>("/admin/feedback?limit=120"),
        adminFetch<{ transactions: AdminCreditTx[] }>("/admin/credit-transactions?limit=120"),
      ]);

      setAnalytics(analyticsData);
      setUsers(usersData.users || []);
      setEvents(eventsData.events || []);
      setFeedbackRows(feedbackData.feedback || []);
      setTransactions(txData.transactions || []);
      setConnected(true);
      window.localStorage.setItem("hirescore_admin_key", adminKey.trim());
    } catch (err) {
      setConnected(false);
      setError(err instanceof Error ? err.message : "Unable to load admin data.");
    } finally {
      setLoading(false);
    }
  };

  const runUserUpdate = async (userId: number) => {
    const row = getRowEditor(userId);
    const payload: { email?: string; password?: string; credits_set?: number } = {};
    if (row.email.trim()) payload.email = row.email.trim();
    if (row.password.trim()) payload.password = row.password.trim();
    if (row.creditsSet.trim()) {
      const value = Number(row.creditsSet);
      if (!Number.isFinite(value)) {
        setError("Credits set value must be numeric.");
        return;
      }
      payload.credits_set = Math.max(0, Math.floor(value));
    }
    if (Object.keys(payload).length === 0) {
      setError("Provide at least one value to update.");
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
    if (!Number.isFinite(deltaValue) || deltaValue === 0) {
      setError("Credit delta must be a non-zero number.");
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
      setSuccess(`Credits adjusted for user ${userId}.`);
      setRowEditor(userId, (prev) => ({ ...prev, delta: "", reason: "" }));
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to adjust credits.");
    } finally {
      setRowBusy((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const cardClass = "rounded-2xl border border-emerald-200/22 bg-emerald-100/6 p-4";
  const inputClass =
    "rounded-xl border border-emerald-200/26 bg-[#111923]/92 px-3 py-2 text-xs text-emerald-50 placeholder:text-emerald-100/40 outline-none focus:border-emerald-100";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(251,191,36,0.1),_transparent_50%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.14),_transparent_55%),linear-gradient(180deg,#0b1119_0%,#070b11_100%)] px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8">
      <section className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-[2rem] border border-emerald-200/20 bg-[#111823]/92 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.5)] sm:p-8">
          <p className="text-xs uppercase tracking-[0.16em] text-emerald-100/74">Master Control</p>
          <h1 className="mt-2 text-3xl font-semibold text-emerald-50 sm:text-4xl">Core Ops Dashboard</h1>
          <p className="mt-2 text-sm text-emerald-50/74">
            Unified control for user access, credits, auth, analytics, payments, and feedback operations.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.12em] text-emerald-100/70">Admin API Key</label>
              <input
                type="password"
                value={adminKey}
                onChange={(event) => setAdminKey(event.target.value)}
                placeholder="Enter ADMIN_API_KEYS value"
                className="w-full rounded-2xl border border-emerald-100/28 bg-[#0d141f]/92 px-4 py-3 text-emerald-50 placeholder:text-emerald-100/40 outline-none focus:border-emerald-100"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadAdminData()}
              disabled={!canLoad || loading}
              className="rounded-xl border border-emerald-100/38 bg-emerald-200/14 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-200/24 disabled:opacity-60"
            >
              {loading ? "Loading..." : connected ? "Refresh" : "Connect"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminKey("");
                setConnected(false);
                setAnalytics(null);
                setUsers([]);
                setEvents([]);
                setFeedbackRows([]);
                setTransactions([]);
                setError("");
                setSuccess("");
                window.localStorage.removeItem("hirescore_admin_key");
              }}
              className="rounded-xl border border-rose-100/24 bg-transparent px-4 py-3 text-sm font-semibold text-rose-100/90 transition hover:bg-rose-100/10"
            >
              Reset
            </button>
          </div>
          {error && <p className="mt-3 rounded-xl border border-rose-100/32 bg-rose-100/10 px-3 py-2 text-sm text-rose-100">{error}</p>}
          {success && <p className="mt-3 rounded-xl border border-emerald-100/32 bg-emerald-100/10 px-3 py-2 text-sm text-emerald-100">{success}</p>}
        </div>

        {analytics && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: "Total Users", value: analytics.users_total },
              { label: "Signups", value: analytics.signups_total },
              { label: "Logins", value: analytics.logins_total },
              { label: "Analyses", value: analytics.analyses_total },
              { label: "Feedback", value: analytics.feedback_total },
              { label: "Avg Rating", value: analytics.feedback_avg_rating },
              { label: "Payments", value: analytics.payments_total },
              { label: "Revenue (INR)", value: analytics.revenue_inr_total },
              { label: "Gateway", value: (analytics.payment_gateway || "none").toUpperCase() },
            ].map((item) => (
              <article key={item.label} className={cardClass}>
                <p className="text-xs uppercase tracking-[0.12em] text-emerald-100/72">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-50">{item.value}</p>
              </article>
            ))}
          </div>
        )}

        <section className="rounded-[2rem] border border-emerald-200/18 bg-[#0f1722]/94 p-5 sm:p-6">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-emerald-100/70">User Control</p>
              <h2 className="mt-1 text-2xl font-semibold text-emerald-50">Edit Identity, Password, Credits</h2>
            </div>
            <div className="ml-auto flex gap-2">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search email..."
                className={`${inputClass} w-52`}
              />
              <button
                type="button"
                onClick={() => void loadAdminData()}
                disabled={!connected || loading}
                className="rounded-xl border border-emerald-100/30 bg-emerald-100/12 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-100/20 disabled:opacity-60"
              >
                Search
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {users.map((user) => {
              const row = getRowEditor(user.id);
              const busy = Boolean(rowBusy[user.id]);
              return (
                <article key={user.id} className="rounded-2xl border border-emerald-100/16 bg-emerald-100/5 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-50">
                    <span className="font-semibold">#{user.id}</span>
                    <span>{user.email}</span>
                    <span className="rounded-full border border-emerald-100/24 bg-emerald-100/8 px-2 py-0.5 text-xs">Credits: {user.credits}</span>
                    <span className="rounded-full border border-emerald-100/24 bg-emerald-100/8 px-2 py-0.5 text-xs">Analyses: {user.analyze_count}</span>
                    <span className="rounded-full border border-emerald-100/24 bg-emerald-100/8 px-2 py-0.5 text-xs">
                      Feedback: {user.feedback_submitted ? "Submitted" : user.feedback_required ? "Required" : "Pending"}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <input
                      type="email"
                      value={row.email}
                      onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, email: event.target.value }))}
                      placeholder="New email"
                      className={inputClass}
                    />
                    <input
                      type="text"
                      value={row.password}
                      onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, password: event.target.value }))}
                      placeholder="New password"
                      className={inputClass}
                    />
                    <input
                      type="number"
                      value={row.creditsSet}
                      onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, creditsSet: event.target.value }))}
                      placeholder="Set credits"
                      className={inputClass}
                    />
                  </div>

                  <div className="mt-2 grid gap-2 md:grid-cols-[140px_1fr_auto_auto]">
                    <input
                      type="number"
                      value={row.delta}
                      onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, delta: event.target.value }))}
                      placeholder="Credit +/-"
                      className={inputClass}
                    />
                    <input
                      type="text"
                      value={row.reason}
                      onChange={(event) => setRowEditor(user.id, (prev) => ({ ...prev, reason: event.target.value }))}
                      placeholder="Reason"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => void runUserUpdate(user.id)}
                      disabled={busy}
                      className="rounded-xl border border-emerald-100/30 bg-emerald-100/14 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-100/22 disabled:opacity-60"
                    >
                      Update User
                    </button>
                    <button
                      type="button"
                      onClick={() => void runCreditAdjust(user.id)}
                      disabled={busy}
                      className="rounded-xl border border-amber-100/34 bg-amber-100/16 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-100/24 disabled:opacity-60"
                    >
                      Adjust Credits
                    </button>
                  </div>
                </article>
              );
            })}
            {!users.length && <p className="text-sm text-emerald-50/72">No users found yet.</p>}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-[1.6rem] border border-emerald-100/18 bg-[#0f1722]/94 p-5">
            <h3 className="text-lg font-semibold text-emerald-50">Recent Feedback</h3>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {feedbackRows.map((item) => (
                <div key={item.id} className="rounded-xl border border-emerald-100/16 bg-emerald-100/6 p-3 text-xs text-emerald-50/82">
                  <p className="font-semibold text-emerald-50">
                    {item.email || `User ${item.user_id}`} • {item.rating}/5
                  </p>
                  <p className="mt-1 text-emerald-50/74">{item.comment}</p>
                  <p className="mt-1 text-emerald-50/62">{item.created_at}</p>
                </div>
              ))}
              {!feedbackRows.length && <p className="text-sm text-emerald-50/70">No feedback entries yet.</p>}
            </div>
          </article>

          <article className="rounded-[1.6rem] border border-emerald-100/18 bg-[#0f1722]/94 p-5">
            <h3 className="text-lg font-semibold text-emerald-50">Recent Events</h3>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {events.map((item) => (
                <div key={item.id} className="rounded-xl border border-emerald-100/16 bg-emerald-100/6 p-3 text-xs text-emerald-50/82">
                  <p className="font-semibold text-emerald-50">
                    {item.event_type} / {item.event_name}
                  </p>
                  <p className="mt-1 text-emerald-50/70">{item.email || "anonymous"} • {item.created_at}</p>
                </div>
              ))}
              {!events.length && <p className="text-sm text-emerald-50/70">No events yet.</p>}
            </div>
          </article>
        </section>

        <section className="rounded-[1.6rem] border border-emerald-100/18 bg-[#0f1722]/94 p-5">
          <h3 className="text-lg font-semibold text-emerald-50">Recent Credit Transactions</h3>
          <div className="mt-3 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
            {transactions.map((item) => (
              <div key={item.id} className="rounded-xl border border-emerald-100/16 bg-emerald-100/6 p-3 text-xs text-emerald-50/82">
                <p className="font-semibold text-emerald-50">
                  {item.action} • {item.delta > 0 ? "+" : ""}
                  {item.delta} • balance {item.balance_after}
                </p>
                <p className="mt-1 text-emerald-50/70">{item.email || `user-${item.user_id}`} • {item.created_at}</p>
              </div>
            ))}
            {!transactions.length && <p className="text-sm text-emerald-50/70">No transactions yet.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}
