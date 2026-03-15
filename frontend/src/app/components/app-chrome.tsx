"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import BrandLogo from "./brand-logo";
import CaptureDeterrence from "./capture-deterrence";
import FloatingSupportChat from "./floating-support-chat";
import PublicAccessBootstrap from "./public-access-bootstrap";
import SiteHeader from "./site-header";
import TrackedLink from "./tracked-link";
import { addUtmParams } from "@/lib/utm";

type AppChromeProps = {
  children: React.ReactNode;
};

export default function AppChrome({ children }: AppChromeProps) {
  const pathname = usePathname() || "/";
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  const pageUrl = useMemo(() => `https://hirescore.in${pathname}`, [pathname]);
  const shareText = useMemo(
    () => `I used HireScore to check interview chances, improve my resume, and practice mock interviews. ${pageUrl}`,
    [pageUrl],
  );
  const whatsappShareHref = useMemo(() => `https://wa.me/?text=${encodeURIComponent(shareText)}`, [shareText]);
  const linkedInShareHref = useMemo(
    () => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`,
    [pageUrl],
  );

  if (isAdminRoute) {
    return <main className="relative">{children}</main>;
  }

  return (
    <>
      <PublicAccessBootstrap />
      <CaptureDeterrence />
      <SiteHeader />

      <main className="relative">{children}</main>

      <footer className="mt-20 border-t border-cyan-50/12 px-4 py-10 sm:mt-24 sm:px-6 sm:py-12">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-4">
          <div>
            <BrandLogo
              subtitle="AI Job Search Companion"
              titleClassName="text-lg"
              subtitleClassName="text-[10px] tracking-[0.16em]"
            />
            <p className="mt-3 text-sm text-cyan-50/76">
              HireScore helps candidates apply smarter with interview prediction, resume guidance, and mock interview practice.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/60 sm:tracking-[0.28em]">Product</p>
            <div className="mt-3 grid gap-2 text-sm">
              <TrackedLink
                href={addUtmParams("/instant-fit", {
                  source: "footer",
                  medium: "internal",
                  campaign: "site_footer",
                })}
                eventName="cta_instant_fit_click"
                eventParams={{ cta_location: "footer", cta_label: "Start free analysis" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
                title="Start a free role-fit analysis in the guided flow."
              >
                Start free analysis
              </TrackedLink>
              <TrackedLink
                href={addUtmParams("/pricing", {
                  source: "footer",
                  medium: "internal",
                  campaign: "site_footer",
                })}
                eventName="cta_view_premium_plans_click"
                eventParams={{ cta_location: "footer", cta_label: "See plans" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
                title="Compare pricing tiers and feature access."
              >
                See plans
              </TrackedLink>
              <TrackedLink
                href={addUtmParams("/interview-simulator", {
                  source: "footer",
                  medium: "internal",
                  campaign: "site_footer",
                })}
                eventName="cta_navigation"
                eventParams={{ cta_location: "footer", cta_label: "Try mock interview" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
                title="Open the mock interview simulator."
              >
                Try mock interview
              </TrackedLink>
              <TrackedLink
                href={addUtmParams("/resources", {
                  source: "footer",
                  medium: "internal",
                  campaign: "site_footer",
                })}
                eventName="cta_resources_open"
                eventParams={{ cta_location: "footer", cta_label: "Resources" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
                title="Browse guides, templates, and case studies."
              >
                Resources
              </TrackedLink>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/60 sm:tracking-[0.28em]">Trust & Legal</p>
            <div className="mt-3 space-y-2 text-sm text-cyan-50/76">
              <p>Model reads skills, keywords, and experience to estimate role fit.</p>
              <p>No data is shared with employers without consent.</p>
            </div>
            <div className="mt-4 grid gap-2 text-sm">
              <TrackedLink
                href="/privacy-policy"
                eventName="cta_navigation"
                eventParams={{ cta_location: "footer", cta_label: "Privacy Policy" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
                title="Read how your personal data is handled."
              >
                Privacy Policy
              </TrackedLink>
              <TrackedLink
                href="/terms-of-service"
                eventName="cta_navigation"
                eventParams={{ cta_location: "footer", cta_label: "Terms of Service" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
                title="Read service terms and account responsibilities."
              >
                Terms of Service
              </TrackedLink>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/60 sm:tracking-[0.28em]">Share</p>
            <p className="mt-3 text-sm text-cyan-50/76">
              Know someone actively job searching? Share HireScore with them.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <a
                href={whatsappShareHref}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-cyan-100/30 bg-cyan-100/10 px-3 py-1.5 font-semibold text-cyan-100 transition hover:bg-cyan-100/20"
                title="Share this page on WhatsApp"
              >
                WhatsApp
              </a>
              <a
                href={linkedInShareHref}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-cyan-100/30 bg-cyan-100/10 px-3 py-1.5 font-semibold text-cyan-100 transition hover:bg-cyan-100/20"
                title="Share this page on LinkedIn"
              >
                LinkedIn
              </a>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-7xl text-center text-[11px] uppercase tracking-[0.12em] text-cyan-50/48 sm:text-xs sm:tracking-[0.2em]">
          Built for candidates who want clarity before they apply
        </p>
        <p className="mx-auto mt-3 max-w-7xl text-center text-sm text-cyan-50/70">
          Support: <a href="mailto:contact@hirescore.in" className="font-semibold text-cyan-100 hover:text-cyan-50">contact@hirescore.in</a>
        </p>
      </footer>

      <FloatingSupportChat />
    </>
  );
}
