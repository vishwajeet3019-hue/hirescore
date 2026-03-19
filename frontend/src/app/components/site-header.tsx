"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import BrandLogo from "./brand-logo";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/application-copilot", label: "Matcher" },
  { href: "/privacy-policy", label: "Privacy" },
];

const isLinkActive = (pathname: string, href: string) => {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
};

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#d9ccb5] bg-[#f7f1e7]/94 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:h-20 sm:px-6">
        <Link href="/" className="group" title="Go to HireScore homepage">
          <BrandLogo titleClassName="text-base sm:text-xl" />
        </Link>

        <nav className="hidden items-center gap-2 xl:flex">
          {navLinks.map((link) => {
            const active = isLinkActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  active ? "bg-[#e7dece] font-semibold text-[#203528]" : "text-[#52604d] hover:bg-[#efe6d8] hover:text-[#203528]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/application-copilot"
            className="rounded-full bg-[#355e46] px-4 py-2 text-sm font-semibold text-[#f8f4ec] shadow-[0_14px_24px_rgba(53,94,70,0.18)] transition hover:bg-[#2d503c]"
          >
            Open Matcher
          </Link>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-[#d6cab6] bg-[#fff8ee] px-3 text-xs font-semibold text-[#203528] xl:hidden"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div className="border-t border-[#e1d5c2] px-4 py-3 xl:hidden">
          <nav className="mx-auto grid w-full max-w-7xl gap-2 text-sm">
            {navLinks.map((link) => {
              const active = isLinkActive(pathname, link.href);
              return (
                <Link
                  key={`mobile-${link.href}`}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-2xl px-4 py-3 transition ${
                    active ? "bg-[#e7dece] font-semibold text-[#203528]" : "bg-[#fff8ee] text-[#52604d]"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
