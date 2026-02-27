"use client";

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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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
    if (!token || !isAuthenticated) return;
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
  }, [isAuthenticated, isOpen, setLatestSeen, token]);

  useEffect(() => {
    const syncAuth = () => setToken(window.localStorage.getItem("hirescore_auth_token") || "");
    syncAuth();
    const onStorage = () => syncAuth();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onStorage);
    const tokenPoll = window.setInterval(syncAuth, 1500);
    const saved = Number(window.localStorage.getItem(LAST_SEEN_KEY) || "0");
    if (Number.isFinite(saved) && saved > 0) {
      setLastSeenId(saved);
    }
    return () => {
      window.clearInterval(tokenPoll);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setIsAuthenticated(false);
      setMessages([]);
      setError("");
      return;
    }
    void fetchMessages();
  }, [fetchMessages, token]);

  useEffect(() => {
    if (!token) {
      setIsAuthenticated(false);
      return;
    }
    let active = true;
    const validateSession = async () => {
      try {
        const response = await fetch(apiUrl("/auth/me"), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) throw new Error("Session expired");
        if (!active) return;
        setIsAuthenticated(true);
      } catch {
        if (!active) return;
        setIsAuthenticated(false);
        setIsOpen(false);
        setToken("");
        window.localStorage.removeItem("hirescore_auth_token");
      }
    };
    void validateSession();
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !isAuthenticated) return;
    const timer = window.setInterval(() => {
      void fetchMessages(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [fetchMessages, isAuthenticated, token]);

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
    if (!token || !isAuthenticated || sending) return;
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
  }, [draft, fetchMessages, isAuthenticated, sending, token]);

  if (!token || !isAuthenticated) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[80] flex items-end justify-end sm:bottom-6 sm:right-6">
      <div
        className={`origin-bottom-right transition-all duration-300 ease-out ${
          isOpen ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-4 scale-95 opacity-0"
        }`}
      >
        <section className="mb-2 flex h-[min(70vh,540px)] w-[min(92vw,356px)] flex-col overflow-hidden rounded-[1.55rem] border border-slate-200/20 bg-[#0b1624]/96 shadow-[0_18px_52px_rgba(2,8,23,0.58)]">
          <header className="flex items-center gap-3 border-b border-slate-100/12 bg-gradient-to-r from-[#15352d] to-[#0f2b24] px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100/38 bg-emerald-100/14 text-sm font-bold text-emerald-50">HS</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">HireScore Support</p>
              <p className="text-[11px] text-emerald-100/90">Chat with admin</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="ml-auto rounded-full border border-emerald-100/26 bg-emerald-100/12 px-2 py-1 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-100/22"
              aria-label="Close chat"
            >
              Close
            </button>
          </header>

          <div className="relative flex-1 overflow-hidden bg-[linear-gradient(160deg,rgba(7,17,31,0.98)_0%,rgba(10,38,33,0.92)_56%,rgba(7,15,28,0.98)_100%)]">
            <div className="pointer-events-none absolute inset-0 opacity-22 [background-image:radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.55)_1px,transparent_0)] [background-size:22px_22px]" />

            <div ref={listRef} className="relative z-10 h-full space-y-2 overflow-y-auto px-3 py-3">
              {loading && <p className="text-xs text-slate-100/88">Loading chat...</p>}
              {!loading && !messages.length && <p className="text-xs text-slate-100/88">Start the conversation. Admin replies will appear here.</p>}
              {messages.map((message) => {
                const byUser = message.sender_role === "user";
                return (
                  <div key={message.id} className={`flex ${byUser ? "justify-end" : "justify-start"}`}>
                    <article
                      className={`max-w-[86%] rounded-2xl px-3 py-2 text-sm shadow-[0_6px_18px_rgba(2,8,23,0.26)] ${
                        byUser
                          ? "rounded-br-sm border border-emerald-300/32 bg-[#0f5342] text-emerald-50"
                          : "rounded-bl-sm border border-slate-200/22 bg-slate-100/95 text-slate-900"
                      }`}
                    >
                      <p className="whitespace-pre-wrap leading-relaxed">{message.message}</p>
                      <p className={`mt-1 text-[10px] ${byUser ? "text-emerald-100/78" : "text-slate-500"}`}>{formatTime(message.created_at)}</p>
                    </article>
                  </div>
                );
              })}
            </div>
          </div>

          <footer className="border-t border-slate-200/14 bg-[#0d1927] p-3">
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
                className="h-10 min-h-10 flex-1 resize-none rounded-2xl border border-slate-200/18 bg-[#081321] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-300/45 outline-none transition focus:border-emerald-300/44 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!token || sending}
                className="rounded-2xl border border-emerald-200/34 bg-emerald-300/18 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/28 disabled:opacity-60"
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
        className="group relative flex h-12 min-w-12 items-center justify-center gap-2 rounded-full border border-emerald-200/34 bg-gradient-to-br from-[#1f6f5b] to-[#145645] px-3.5 text-white shadow-[0_12px_28px_rgba(4,120,87,0.36)] transition hover:brightness-110"
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
