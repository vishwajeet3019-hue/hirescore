import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "HireScore AI",
  description: "AI-powered resume analysis and optimization platform",
};

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Analyze" },
  { href: "/studio", label: "Resume Studio" },
  { href: "/#workflow", label: "How It Works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/admin", label: "Admin" },
];

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

            <nav className="hidden items-center gap-8 text-sm font-medium text-cyan-50/78 md:flex">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className="transition hover:text-cyan-100">
                  {link.label}
                </Link>
              ))}
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
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg border border-cyan-100/18 bg-cyan-100/6 px-3 py-1.5 transition hover:bg-cyan-100/12"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

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
