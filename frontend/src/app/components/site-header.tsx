"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = {
  href: string;
  label: string;
  isSection?: boolean;
};

const navLinks: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Analyze" },
  { href: "/studio", label: "Resume Studio" },
  { href: "/#workflow", label: "How It Works", isSection: true },
  { href: "/pricing", label: "Pricing" },
];

const isLinkActive = (pathname: string, link: NavLink) => {
  if (link.isSection) {
    return pathname === "/";
  }
  if (link.href === "/") {
    return pathname === "/";
  }
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
};

export default function SiteHeader() {
  const pathname = usePathname() || "/";

  return (
    <header className="sticky top-0 z-50 border-b border-cyan-100/12 bg-[#030c1b]/78 backdrop-blur-2xl">
      <div className="border-b border-cyan-100/8 px-3 py-2 sm:px-6 sm:py-2.5">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-2 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-cyan-50/70 sm:gap-3 sm:text-[11px] sm:tracking-[0.24em]">
          <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.9)]" />
          Precision shortlist prediction platform for every role
        </p>
      </div>

      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-3 sm:h-20 sm:px-6">
        <Link href="/" className="group flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/45 bg-cyan-300/12 shadow-[0_0_24px_rgba(94,228,255,0.25)] sm:h-11 sm:w-11 sm:rounded-2xl">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-200 shadow-[0_0_15px_rgba(190,246,255,0.95)]" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-100/70 sm:text-xs sm:tracking-[0.34em]">HireScore</p>
            <p className="font-mono text-sm tracking-wide text-cyan-50 sm:text-xl">Resume Studio</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-4 text-sm font-medium text-cyan-50/78 md:flex">
          {navLinks.map((link) => {
            const active = isLinkActive(pathname, link);
            return (
              <Link
                key={link.href}
                href={link.href}
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

        <Link
          href="/upload"
          className="rounded-xl border border-cyan-200/45 bg-gradient-to-r from-cyan-300/20 via-cyan-200/18 to-amber-100/12 px-3 py-1.5 text-xs font-semibold text-cyan-100 shadow-[0_0_18px_rgba(80,223,255,0.22)] transition hover:brightness-110 sm:px-4 sm:py-2 sm:text-sm"
        >
          <span className="sm:hidden">Analyze</span>
          <span className="hidden sm:inline">Check My Score (Free)</span>
        </Link>
      </div>

      <div className="border-t border-cyan-100/8 px-3 py-2 md:hidden">
        <nav className="mx-auto flex w-full max-w-7xl items-center gap-2 overflow-x-auto whitespace-nowrap text-xs text-cyan-50/80">
          {navLinks.map((link) => {
            const active = isLinkActive(pathname, link);
            return (
              <Link
                key={link.href}
                href={link.href}
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
        </nav>
      </div>
    </header>
  );
}
