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
          setStudioUnlocked(true);
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
              <div className="pointer-events-none absolute -left-10 -top-10 h-36 w-36 rounded-full bg-cyan-300/24 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-12 -right-10 h-40 w-40 rounded-full bg-amber-200/20 blur-3xl" />

              <div className="relative">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-cyan-100/36 bg-cyan-100/8">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2.6, ease: "linear" }}
                    className="h-9 w-9 rounded-full border-2 border-cyan-100/65 border-t-transparent"
                  />
                </div>
                <p className="text-center text-xs uppercase tracking-[0.16em] text-cyan-100/72">Resume Studio Gate</p>
                <h3 className="mt-2 text-center text-2xl font-semibold text-cyan-50">Complete 1 Analysis First</h3>
                <p className="mt-3 text-center text-sm text-cyan-50/80">
                  Build Resume unlocks after your first analysis on the Analyze page.
                </p>
                <p className="mt-2 text-center text-xs text-cyan-100/72">
                  Analyses completed: <span className="font-semibold text-cyan-50">{analysisCount}</span>
                </p>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowStudioLockModal(false);
                      router.push("/upload");
                    }}
                    className="rounded-xl border border-cyan-100/35 bg-cyan-200/18 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/26"
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
      </AnimatePresence>
    </header>
  );
}
