import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

const outcomeCards = [
  {
    title: "Match score",
    description: "See how strongly your current resume fits the job description before you apply.",
  },
  {
    title: "Missing skills",
    description: "Spot the must-have gaps recruiters are likely to notice first.",
  },
  {
    title: "Clear suggestions",
    description: "Get practical resume fixes you can make right away for the role you want.",
  },
];

const workflowSteps = [
  "Paste your resume or upload the file.",
  "Paste the target job description or upload it.",
  "Review the score, missing skills, and shortlist-focused suggestions.",
];

export const metadata: Metadata = buildPageMetadata({
  title: "HireScore | Check if your resume will get shortlisted",
  description:
    "Check if your resume will get shortlisted by matching it against a job description and getting focused suggestions.",
  path: "/",
  keywords: [
    "check if resume will get shortlisted",
    "resume jd matcher",
    "resume shortlist checker",
    "resume suggestions",
    "resume match score",
  ],
});

export default function Home() {
  return (
    <main className="px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <section className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="accent-panel rounded-[2rem] p-7 sm:p-10 lg:p-12">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#dccdb6] bg-[#fff7eb] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[#7a846e]">
            <span className="live-dot" />
            Resume Shortlist Check
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight text-[#203528] sm:text-5xl lg:text-6xl">
            Check if your resume will get shortlisted.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-[#52604d] sm:text-lg">
            HireScore is now focused on one thing: matching your resume against a job description so you can see the score,
            understand the gaps, and improve the application before you send it.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/application-copilot"
              className="rounded-full bg-[#355e46] px-6 py-3 text-sm font-semibold text-[#f8f4ec] shadow-[0_18px_28px_rgba(53,94,70,0.18)] transition hover:bg-[#2d503c]"
            >
              Open Resume Matcher
            </Link>
            <Link
              href="#how-it-works"
              className="rounded-full border border-[#d7cab5] bg-[#fff8ee] px-6 py-3 text-sm font-semibold text-[#203528] transition hover:bg-[#f3eadc]"
            >
              See How It Works
            </Link>
          </div>
        </div>

        <div className="surface-panel rounded-[2rem] p-6 sm:p-8">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#7a846e]">What the matcher returns</p>
          <div className="mt-5 space-y-4">
            <div className="rounded-[1.4rem] border border-[#ddd0ba] bg-[#fffaf3] p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Resume match</p>
                  <p className="mt-1 text-4xl font-semibold text-[#203528]">78%</p>
                </div>
                <p className="max-w-[12rem] text-right text-sm leading-relaxed text-[#677463]">
                  A quick view of how close your current profile is to the role.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[1.2rem] border border-[#ddd0ba] bg-[#fff8ee] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Critical coverage</p>
                <p className="mt-2 text-2xl font-semibold text-[#203528]">82%</p>
              </div>
              <div className="rounded-[1.2rem] border border-[#ddd0ba] bg-[#fff8ee] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Missing skills</p>
                <p className="mt-2 text-2xl font-semibold text-[#203528]">4</p>
              </div>
              <div className="rounded-[1.2rem] border border-[#ddd0ba] bg-[#fff8ee] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Suggestions</p>
                <p className="mt-2 text-2xl font-semibold text-[#203528]">Actionable</p>
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-[#ddd0ba] bg-[#fff8ee] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Suggestion preview</p>
              <div className="mt-3 space-y-2">
                <div className="loading-bar h-3" />
                <div className="loading-bar h-3 w-[88%]" />
                <div className="loading-bar h-3 w-[74%]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 grid max-w-7xl gap-4 md:grid-cols-3">
        {outcomeCards.map((card) => (
          <article key={card.title} className="surface-panel rounded-[1.6rem] p-6">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#7a846e]">Included</p>
            <h2 className="mt-3 text-2xl font-semibold text-[#203528]">{card.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#52604d]">{card.description}</p>
          </article>
        ))}
      </section>

      <section id="how-it-works" className="mx-auto mt-10 max-w-7xl rounded-[2rem] border border-[#ddd0ba] bg-[#fff8ee] p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#7a846e]">How it works</p>
            <h2 className="mt-2 text-3xl font-semibold text-[#203528] sm:text-4xl">Three steps. One focused result.</h2>
          </div>
          <Link
            href="/application-copilot"
            className="rounded-full border border-[#d7cab5] bg-white px-5 py-2.5 text-sm font-semibold text-[#203528] transition hover:bg-[#f7efe3]"
          >
            Open Matcher
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {workflowSteps.map((step, index) => (
            <article key={step} className="surface-panel rounded-[1.4rem] p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-[#7a846e]">Step {index + 1}</p>
              <p className="mt-3 text-base leading-relaxed text-[#203528]">{step}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
