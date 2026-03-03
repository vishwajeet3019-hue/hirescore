"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { trackEvent } from "@/lib/analytics";
import BrandLogo from "./brand-logo";

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

const navLinks: NavLink[] = [
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
        if (!response.ok) throw new Error("Session expired");
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
        setAuthToken("");
        setWallet(null);
        setAnalysisCount(0);
        setStudioUnlocked(false);
        window.localStorage.removeItem("hirescore_auth_token");
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
    <header className="sticky top-0 z-50 border-b border-cyan-100/12 bg-[#030c1b]/78 backdrop-blur-2xl">
      <div className="border-b border-cyan-100/8 px-3 py-2 sm:px-6 sm:py-2.5">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-2 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-cyan-50/70 sm:gap-3 sm:text-[11px] sm:tracking-[0.24em]">
          <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.9)]" />
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

        <nav className="hidden items-center gap-4 text-sm font-medium text-cyan-50/78 md:flex">
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
                    ? "border-cyan-100/48 bg-cyan-200/20 text-cyan-50"
                    : "border-transparent text-cyan-50/78 hover:border-cyan-100/26 hover:bg-cyan-100/8 hover:text-cyan-100"
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
                className="hidden rounded-xl border border-cyan-200/35 bg-cyan-200/14 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/22 sm:inline"
              >
                Dashboard
              </Link>
              <span className="rounded-xl border border-emerald-200/36 bg-emerald-200/14 px-2.5 py-1.5 text-xs font-semibold text-emerald-100">
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
                className="hidden rounded-xl border border-cyan-100/28 bg-transparent px-3 py-1.5 text-xs font-semibold text-cyan-50/86 transition hover:bg-cyan-100/10 sm:inline"
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
              className="rounded-xl border border-cyan-200/45 bg-gradient-to-r from-cyan-300/20 via-cyan-200/18 to-amber-100/12 px-3 py-1.5 text-xs font-semibold text-cyan-100 shadow-[0_0_18px_rgba(80,223,255,0.22)] transition hover:brightness-110 sm:px-4 sm:py-2 sm:text-sm"
            >
              <span className="sm:hidden">Analyze</span>
              <span className="hidden sm:inline">Check My Score (Free)</span>
            </Link>
          )}
        </div>
      </div>

      <div className="border-t border-cyan-100/8 px-3 py-2 md:hidden">
        <nav className="mx-auto flex w-full max-w-7xl items-center gap-2 overflow-x-auto whitespace-nowrap text-xs text-cyan-50/80">
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
                    : "border-cyan-100/18 bg-cyan-100/6 text-cyan-50/80 hover:bg-cyan-100/12"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          {authToken && (
            <Link
              href="/dashboard"
              className="rounded-lg border border-emerald-200/30 bg-emerald-200/14 px-3 py-1.5 font-semibold text-emerald-100"
            >
              Wallet {wallet?.credits ?? 0}
            </Link>
          )}
        </nav>
      </div>

      <AnimatePresence>
        {showStudioLockModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[240] flex items-center justify-center bg-[#020915]/86 px-4 backdrop-blur-lg"
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              setShowStudioLockModal(false);
            }}
          >
            <motion.section
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              className="relative w-full max-w-lg overflow-hidden rounded-[1.8rem] border border-cyan-100/28 bg-[#051728]/96 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.58)]"
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6 }}
                className="pointer-events-none absolute inset-0"
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(34,211,238,0.3),rgba(34,211,238,0)_38%),radial-gradient(circle_at_84%_82%,rgba(251,191,36,0.22),rgba(251,191,36,0)_42%)]" />
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 13, ease: "linear" }}
                  className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100/24"
                />
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ repeat: Infinity, duration: 16, ease: "linear" }}
                  className="absolute left-1/2 top-1/2 h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-100/20"
                />
                {Array.from({ length: 10 }).map((_, index) => {
                  const left = 10 + index * 8;
                  const duration = 3 + (index % 4) * 0.5;
                  const delay = (index % 5) * 0.2;
                  return (
                    <motion.span
                      key={`spark-${index}`}
                      className="absolute h-1.5 w-1.5 rounded-full bg-cyan-100/70"
                      style={{ left: `${left}%`, bottom: "-8%" }}
                      animate={{ y: [-4, -220], opacity: [0, 1, 0], scale: [0.6, 1, 0.8] }}
                      transition={{ repeat: Infinity, duration, delay, ease: "easeOut" }}
                    />
                  );
                })}
              </motion.div>

              <div className="relative">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-cyan-100/36 bg-cyan-100/8 shadow-[0_0_40px_rgba(34,211,238,0.3)]">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: "linear" }}
                    className="h-12 w-12 rounded-full border-2 border-cyan-100/75 border-t-transparent"
                  />
                  <motion.div
                    animate={{ scale: [1, 1.18, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                    className="absolute h-4 w-4 rounded-full bg-amber-200/85 shadow-[0_0_22px_rgba(251,191,36,0.7)]"
                  />
                </div>
                <p className="text-center text-xs uppercase tracking-[0.18em] text-cyan-100/72">Resume Studio Gate</p>
                <h3 className="mt-2 text-center text-2xl font-semibold text-cyan-50 sm:text-3xl">Unlock Sequence Required</h3>
                <p className="mt-3 text-center text-sm text-cyan-50/80">
                  Complete your first analysis on Analyze page to unlock Build Resume.
                </p>
                <p className="mt-2 text-center text-xs text-cyan-100/72">
                  Analyses completed: <span className="font-semibold text-cyan-50">{analysisCount}</span>
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
                    className="rounded-xl border border-cyan-100/35 bg-cyan-200/18 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/26"
                  >
                    Take Me To Analyze
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
      </AnimatePresence>
    </header>
  );
}
