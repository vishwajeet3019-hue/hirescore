import type { Metadata } from "next";
import ApplicationCopilotClient from "./application-copilot-client";
import { buildPageMetadata } from "@/lib/seo";

const beforeApplyPoints = [
  "Know if your resume will pass ATS",
  "See why recruiters reject your profile",
  "Fix issues before sending applications",
];

const faqs = [
  {
    question: "What do I need to run the score check?",
    answer: "Your resume and the target job description. You can paste both or upload files.",
  },
  {
    question: "Do I need an account first?",
    answer: "No. We only capture your name so your score checks can appear in your dashboard.",
  },
  {
    question: "What do I see first?",
    answer: "You see your score, likely hiring status, and the top rejection reasons before any deeper unlock.",
  },
];

export const metadata: Metadata = buildPageMetadata({
  title: "Check My Resume Score (Free) | HireScore",
  description:
    "Get your ATS score, likely rejection reasons, and a partial resume decision before you apply.",
  path: "/application-copilot",
  keywords: [
    "check my resume score free",
    "resume rejection reasons",
    "ats score checker",
    "resume shortlisted or rejected",
    "resume job description score",
  ],
});

type ApplicationCopilotPageProps = {
  searchParams?: Promise<{
    entry?: string | string[];
    focus?: string | string[];
  }>;
};

const readSearchParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";

export default async function ApplicationCopilotPage({ searchParams }: ApplicationCopilotPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const entry = readSearchParam(resolvedSearchParams?.entry).toLowerCase();
  const focus = readSearchParam(resolvedSearchParams?.focus).toLowerCase();
  const shouldLeadWithMatcher = Boolean(entry) || focus === "matcher";

  return (
    <main className="relative overflow-hidden px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      {shouldLeadWithMatcher ? (
        <section className="editorial-panel mono-grid mx-auto max-w-7xl rounded-[2rem] p-6 sm:p-8 lg:p-10">
          <p className="inline-flex rounded-full bg-black px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
            Score checker
          </p>
          <h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-[1.04] tracking-[-0.03em] text-[#111111] sm:text-5xl">
            Check your resume score now.
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-black/68">
            Paste your resume and the job description to see if you're likely to get shortlisted before you apply.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <span className="glow-chip rounded-full px-3 py-2 text-sm font-medium text-black/66">Lands on the score checker</span>
            <span className="glow-chip rounded-full px-3 py-2 text-sm font-medium text-black/66">No account required</span>
            <span className="glow-chip rounded-full px-3 py-2 text-sm font-medium text-black/66">Private resume check</span>
          </div>
        </section>
      ) : (
        <section className="editorial-panel mono-grid mx-auto max-w-7xl rounded-[2rem] p-6 sm:p-8 lg:p-10">
          <p className="inline-flex rounded-full bg-black px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
            No account required
          </p>
          <h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-[1.04] tracking-[-0.03em] text-[#111111] sm:text-5xl">
            Upload your resume, paste the job description, and see if you're likely to get shortlisted.
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-black/68">
            HireScore is designed to answer one question quickly: should you apply with this resume, or fix it first?
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <span className="glow-chip rounded-full px-3 py-2 text-sm font-medium text-black/66">Score first</span>
            <span className="glow-chip rounded-full px-3 py-2 text-sm font-medium text-black/66">Private resume check</span>
            <span className="glow-chip rounded-full px-3 py-2 text-sm font-medium text-black/66">Decision in seconds</span>
          </div>
        </section>
      )}

      <section className="ink-banner mx-auto mt-8 max-w-7xl rounded-[1.8rem] px-6 py-5 text-center text-base font-semibold sm:text-lg">
        80% of resumes never reach a human recruiter. Check yours before applying.
      </section>

      <section id="matcher-workspace" className="mx-auto mt-8 max-w-7xl scroll-mt-28">
        <ApplicationCopilotClient />
      </section>

      <section className="mx-auto mt-8 grid max-w-7xl gap-4 md:grid-cols-3">
        {beforeApplyPoints.map((point, index) => (
          <article key={point} className="editorial-panel rounded-[1.5rem] p-6">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">
                0{index + 1}
              </span>
              <p className="text-base leading-relaxed text-[#111111]">{point}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="editorial-panel mx-auto mt-10 max-w-7xl rounded-[2rem] p-6 sm:p-8">
        <h2 className="text-2xl font-semibold text-[#111111]">Frequently asked questions</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {faqs.map((faq) => (
            <article key={faq.question} className="rounded-[1.5rem] border border-black/10 bg-white/90 p-5 shadow-[0_16px_34px_rgba(17,17,17,0.04)]">
              <h3 className="text-base font-semibold text-[#111111]">{faq.question}</h3>
              <p className="mt-3 text-sm leading-relaxed text-black/66">{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
