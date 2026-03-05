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
    <header className="sticky top-0 z-50 border-b border-cyan-100/18 bg-white/90 backdrop-blur-xl">
      <div className="border-b border-cyan-100/14 px-3 py-2 sm:px-6 sm:py-2.5">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-2 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-cyan-100/72 sm:gap-3 sm:text-[11px] sm:tracking-[0.24em]">
          <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.88)]" />
          Resume assessment and optimization platform for every role
        </p>
      </div>

      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-3 sm:h-20 sm:px-6">
        <Link href="/" className="group">
          <BrandLogo
            intro
            subtitle="Professional Resume Assessment"
            titleClassName="font-mono text-sm tracking-wide sm:text-xl"
            subtitleClassName="text-[10px] tracking-[0.16em] sm:text-xs sm:tracking-[0.26em]"
          />
        </Link>

        <nav className="hidden items-center gap-4 text-sm font-medium text-cyan-50/82 md:flex">
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
                    ? "border-cyan-100/44 bg-cyan-200/20 text-cyan-50 shadow-[0_0_18px_rgba(94,209,255,0.18)]"
                    : "border-transparent text-cyan-50/82 hover:border-cyan-100/30 hover:bg-cyan-100/10 hover:text-cyan-50"
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
                className="hidden rounded-xl border border-cyan-100/36 bg-cyan-200/14 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 sm:inline"
              >
                Dashboard
              </Link>
              <span className="rounded-xl border border-emerald-200/36 bg-emerald-200/12 px-2.5 py-1.5 text-xs font-semibold text-emerald-100">
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
                className="hidden rounded-xl border border-cyan-100/30 bg-transparent px-3 py-1.5 text-xs font-semibold text-cyan-50/86 transition hover:bg-cyan-100/10 sm:inline"
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
                  cta_label: "Start Assessment",
                });
              }}
              className="rounded-xl border border-cyan-100/44 bg-gradient-to-r from-cyan-300/22 via-cyan-200/20 to-amber-100/12 px-3 py-1.5 text-xs font-semibold text-cyan-50 shadow-[0_10px_26px_rgba(21,128,255,0.24)] transition hover:brightness-110 sm:px-4 sm:py-2 sm:text-sm"
            >
              <span className="sm:hidden">Analyze</span>
              <span className="hidden sm:inline">Start Assessment</span>
            </Link>
          )}
        </div>
      </div>

      <div className="border-t border-cyan-100/14 px-3 py-2 md:hidden">
        <nav className="mx-auto flex w-full max-w-7xl items-center gap-2 overflow-x-auto whitespace-nowrap text-xs text-cyan-50/82">
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
                    ? "border-cyan-100/46 bg-cyan-200/20 text-cyan-50"
                    : "border-cyan-100/20 bg-cyan-100/8 text-cyan-50/82 hover:bg-cyan-100/14"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          {authToken && (
            <Link
              href="/dashboard"
              className="rounded-lg border border-emerald-200/36 bg-emerald-200/14 px-3 py-1.5 font-semibold text-emerald-100"
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
                  className="fixed inset-0 z-[1400] flex min-h-dvh items-center justify-center bg-[#020817]/62 px-4 py-6 backdrop-blur-[6px]"
                  onClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    setShowStudioLockModal(false);
                  }}
                >
                  <motion.section
                    initial={{ opacity: 0, y: 18, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.97 }}
                    className="relative my-auto w-full max-w-lg overflow-hidden rounded-[1.8rem] border border-cyan-100/24 bg-[#081729]/96 p-6 shadow-[0_24px_70px_rgba(2,8,20,0.56)]"
                  >
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(125,211,252,0.08),rgba(8,24,38,0)_42%,rgba(253,230,138,0.08))]" />

                    <div className="relative">
                      <StudioLockVisual compact />
                      <p className="text-center text-xs uppercase tracking-[0.18em] text-cyan-100/72">Resume Studio Gate</p>
                      <h3 className="mt-2 text-center text-2xl font-semibold text-cyan-50 sm:text-3xl">Let&apos;s Analyze Your Skills First</h3>
                      <p className="mt-3 text-center text-sm text-cyan-50/80">
                        Complete your first analysis on Analyze page to unlock Build Resume.
                      </p>
                      <p className="mt-2 text-center text-xs text-cyan-100/72">
                        Analysis runs completed: <span className="font-semibold text-cyan-50">{analysisCount}</span>
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
                          className="rounded-xl border border-cyan-100/35 bg-cyan-200/20 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/28"
                        >
                          Go To Analyze
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowStudioLockModal(false)}
                          className="rounded-xl border border-cyan-100/22 bg-transparent px-4 py-2.5 text-sm font-semibold text-cyan-50/86 transition hover:bg-cyan-100/8"
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
