"use client";

import { usePathname } from "next/navigation";
import BrandLogo from "./brand-logo";
import CaptureDeterrence from "./capture-deterrence";
import FloatingSupportChat from "./floating-support-chat";
import SiteHeader from "./site-header";
import TrackedLink from "./tracked-link";
import { addUtmParams } from "@/lib/utm";

type AppChromeProps = {
  children: React.ReactNode;
};

export default function AppChrome({ children }: AppChromeProps) {
  const pathname = usePathname() || "/";
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminRoute) {
    return <main className="relative">{children}</main>;
  }

  return (
    <>
      <CaptureDeterrence />
      <SiteHeader />

      <main className="relative">{children}</main>

      <footer className="mt-20 border-t border-cyan-50/10 px-4 py-10 sm:mt-24 sm:px-6 sm:py-12">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-3">
          <div>
            <BrandLogo
              subtitle="Interview Calls Made Easier"
              titleClassName="text-lg"
              subtitleClassName="text-[10px] tracking-[0.16em]"
            />
            <p className="mt-3 text-sm text-cyan-50/72">
              Premium resume intelligence platform focused on one outcome: increasing your interview conversion.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/58 sm:tracking-[0.28em]">Platform</p>
            <div className="mt-3 space-y-2 text-sm text-cyan-50/72">
              <p>Shortlist prediction by role intent</p>
              <p>Actionable improvement roadmaps</p>
              <p>In-platform resume building</p>
              <p>Application Copilot, live interview simulator, and interview prep workflows</p>
            </div>
            <div className="mt-4 grid gap-2 text-sm">
              <TrackedLink
                href={addUtmParams("/tools", {
                  source: "footer",
                  medium: "internal",
                  campaign: "site_footer",
                })}
                eventName="cta_navigation"
                eventParams={{ cta_location: "footer", cta_label: "Tools Hub" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
              >
                Tools Hub
              </TrackedLink>
              <TrackedLink
                href={addUtmParams("/application-copilot", {
                  source: "footer",
                  medium: "internal",
                  campaign: "site_footer",
                })}
                eventName="cta_navigation"
                eventParams={{ cta_location: "footer", cta_label: "Application Copilot" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
              >
                Application Copilot
              </TrackedLink>
              <TrackedLink
                href={addUtmParams("/interview-simulator", {
                  source: "footer",
                  medium: "internal",
                  campaign: "site_footer",
                })}
                eventName="cta_navigation"
                eventParams={{ cta_location: "footer", cta_label: "Interview Simulator" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
              >
                Interview Simulator
              </TrackedLink>
              <TrackedLink
                href={addUtmParams("/resources", {
                  source: "footer",
                  medium: "internal",
                  campaign: "site_footer",
                })}
                eventName="cta_resources_open"
                eventParams={{ cta_location: "footer", cta_label: "Resume Optimization Guides" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
              >
                Resume Optimization Guides
              </TrackedLink>
              <TrackedLink
                href={addUtmParams("/case-studies", {
                  source: "footer",
                  medium: "internal",
                  campaign: "site_footer",
                })}
                eventName="cta_case_studies_click"
                eventParams={{ cta_location: "footer", cta_label: "Success Stories" }}
                className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50"
              >
                Success Stories
              </TrackedLink>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/58 sm:tracking-[0.28em]">Trust Signal</p>
            <div className="mt-3 space-y-2 text-sm text-cyan-50/72">
              <p>Role-specific scoring for technical and non-technical careers</p>
              <p>Transparent confidence and prediction logic</p>
              <p>Built for freshers and experienced professionals</p>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-7xl text-center text-[11px] uppercase tracking-[0.12em] text-cyan-50/46 sm:text-xs sm:tracking-[0.2em]">
          Built for candidates who want measurable shortlist outcomes
        </p>
        <p className="mx-auto mt-3 max-w-7xl text-center text-sm text-cyan-50/68">
          Support:{" "}
          <a href="mailto:contact@hirescore.in" className="font-semibold text-cyan-100 hover:text-cyan-50">
            contact@hirescore.in
          </a>
        </p>
      </footer>

      <FloatingSupportChat />
    </>
  );
}
