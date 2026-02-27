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

type ChatMessage = {
  id: number;
  user_id: number;
  sender_role: string;
  message: string;
  created_at: string;
};

type ChatPayload = {
  messages?: ChatMessage[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const formatTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Just now";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function DashboardPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState("");

  const loadChatMessages = async (authToken: string) => {
    if (!authToken) return;
    setChatLoading(true);
    setChatError("");
    try {
      const response = await fetch(apiUrl("/chat/messages?limit=180"), {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "detail" in payload
            ? String((payload as { detail?: string }).detail || "")
            : "";
        throw new Error(message || "Unable to load chat right now.");
      }
      const messages =
        payload && typeof payload === "object" && Array.isArray((payload as ChatPayload).messages)
          ? ((payload as ChatPayload).messages as ChatMessage[])
          : [];
      setChatMessages(messages);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Unable to load chat right now.");
    } finally {
      setChatLoading(false);
    }
  };

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
        await loadChatMessages(authToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load dashboard.");
      } finally {
        setLoading(false);
      }
    };
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!token || error) return;
    const timer = window.setInterval(() => {
      void loadChatMessages(token);
    }, 12000);
    return () => window.clearInterval(timer);
  }, [token, error]);

  const sendChatMessage = async () => {
    if (!token || chatSending) return;
    const message = chatInput.trim();
    if (message.length < 2) {
      setChatError("Please enter a longer message.");
      return;
    }
    setChatSending(true);
    setChatError("");
    try {
      const response = await fetch(apiUrl("/chat/messages"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message, auth_token: token }),
      });
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) throw new Error(payload?.detail || "Unable to send message right now.");
      setChatInput("");
      await loadChatMessages(token);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Unable to send message right now.");
    } finally {
      setChatSending(false);
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

        {!loading && !error && (
          <section className="mt-8 rounded-[1.8rem] border border-cyan-100/20 bg-gradient-to-br from-cyan-200/10 via-slate-950/38 to-cyan-300/8 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-cyan-100/70">Support Chat</p>
                <h2 className="mt-1 text-2xl font-semibold text-cyan-50">Ask Questions Anytime</h2>
              </div>
              <button
                type="button"
                onClick={() => void loadChatMessages(token)}
                disabled={chatLoading || !token}
                className="rounded-xl border border-cyan-100/30 bg-cyan-200/12 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/20 disabled:opacity-60"
              >
                {chatLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="mt-4 h-[300px] space-y-2 overflow-y-auto rounded-2xl border border-cyan-100/16 bg-[#081626]/72 p-3">
              {!chatMessages.length && !chatLoading && (
                <p className="text-sm text-cyan-100/68">No messages yet. Ask your first question and admin can reply from the support inbox.</p>
              )}

              {chatMessages.map((msg) => {
                const byUser = msg.sender_role === "user";
                return (
                  <article
                    key={msg.id}
                    className={`max-w-[85%] rounded-2xl border px-3 py-2 text-sm ${
                      byUser
                        ? "ml-auto border-cyan-200/34 bg-cyan-300/14 text-cyan-50"
                        : "mr-auto border-amber-100/26 bg-amber-100/10 text-amber-50"
                    }`}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-white/62">
                      {byUser ? "You" : "Admin Support"} • {formatTime(msg.created_at)}
                    </p>
                  </article>
                );
              })}
            </div>

            <div className="mt-3 space-y-2">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Type your question..."
                className="h-24 w-full resize-none rounded-2xl border border-cyan-100/20 bg-[#081626]/78 px-3 py-2 text-sm text-cyan-50 placeholder:text-cyan-100/45 outline-none transition focus:border-cyan-200/56"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {chatError ? <p className="text-xs text-rose-100/92">{chatError}</p> : <p className="text-xs text-cyan-100/62">Messages are private to your account.</p>}
                <button
                  type="button"
                  onClick={() => void sendChatMessage()}
                  disabled={chatSending || !token}
                  className="rounded-xl border border-cyan-200/38 bg-cyan-300/16 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/24 disabled:opacity-60"
                >
                  {chatSending ? "Sending..." : "Send Message"}
                </button>
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
