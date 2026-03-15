"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { addAuthChangeListener, clearStoredAuthToken, resolveAuthSession } from "@/lib/public-access";
import { addUtmParams } from "@/lib/utm";
import BrandLogo from "./brand-logo";

type CreditWallet = {
  credits: number;
};

type AuthPayload = {
  wallet?: CreditWallet;
  guest_mode?: boolean;
};

type NavLink = {
  href: string;
  label: string;
  tooltip: string;
};

const baseNavLinks: NavLink[] = [
  {
    href: "/tools",
    label: "Product",
    tooltip: "See HireScore product tools including analysis, resume builder, and interview practice.",
  },
  {
    href: "/pricing",
    label: "Pricing",
    tooltip: "Compare free and paid plans with feature access.",
  },
  {
    href: "/resources",
    label: "Resources",
    tooltip: "Read guides, case studies, and job-search playbooks.",
  },
];

const getPathWithoutParams = (href: string) => href.split("?")[0].split("#")[0];

const isLinkActive = (pathname: string, href: string) => {
  const target = getPathWithoutParams(href);
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(`${target}/`);
};

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const [authToken, setAuthToken] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const headerAnalyzeHref = addUtmParams("/instant-fit", {
    source: "header_nav",
    medium: "internal",
    campaign: "nav_start_free_analysis",
  });
  const headerAuthHref = addUtmParams("/upload?auth=login", {
    source: "header_nav",
    medium: "internal",
    campaign: "nav_login",
  });

  const navLinks = useMemo<NavLink[]>(() => {
    if (authToken && !guestMode) {
      return [
        ...baseNavLinks,
        {
          href: "/dashboard",
          label: "Login",
          tooltip: "You are logged in. Open your dashboard and saved analysis history.",
        },
      ];
    }
    return [
      ...baseNavLinks,
      {
        href: headerAuthHref,
        label: "Login",
        tooltip: "Sign in to save analyses, resume versions, and interview practice history.",
      },
    ];
  }, [authToken, guestMode, headerAuthHref]);

  useEffect(() => {
    const syncAuth = async () => {
      const session = await resolveAuthSession<AuthPayload>();
      if (session.error) {
        if (!session.token) {
          setAuthToken("");
          setWallet(null);
          setGuestMode(false);
        }
        return;
      }
      if (!session.payload) {
        setAuthToken("");
        setWallet(null);
        setGuestMode(false);
        return;
      }
      setAuthToken(session.token);
      setWallet(session.payload.wallet || null);
      setGuestMode(Boolean(session.payload.guest_mode));
    };

    void syncAuth();
    const unsubscribe = addAuthChangeListener(() => {
      void syncAuth();
    });
    return unsubscribe;
  }, [pathname]);

  const handleLogout = () => {
    setAuthToken("");
    setWallet(null);
    setGuestMode(false);
    setMobileMenuOpen(false);
    clearStoredAuthToken();
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-100/12 bg-[#031022]/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-3 sm:h-20 sm:px-6">
        <Link href="/" className="group" title="Go to HireScore homepage">
          <BrandLogo
            intro
            subtitle="AI Job Search Companion"
            titleClassName="text-sm tracking-wide sm:text-xl"
            subtitleClassName="text-[10px] tracking-[0.14em] sm:text-xs sm:tracking-[0.2em]"
          />
        </Link>

        <nav className="hidden items-center gap-1.5 text-sm font-medium text-cyan-50/90 xl:flex">
          {navLinks.map((link) => {
            const active = isLinkActive(pathname, link.href);
            const isLoginLink = link.label === "Login";
            return (
              <Link
                key={`${link.label}-${link.href}`}
                href={link.href}
                title={link.tooltip}
                onClick={() => {
                  setMobileMenuOpen(false);
                  if (isLoginLink && !authToken) {
                    trackEvent("cta_auth_entry_click", {
                      cta_location: "header_nav",
                      cta_label: "Login",
                    });
                  }
                }}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 transition ${
                  active
                    ? "border-cyan-100/48 bg-cyan-200/20 text-cyan-50"
                    : "border-transparent text-cyan-50/86 hover:border-cyan-100/30 hover:bg-cyan-100/10 hover:text-cyan-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {authToken && wallet && !guestMode ? (
            <>
              <span className="hidden rounded-xl border border-emerald-200/38 bg-emerald-200/14 px-2.5 py-1.5 text-xs font-semibold text-emerald-100 sm:inline-flex">
                Wallet: {wallet.credits}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="hidden rounded-xl border border-slate-100/24 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-100/88 transition hover:bg-slate-200/10 sm:inline"
                title="Sign out from this browser"
              >
                Sign Out
              </button>
            </>
          ) : guestMode ? (
            <span className="hidden rounded-xl border border-cyan-100/24 bg-cyan-200/10 px-3 py-1.5 text-xs font-semibold text-cyan-50/88 lg:inline-flex">
              Public Access
            </span>
          ) : (
            <Link
              href={headerAuthHref}
              onClick={() => {
                trackEvent("cta_auth_entry_click", {
                  cta_location: "header",
                  cta_label: "Login",
                });
              }}
              title="Sign in to save analyses and resume versions."
              className="hidden rounded-xl border border-slate-100/24 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-100/90 transition hover:bg-slate-200/10 lg:inline-flex"
            >
              Login
            </Link>
          )}

          <Link
            href={headerAnalyzeHref}
            onClick={() => {
              trackEvent("cta_instant_fit_click", {
                cta_location: "header",
                cta_label: "Start free analysis",
              });
            }}
            title="Start a free analysis by entering your target role and uploading your resume."
            className="rounded-xl border border-cyan-200/45 bg-cyan-300/18 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/28 sm:px-4 sm:py-2 sm:text-sm"
          >
            <span className="sm:hidden">Start free</span>
            <span className="hidden sm:inline">Start free analysis</span>
          </Link>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-100/24 bg-slate-100/8 px-3 text-xs font-semibold text-slate-100 transition hover:bg-slate-100/14 xl:hidden"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-slate-100/10 px-3 py-3 xl:hidden">
          <nav className="mx-auto grid w-full max-w-7xl grid-cols-2 gap-1.5 text-xs text-slate-100/90">
            {navLinks.map((link) => {
              const active = isLinkActive(pathname, link.href);
              const isLoginLink = link.label === "Login";
              return (
                <Link
                  key={`mobile-${link.label}-${link.href}`}
                  href={link.href}
                  title={link.tooltip}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (isLoginLink && !authToken) {
                      trackEvent("cta_auth_entry_click", {
                        cta_location: "header_mobile_menu",
                        cta_label: "Login",
                      });
                    }
                  }}
                  className={`inline-flex min-h-[40px] items-center justify-center rounded-lg border px-3 py-1.5 text-center transition ${
                    active
                      ? "border-cyan-100/46 bg-cyan-200/20 text-cyan-50"
                      : "border-slate-100/20 bg-slate-100/6 text-slate-100/88 hover:bg-slate-100/12"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}

            {authToken ? (
              <button
                type="button"
                onClick={handleLogout}
                className="col-span-2 inline-flex min-h-[40px] items-center justify-center rounded-lg border border-slate-100/20 bg-transparent px-3 py-1.5 text-center font-semibold text-slate-100/92 transition hover:bg-slate-100/12"
                title="Sign out from this browser"
              >
                Sign Out
              </button>
            ) : null}

            <Link
              href={headerAnalyzeHref}
              onClick={() => {
                setMobileMenuOpen(false);
                trackEvent("cta_instant_fit_click", {
                  cta_location: "header_mobile_menu",
                  cta_label: "Start free analysis",
                });
              }}
              title="Start a free analysis by entering your target role and uploading your resume."
              className="col-span-2 inline-flex min-h-[42px] items-center justify-center rounded-lg border border-cyan-200/45 bg-cyan-300/18 px-3 py-1.5 text-center font-semibold text-cyan-50 transition hover:bg-cyan-300/28"
            >
              Start free analysis
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
