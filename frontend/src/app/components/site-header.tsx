"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { trackEvent } from "@/lib/analytics";
import BrandLogo from "./brand-logo";
import StudioLockVisual from "./studio-lock-visual";

type CreditWallet = {
  credits: number;
};

type AuthPayload = {
  user?: { email?: string };
  wallet?: CreditWallet;
  analysis_count?: number;
  studio_unlocked?: boolean;
};

type NavLink = {
  href: string;
  label: string;
  isSection?: boolean;
};

const baseNavLinks: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Analyze" },
  { href: "/studio", label: "Build Resume" },
  { href: "/resources", label: "Guides" },
  { href: "/#workflow", label: "How It Works", isSection: true },
  { href: "/pricing", label: "Pricing" },
];
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const isLinkActive = (pathname: string, hash: string, link: NavLink) => {
  if (link.isSection) {
    return pathname === "/" && hash === "#workflow";
  }
  if (link.href === "/") {
    return pathname === "/" && hash !== "#workflow";
  }
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
};

export default function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [hash, setHash] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [analysisCount, setAnalysisCount] = useState(0);
  const [studioUnlocked, setStudioUnlocked] = useState(false);
  const [showStudioLockModal, setShowStudioLockModal] = useState(false);
  const portalReady = typeof window !== "undefined";
  const navLinks = useMemo(
    () => (authToken ? baseNavLinks.filter((link) => link.href !== "/resources") : baseNavLinks),
    [authToken]
  );

  useEffect(() => {
    if (!showStudioLockModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showStudioLockModal]);

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash || "");
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  useEffect(() => {
    const syncAuth = async () => {
      const token = window.localStorage.getItem("hirescore_auth_token") || "";
      if (!token) {
        setAuthToken("");
        setWallet(null);
        setAnalysisCount(0);
        setStudioUnlocked(false);
        return;
      }
      setAuthToken(token);
      try {
        const response = await fetch(apiUrl("/auth/me"), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (response.status === 401) {
          setAuthToken("");
          setWallet(null);
          setAnalysisCount(0);
          setStudioUnlocked(false);
          window.localStorage.removeItem("hirescore_auth_token");
          return;
        }
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as AuthPayload;
        if (payload.wallet) setWallet(payload.wallet);
        const nextAnalysisCount = Math.max(0, Math.floor(payload.analysis_count || 0));
        setAnalysisCount(nextAnalysisCount);
        if (typeof payload.studio_unlocked === "boolean") {
          setStudioUnlocked(payload.studio_unlocked);
        } else if (typeof payload.analysis_count === "number") {
          setStudioUnlocked(nextAnalysisCount >= 1);
        } else {
          setStudioUnlocked(false);
        }
      } catch {
        // Avoid hard logout during temporary backend/network failures.
      }
    };
    void syncAuth();
  }, [pathname]);

  const handleStudioNavClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const studioLocked = !authToken || !studioUnlocked;
    if (!studioLocked) return;
    event.preventDefault();
    setShowStudioLockModal(true);
    trackEvent("studio_nav_locked_popup_open", {
      source: "header_nav",
      has_token: Boolean(authToken),
      analysis_count: analysisCount,
    });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-300/55 bg-white/88 backdrop-blur-md">
      <div className="border-b border-slate-300/50 px-3 py-2 sm:px-6 sm:py-2.5">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-2 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-slate-600 sm:gap-3 sm:text-[11px] sm:tracking-[0.24em]">
          <span className="h-2 w-2 rounded-full bg-slate-700 shadow-[0_0_10px_rgba(51,65,85,0.35)]" />
          Precision shortlist prediction platform for every role
        </p>
      </div>

      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-3 sm:h-20 sm:px-6">
        <Link href="/" className="group">
          <BrandLogo
            intro
            subtitle="Interview Calls Made Easier"
            titleClassName="font-mono text-sm tracking-wide sm:text-xl"
            subtitleClassName="text-[10px] tracking-[0.16em] sm:text-xs sm:tracking-[0.26em]"
          />
        </Link>

        <nav className="hidden items-center gap-4 text-sm font-medium text-slate-600 md:flex">
          {navLinks.map((link) => {
            const active = isLinkActive(pathname, hash, link);
            const isStudioLink = link.href === "/studio";
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={isStudioLink ? handleStudioNavClick : undefined}
                className={`rounded-full border px-3 py-1.5 transition ${
                  active
                    ? "border-slate-400/70 bg-slate-200/75 text-slate-900"
                    : "border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {authToken && wallet ? (
            <>
              <Link
                href="/dashboard"
                className="hidden rounded-xl border border-slate-400/55 bg-slate-200/75 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-300/65 sm:inline"
              >
                Dashboard
              </Link>
              <span className="rounded-xl border border-slate-400/55 bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                Wallet: {wallet.credits}
              </span>
              <button
                type="button"
                onClick={() => {
                  setAuthToken("");
                  setWallet(null);
                  setAnalysisCount(0);
                  setStudioUnlocked(false);
                  window.localStorage.removeItem("hirescore_auth_token");
                }}
                className="hidden rounded-xl border border-slate-300/70 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200/75 sm:inline"
              >
                Sign Out
              </button>
            </>
          ) : (
            <Link
              href="/upload"
              onClick={() => {
                trackEvent("cta_check_my_score_click", {
                  cta_location: "header",
                  cta_label: "Check My Score (Free)",
                });
              }}
              className="rounded-xl border border-slate-400/60 bg-gradient-to-r from-white via-slate-100 to-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.1)] transition hover:brightness-95 sm:px-4 sm:py-2 sm:text-sm"
            >
              <span className="sm:hidden">Analyze</span>
              <span className="hidden sm:inline">Check My Score (Free)</span>
            </Link>
          )}
        </div>
      </div>

      <div className="border-t border-slate-300/50 px-3 py-2 md:hidden">
        <nav className="mx-auto flex w-full max-w-7xl items-center gap-2 overflow-x-auto whitespace-nowrap text-xs text-slate-700">
          {navLinks.map((link) => {
            const active = isLinkActive(pathname, hash, link);
            const isStudioLink = link.href === "/studio";
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={isStudioLink ? handleStudioNavClick : undefined}
                className={`rounded-lg border px-3 py-1.5 transition ${
                  active
                    ? "border-slate-400/65 bg-slate-200/80 text-slate-900"
                    : "border-slate-300/80 bg-white/85 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          {authToken && (
            <Link
              href="/dashboard"
              className="rounded-lg border border-slate-400/60 bg-white/90 px-3 py-1.5 font-semibold text-slate-700"
            >
              Wallet {wallet?.credits ?? 0}
            </Link>
          )}
        </nav>
      </div>

      {portalReady
        ? createPortal(
            <AnimatePresence>
              {showStudioLockModal && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[1400] flex min-h-dvh items-center justify-center bg-slate-900/24 px-4 py-6 backdrop-blur-[6px]"
                  onClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    setShowStudioLockModal(false);
                  }}
                >
                  <motion.section
                    initial={{ opacity: 0, y: 18, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.97 }}
                    className="relative my-auto w-full max-w-lg overflow-hidden rounded-[1.8rem] border border-slate-300/75 bg-white/95 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
                  >
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.7),rgba(241,245,249,0)_42%,rgba(226,232,240,0.7))]" />

                    <div className="relative">
                      <StudioLockVisual compact />
                      <p className="text-center text-xs uppercase tracking-[0.18em] text-slate-500">Resume Studio Gate</p>
                      <h3 className="mt-2 text-center text-2xl font-semibold text-slate-900 sm:text-3xl">Let&apos;s Analyze Your Skills First</h3>
                      <p className="mt-3 text-center text-sm text-slate-600">
                        Complete your first analysis on Analyze page to unlock Build Resume.
                      </p>
                      <p className="mt-2 text-center text-xs text-slate-500">
                        Analysis runs completed: <span className="font-semibold text-slate-900">{analysisCount}</span>
                      </p>

                      <div className="mt-5 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowStudioLockModal(false);
                            trackEvent("studio_nav_locked_popup_analyze_click", {
                              source: "header_nav",
                              analysis_count: analysisCount,
                            });
                            router.push("/upload");
                          }}
                          className="rounded-xl border border-slate-400/65 bg-slate-200/80 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-300/70"
                        >
                          Go To Analyze
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowStudioLockModal(false)}
                          className="rounded-xl border border-slate-300/70 bg-transparent px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          Not Now
                        </button>
                      </div>
                    </div>
                  </motion.section>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )
        : null}
    </header>
  );
}
