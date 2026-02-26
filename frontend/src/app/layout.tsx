import type { Metadata } from "next";
import SiteHeader from "./components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "HireScore AI",
  description: "AI-powered resume analysis and optimization platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased overflow-x-hidden">
        <div className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
          <div className="futuristic-grid animate-grid-drift" />
          <div className="animate-orbital absolute -left-28 top-10 h-80 w-80 rounded-full bg-cyan-400/20 blur-[110px]" />
          <div className="animate-orbital absolute -right-20 top-56 h-96 w-96 rounded-full bg-sky-400/20 blur-[140px]" />
          <div className="animate-drift absolute bottom-[-180px] left-1/3 h-[360px] w-[360px] rounded-full bg-amber-200/16 blur-[130px]" />
        </div>

        <SiteHeader />

        <main className="relative z-10">{children}</main>

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
      </body>
    </html>
  );
}
