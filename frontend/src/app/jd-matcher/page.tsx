import type { Metadata } from "next";
import { addUtmParams } from "@/lib/utm";
import TrackedLink from "../components/tracked-link";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

const matcherWorkspaceHref = addUtmParams("/upload", {
  source: "jd_matcher_page",
  medium: "internal",
  campaign: "jd_matcher",
});

const studioHref = addUtmParams("/studio", {
  source: "jd_matcher_page",
  medium: "internal",
  campaign: "jd_matcher",
});

export const metadata: Metadata = {
  title: "JD Matcher | Job Description Match Scanner",
  description:
    "Match your resume against any job description, identify missing keywords, and get action-ready rewrite suggestions.",
  alternates: {
    canonical: "/jd-matcher",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/jd-matcher`,
    title: "HireScore JD Matcher",
    description: "Scan JD fit, uncover keyword gaps, and improve interview shortlist probability.",
  },
  twitter: {
    card: "summary_large_image",
    title: "HireScore JD Matcher",
    description: "Dedicated JD matching workspace with gap insights and targeted improvement actions.",
  },
};

const matcherHighlights = [
  {
    title: "Keyword Gap Scanner",
    detail: "Find missing role-specific terms recruiters and ATS systems check first.",
  },
  {
    title: "Role Fit Snapshot",
    detail: "Get a clear fit percentage so you know whether to apply now or optimize first.",
  },
  {
    title: "Action Suggestions",
    detail: "Use generated bullet suggestions to improve your resume relevance faster.",
  },
];

const quickFlow = [
  "Paste or upload the job description.",
  "Run JD Match to evaluate role alignment.",
  "Apply recommendations, then export from AI Resume Studio.",
];

export default function JdMatcherPage() {
  return (
    <main className="min-h-screen px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-6xl rounded-[2rem] border border-cyan-100/24 bg-[linear-gradient(150deg,rgba(8,28,52,0.93),rgba(5,18,34,0.96)_58%,rgba(18,46,58,0.86))] p-6 shadow-[0_26px_70px_rgba(2,8,22,0.48)] sm:p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/78">Dedicated Tool</p>
        <h1 className="mt-3 text-3xl font-semibold text-cyan-50 sm:text-5xl">JD Matcher Command Center</h1>
        <p className="mt-3 max-w-3xl text-sm text-cyan-50/78 sm:text-base">
          Compare your resume against any target job description, identify what is missing, and move to high-confidence
          applications with clearer role fit.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <TrackedLink
            href={matcherWorkspaceHref}
            eventName="cta_check_my_score_click"
            eventParams={{ cta_location: "jd_matcher_page", cta_label: "Open JD Matcher Workspace" }}
            className="rounded-xl border border-cyan-100/40 bg-cyan-200/18 px-5 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/26"
          >
            Open JD Matcher Workspace
          </TrackedLink>
          <TrackedLink
            href={studioHref}
            eventName="cta_studio_open"
            eventParams={{ cta_location: "jd_matcher_page", cta_label: "Open AI Resume Studio" }}
            className="rounded-xl border border-cyan-100/30 bg-cyan-100/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-100/16"
          >
            Open AI Resume Studio
          </TrackedLink>
        </div>
      </section>

      <section className="mx-auto mt-6 grid max-w-6xl gap-4 lg:grid-cols-3">
        {matcherHighlights.map((item) => (
          <article
            key={item.title}
            className="rounded-2xl border border-cyan-100/22 bg-[linear-gradient(145deg,rgba(7,27,50,0.86),rgba(4,18,36,0.9))] p-5"
          >
            <h2 className="text-base font-semibold text-cyan-50">{item.title}</h2>
            <p className="mt-2 text-sm text-cyan-100/78">{item.detail}</p>
          </article>
        ))}
      </section>

      <section className="mx-auto mt-6 max-w-6xl rounded-[1.6rem] border border-cyan-100/20 bg-[linear-gradient(145deg,rgba(6,23,44,0.86),rgba(3,15,30,0.92))] p-5 sm:p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/70">Quick Flow</p>
        <ol className="mt-3 grid gap-3 text-sm text-cyan-50/84 sm:grid-cols-3">
          {quickFlow.map((step, index) => (
            <li key={step} className="rounded-xl border border-cyan-100/18 bg-cyan-100/8 p-3">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100/76">Step {index + 1}</span>
              <p className="mt-1">{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
