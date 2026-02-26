"use client";

import { usePathname } from "next/navigation";
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
      <SiteHeader />

      <main className="relative">{children}</main>

      <footer className="mt-20 border-t border-cyan-50/10 px-4 py-10 sm:mt-24 sm:px-6 sm:py-12">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/58 sm:tracking-[0.28em]">HireScore</p>
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
      </footer>
    </>
  );
}
