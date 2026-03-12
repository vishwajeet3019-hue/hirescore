"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { trackEvent } from "@/lib/analytics";
import { addUtmParams } from "@/lib/utm";
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
  children?: NavLink[];
};

const baseNavLinks: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/#workflow", label: "How It Works", isSection: true },
  {
    href: "/tools",
    label: "Tools",
    children: [
      { href: "/instant-fit", label: "Instant Fit Check" },
      { href: "/application-copilot", label: "Application Copilot" },
      { href: "/analysis", label: "Analysis" },
      { href: "/ai-resume-studio", label: "AI Resume Studio" },
      { href: "/interview-simulator", label: "Interview Simulator" },
      { href: "/interview-prep", label: "Interview Prep" },
    ],
  },
  { href: "/case-studies", label: "Success Stories" },
  { href: "/resources", label: "Guides" },
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
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileToolsPanelRef = useRef<HTMLDivElement | null>(null);
  const portalReady = typeof window !== "undefined";

  const navLinks = useMemo(
    () => (authToken ? baseNavLinks.filter((link) => link.href !== "/resources") : baseNavLinks),
    [authToken],
  );

  const headerAnalyzeHref = addUtmParams("/instant-fit", {
    source: "header_nav",
    medium: "internal",
    campaign: "nav_instant_fit",
  });
  const headerAuthHref = addUtmParams("/upload?auth=login", {
    source: "header_nav",
    medium: "internal",
    campaign: "nav_auth_entry",
  });

  const isToolsActive = (link: NavLink) =>
    link.children?.some((child) => isLinkActive(pathname, hash, child)) || false;
  const isStudioNav = (href: string) => href === "/studio" || href === "/ai-resume-studio";
  const toolsNavLinks = navLinks.find((link) => link.children?.length)?.children || [];
  const isToolsDropdownOpen = (link: NavLink) => (link.children ? showToolsMenu : false);

  const closeNavigationMenus = () => {
    setMobileMenuOpen(false);
    setShowToolsMenu(false);
  };

  const closeToolsDropdown = () => setShowToolsMenu(false);

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
      const clearSessionState = () => {
        setAuthToken("");
        setWallet(null);
        setAnalysisCount(0);
        setStudioUnlocked(false);
        window.localStorage.removeItem("hirescore_auth_token");
      };

      const token = window.localStorage.getItem("hirescore_auth_token") || "";
      if (!token) {
        clearSessionState();
        return;
      }

      try {
        const response = await fetch(apiUrl("/auth/me"), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });
        if (!response.ok) {
          clearSessionState();
          return;
        }
        const payload = (await response.json()) as AuthPayload;
        setAuthToken(token);
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
        clearSessionState();
      }
    };
    void syncAuth();
  }, [pathname]);

  useEffect(() => {
    if (!showToolsMenu) return;
    const closeOnOutsideClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const clickedInsideDesktopTools = Boolean(
        toolsMenuRef.current && toolsMenuRef.current.contains(target),
      );
      const clickedInsideMobileTools = Boolean(
        mobileToolsPanelRef.current && mobileToolsPanelRef.current.contains(target),
      );
      if (!clickedInsideDesktopTools && !clickedInsideMobileTools) {
        setShowToolsMenu(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowToolsMenu(false);
      }
    };
    document.addEventListener("click", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showToolsMenu]);

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

  const handleToolsLinkClick = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    closeNavigationMenus();
    closeToolsDropdown();
    if (isStudioNav(href)) {
      handleStudioNavClick(event);
    }
  };

  const handleNavLinkClick = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    closeNavigationMenus();
    if (isStudioNav(href)) {
      handleStudioNavClick(event);
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div className="border-b border-slate-100 px-4 py-2 sm:px-6">
        <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 text-center text-[11px] font-medium tracking-[0.08em] text-slate-500 sm:text-xs">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Role-fit scoring and interview preparation in one clean workflow.
        </p>
      </div>

      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:h-20 sm:px-6">
        <Link href="/" className="group">
          <BrandLogo
            intro
            subtitle="Interview Calls Made Easier"
            titleClassName="font-semibold"
            subtitleClassName="text-[10px] tracking-[0.14em]"
          />
        </Link>

        <nav className="hidden items-center gap-2 text-sm font-medium text-slate-700 md:flex lg:gap-3">
          {navLinks.map((link) => {
            const active = link.children ? isToolsActive(link) : isLinkActive(pathname, hash, link);
            if (!link.children) {
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={handleNavLinkClick(link.href)}
                  className={`rounded-full border px-3 py-1.5 transition ${
                    active
                      ? "border-cyan-200 bg-cyan-50 text-slate-900"
                      : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  {link.label}
                </Link>
              );
            }
            return (
              <div key={link.label} ref={toolsMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowToolsMenu((prev) => !prev)}
                  aria-expanded={isToolsDropdownOpen(link)}
                  className={`rounded-full border px-3 py-1.5 transition ${
                    active
                      ? "border-cyan-200 bg-cyan-50 text-slate-900"
                      : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  {link.label}
                </button>
                <div
                  className={`absolute left-0 top-full z-20 mt-2 min-w-[230px] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.14)] transition-all duration-150 ${
                    isToolsDropdownOpen(link)
                      ? "pointer-events-auto visible opacity-100"
                      : "pointer-events-none invisible opacity-0"
                  }`}
                >
                  <div className="flex flex-col gap-1.5">
                    {link.children.map((child) => (
                      <Link
                        key={`${link.label}-${child.href}-${child.label}`}
                        href={child.href}
                        onClick={handleToolsLinkClick(child.href)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-slate-900"
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {authToken && wallet ? (
            <>
              <Link
                href="/dashboard"
                className="hidden rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 sm:inline"
              >
                Dashboard
              </Link>
              <span className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                Wallet: {wallet.credits}
              </span>
              <button
                type="button"
                onClick={() => {
                  setAuthToken("");
                  setWallet(null);
                  setAnalysisCount(0);
                  setStudioUnlocked(false);
                  setMobileMenuOpen(false);
                  window.localStorage.removeItem("hirescore_auth_token");
                }}
                className="hidden rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 sm:inline"
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link
                href={headerAuthHref}
                onClick={() => {
                  trackEvent("cta_auth_entry_click", {
                    cta_location: "header",
                    cta_label: "Sign Up / Login",
                  });
                }}
                className="hidden rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 md:inline-flex"
              >
                Sign Up / Login
              </Link>
              <Link
                href={headerAnalyzeHref}
                onClick={() => {
                  trackEvent("cta_instant_fit_click", {
                    cta_location: "header",
                    cta_label: "Instant Fit Check (Free)",
                  });
                }}
                className="rounded-xl border border-cyan-200 bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-600 sm:px-4 sm:py-2 sm:text-sm"
              >
                <span className="sm:hidden">Instant Fit</span>
                <span className="hidden sm:inline">Instant Fit Check (Free)</span>
              </Link>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen((prev) => !prev);
              setShowToolsMenu(false);
            }}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 md:hidden"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      <div className={`border-t border-slate-100 px-3 py-3 md:hidden ${mobileMenuOpen ? "block" : "hidden"}`}>
        <nav className="mx-auto grid w-full max-w-7xl grid-cols-2 gap-1.5 text-xs text-slate-700">
          {navLinks.map((link) => {
            const active = link.children ? isToolsActive(link) : isLinkActive(pathname, hash, link);
            if (!link.children) {
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={handleNavLinkClick(link.href)}
                  className={`inline-flex min-h-[40px] items-center justify-center rounded-lg border px-3 py-1.5 text-center transition ${
                    active
                      ? "border-cyan-200 bg-cyan-50 text-slate-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {link.label}
                </Link>
              );
            }
            return (
              <button
                key={link.label}
                type="button"
                onClick={() => setShowToolsMenu((prev) => !prev)}
                aria-expanded={isToolsDropdownOpen(link)}
                className={`col-span-2 inline-flex min-h-[40px] items-center justify-center rounded-lg border px-3 py-1.5 transition ${
                  active
                    ? "border-cyan-200 bg-cyan-50 text-slate-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {link.label}
              </button>
            );
          })}

          {!authToken && (
            <Link
              href={headerAuthHref}
              onClick={() => {
                setMobileMenuOpen(false);
                trackEvent("cta_auth_entry_click", {
                  cta_location: "header_mobile_menu",
                  cta_label: "Sign Up / Login",
                });
              }}
              className="col-span-2 inline-flex min-h-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Sign Up / Login
            </Link>
          )}

          {authToken && (
            <button
              type="button"
              onClick={() => {
                setAuthToken("");
                setWallet(null);
                setAnalysisCount(0);
                setStudioUnlocked(false);
                setMobileMenuOpen(false);
                window.localStorage.removeItem("hirescore_auth_token");
              }}
              className="col-span-1 inline-flex min-h-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Sign Out
            </button>
          )}

          {authToken && (
            <Link
              href="/dashboard"
              onClick={() => setMobileMenuOpen(false)}
              className="col-span-1 inline-flex min-h-[40px] items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-center font-semibold text-emerald-700"
            >
              Wallet {wallet?.credits ?? 0}
            </Link>
          )}
        </nav>

        {showToolsMenu && toolsNavLinks.length > 0 && (
          <div ref={mobileToolsPanelRef} className="mx-auto mt-2 grid w-full max-w-7xl gap-1.5 sm:grid-cols-2">
            {toolsNavLinks.map((child) => {
              const childActive = isLinkActive(pathname, hash, child);
              return (
                <Link
                  key={`mobile-tool-${child.label}`}
                  href={child.href}
                  onClick={(event) => {
                    handleToolsLinkClick(child.href)(event);
                    setMobileMenuOpen(false);
                  }}
                  className={`inline-flex min-h-[40px] items-center justify-center rounded-lg border px-3 py-2 text-center transition ${
                    childActive
                      ? "border-cyan-200 bg-cyan-50 text-slate-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {portalReady
        ? createPortal(
            <AnimatePresence>
              {showStudioLockModal && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[1400] flex min-h-dvh items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[4px]"
                  onClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    setShowStudioLockModal(false);
                  }}
                >
                  <motion.section
                    initial={{ opacity: 0, y: 18, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.97 }}
                    className="relative my-auto w-full max-w-lg overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.24)]"
                  >
                    <div className="relative">
                      <StudioLockVisual compact />
                      <p className="text-center text-xs uppercase tracking-[0.16em] text-slate-500">Resume Studio Gate</p>
                      <h3 className="mt-2 text-center text-2xl font-semibold text-slate-900 sm:text-3xl">
                        Let&apos;s Analyze Your Skills First
                      </h3>
                      <p className="mt-3 text-center text-sm text-slate-600">
                        Complete your first analysis on the Analysis page to unlock AI Resume Studio.
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
                          className="rounded-xl border border-cyan-200 bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-600"
                        >
                          Go To Analysis
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowStudioLockModal(false)}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Not Now
                        </button>
                      </div>
                    </div>
                  </motion.section>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </header>
  );
}
