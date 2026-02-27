"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ChatMessage = {
  id: number;
  sender_role: string;
  message: string;
  created_at: string;
};

type ChatPayload = {
  messages?: ChatMessage[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const LAST_SEEN_KEY = "hirescore_chat_last_seen";

const formatTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const parseMessages = (payload: unknown): ChatMessage[] => {
  if (!payload || typeof payload !== "object") return [];
  const maybe = payload as ChatPayload;
  if (!Array.isArray(maybe.messages)) return [];
  return maybe.messages;
};

export default function FloatingSupportChat() {
  const [token, setToken] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastSeenId, setLastSeenId] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const setLatestSeen = useCallback((incoming: ChatMessage[]) => {
    const latest = incoming.at(-1)?.id || 0;
    if (latest <= 0) return;
    setLastSeenId((prev) => {
      const next = Math.max(prev, latest);
      window.localStorage.setItem(LAST_SEEN_KEY, String(next));
      return next;
    });
  }, []);

  const fetchMessages = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/chat/messages?limit=200"), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const detail = payload && typeof payload === "object" && "detail" in payload ? String((payload as { detail?: string }).detail || "") : "";
        throw new Error(detail || "Unable to load chat right now.");
      }
      const parsed = parseMessages(payload);
      setMessages(parsed);
      if (isOpen) {
        setLatestSeen(parsed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load chat right now.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isOpen, setLatestSeen, token]);

  useEffect(() => {
    const syncAuth = () => setToken(window.localStorage.getItem("hirescore_auth_token") || "");
    syncAuth();
    const onStorage = () => syncAuth();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onStorage);
    const saved = Number(window.localStorage.getItem(LAST_SEEN_KEY) || "0");
    if (Number.isFinite(saved) && saved > 0) {
      setLastSeenId(saved);
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setMessages([]);
      setError("");
      return;
    }
    void fetchMessages();
  }, [fetchMessages, token]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => {
      void fetchMessages(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [fetchMessages, token]);

  useEffect(() => {
    if (!isOpen) return;
    setLatestSeen(messages);
  }, [isOpen, messages, setLatestSeen]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, isOpen]);

  const unreadCount = useMemo(() => messages.filter((message) => message.sender_role !== "user" && message.id > lastSeenId).length, [messages, lastSeenId]);

  const sendMessage = useCallback(async () => {
    if (!token || sending) return;
    const message = draft.trim();
    if (message.length < 2) {
      setError("Please type at least 2 characters.");
      return;
    }

    setSending(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/chat/messages"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message, auth_token: token }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const detail = payload && typeof payload === "object" && "detail" in payload ? String((payload as { detail?: string }).detail || "") : "";
        throw new Error(detail || "Unable to send message right now.");
      }
      setDraft("");
      await fetchMessages(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message right now.");
    } finally {
      setSending(false);
    }
  }, [draft, fetchMessages, sending, token]);

  return (
    <div className="fixed bottom-5 right-5 z-[80] flex items-end justify-end">
      <div
        className={`origin-bottom-right transition-all duration-300 ease-out ${
          isOpen ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-4 scale-95 opacity-0"
        }`}
      >
        <section className="mb-3 flex h-[min(72vh,560px)] w-[min(92vw,370px)] flex-col overflow-hidden rounded-[1.6rem] border border-emerald-300/28 bg-[#0a1420]/94 shadow-[0_30px_90px_rgba(2,8,23,0.74)]">
          <header className="flex items-center gap-3 border-b border-emerald-200/24 bg-gradient-to-r from-emerald-500/80 to-emerald-600/80 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-white/20 text-sm font-bold text-white">HS</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">HireScore Support</p>
              <p className="text-[11px] text-emerald-100/95">Chat with admin</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="ml-auto rounded-full border border-white/24 bg-white/10 px-2 py-1 text-xs font-semibold text-white transition hover:bg-white/20"
              aria-label="Close chat"
            >
              Close
            </button>
          </header>

          <div className="relative flex-1 overflow-hidden bg-[linear-gradient(155deg,rgba(2,6,23,0.96)_0%,rgba(6,78,59,0.84)_100%)]">
            <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.25)_1px,transparent_0)] [background-size:22px_22px]" />

            {!token ? (
              <div className="relative z-10 flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-emerald-50/90">Login to start chatting with admin support.</p>
                <Link
                  href="/upload"
                  className="rounded-xl border border-emerald-200/40 bg-emerald-300/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-300/30"
                >
                  Login / Signup
                </Link>
              </div>
            ) : (
              <div ref={listRef} className="relative z-10 h-full space-y-2 overflow-y-auto px-3 py-3">
                {loading && <p className="text-xs text-emerald-50/85">Loading chat...</p>}
                {!loading && !messages.length && <p className="text-xs text-emerald-50/85">Start the conversation. Admin replies will appear here.</p>}
                {messages.map((message) => {
                  const byUser = message.sender_role === "user";
                  return (
                    <div key={message.id} className={`flex ${byUser ? "justify-end" : "justify-start"}`}>
                      <article
                        className={`max-w-[86%] rounded-2xl px-3 py-2 text-sm shadow-[0_6px_18px_rgba(2,8,23,0.26)] ${
                          byUser
                            ? "rounded-br-sm border border-emerald-200/36 bg-emerald-300/24 text-emerald-50"
                            : "rounded-bl-sm border border-slate-200/20 bg-slate-50/94 text-slate-900"
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{message.message}</p>
                        <p className={`mt-1 text-[10px] ${byUser ? "text-emerald-100/86" : "text-slate-500"}`}>{formatTime(message.created_at)}</p>
                      </article>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <footer className="border-t border-emerald-200/24 bg-[#0b1724] p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={token ? "Type a message" : "Login required"}
                disabled={!token || sending}
                className="h-10 min-h-10 flex-1 resize-none rounded-2xl border border-emerald-200/24 bg-[#08111d] px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/42 outline-none transition focus:border-emerald-300/54 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!token || sending}
                className="rounded-2xl border border-emerald-200/36 bg-emerald-300/24 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/34 disabled:opacity-60"
              >
                {sending ? "..." : "Send"}
              </button>
            </div>
            {error ? <p className="mt-2 text-xs text-rose-200">{error}</p> : null}
          </footer>
        </section>
      </div>

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group relative flex h-14 min-w-14 items-center justify-center gap-2 rounded-full border border-emerald-200/48 bg-gradient-to-br from-emerald-400/90 to-emerald-600/90 px-4 text-white shadow-[0_18px_50px_rgba(16,185,129,0.5)] transition hover:scale-[1.02]"
        aria-label="Open support chat"
      >
        <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5 fill-current">
          <path d="M12 3C6.48 3 2 6.94 2 11.8c0 2.76 1.45 5.23 3.72 6.85-.18 1.43-.69 2.69-1.58 3.86a.7.7 0 0 0 .84 1.06c1.98-.8 3.63-1.74 4.93-2.82.68.13 1.39.2 2.1.2 5.52 0 10-3.94 10-8.8S17.52 3 12 3zm-4.4 9.55a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3zm4.4 0a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3zm4.4 0a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3z" />
        </svg>
        <span className="text-sm font-semibold">Chat</span>
        {unreadCount > 0 && !isOpen ? (
          <span className="absolute -right-1 -top-1 rounded-full border border-white/70 bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
