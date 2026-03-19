import type { Metadata } from "next";
import ApplicationCopilotClient from "./application-copilot-client";
import { buildPageMetadata } from "@/lib/seo";

const benefitCards = [
  {
    title: "Resume vs JD match score",
    description: "Check how strongly your current resume aligns with the role before you apply.",
  },
  {
    title: "Matched and missing skills",
    description: "See what is already working and what still needs evidence in your resume.",
  },
  {
    title: "Shortlist-focused suggestions",
    description: "Get clearer fixes for bullets, keywords, and skill proof instead of generic advice.",
  },
];

const faqs = [
  {
    question: "What do I need to run the matcher?",
    answer: "Your resume text and the target job description. You can paste them or upload files.",
  },
  {
    question: "Does it only work for software roles?",
    answer: "No. The matcher is designed for both tech and non-tech job descriptions.",
  },
  {
    question: "Is the matcher free right now?",
    answer: "Yes. Payments and credit-based access are temporarily disabled while the site is focused on this single workflow.",
  },
];

export const metadata: Metadata = buildPageMetadata({
  title: "Resume JD Matcher | Match score and suggestions",
  description:
    "Match your resume against a job description, see the score, review missing skills, and get shortlist-focused suggestions.",
  path: "/application-copilot",
  keywords: [
    "resume jd matcher",
    "resume vs job description score",
    "resume shortlist checker",
    "missing skills checker",
    "resume suggestions",
  ],
});

export default function ApplicationCopilotPage() {
  return (
    <main className="px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <section className="mx-auto max-w-7xl rounded-[2rem] border border-[#ddd0ba] bg-[#fff8ee] p-6 sm:p-8 lg:p-10">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#7a846e]">Resume Matcher</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-tight text-[#203528] sm:text-5xl">
          See the score, the missing skills, and the suggestions that matter before you apply.
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#52604d]">
          This page is now the center of HireScore. It is built to help you check resume-to-JD fit quickly without the extra
          clutter of pricing, credits, blogs, or side tools.
        </p>
      </section>

      <section className="mx-auto mt-8 grid max-w-7xl gap-4 md:grid-cols-3">
        {benefitCards.map((card) => (
          <article key={card.title} className="surface-panel rounded-[1.6rem] p-6">
            <h2 className="text-xl font-semibold text-[#203528]">{card.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#52604d]">{card.description}</p>
          </article>
        ))}
      </section>

      <section className="mx-auto mt-8 max-w-7xl">
        <ApplicationCopilotClient />
      </section>

      <section className="mx-auto mt-8 max-w-7xl rounded-[2rem] border border-[#ddd0ba] bg-[#fff8ee] p-6 sm:p-8">
        <h2 className="text-2xl font-semibold text-[#203528]">Frequently asked questions</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {faqs.map((faq) => (
            <article key={faq.question} className="surface-panel rounded-[1.4rem] p-5">
              <h3 className="text-base font-semibold text-[#203528]">{faq.question}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#52604d]">{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
