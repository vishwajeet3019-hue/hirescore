"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandLogo from "./brand-logo";
import CaptureDeterrence from "./capture-deterrence";
import FloatingSupportChat from "./floating-support-chat";
import SiteHeader from "./site-header";

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

      <footer className="mt-20 border-t border-cyan-100/18 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(241,245,249,0.98))] px-4 py-10 sm:mt-24 sm:px-6 sm:py-12">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-3">
          <div>
            <BrandLogo
              subtitle="Professional Resume Assessment"
              titleClassName="text-lg"
              subtitleClassName="text-[10px] tracking-[0.16em]"
            />
            <p className="mt-3 text-sm text-cyan-50/72">
              Professional resume assessment platform focused on measurable shortlist improvement.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/58 sm:tracking-[0.28em]">Platform</p>
            <div className="mt-3 space-y-2 text-sm text-cyan-50/72">
              <p>Shortlist prediction by role intent</p>
              <p>Actionable improvement roadmaps</p>
              <p>In-platform resume building</p>
              <Link href="/resources" className="inline-block font-semibold text-cyan-100 transition hover:text-cyan-50">
                Resume Optimization Guides
              </Link>
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
