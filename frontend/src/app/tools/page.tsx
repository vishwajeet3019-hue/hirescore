import type { Metadata } from "next";
import TrackedLink from "../components/tracked-link";
import GrowthShareSection from "../components/growth-share-section";
import { addUtmParams } from "@/lib/utm";

const tools = [
  {
    title: "Application Copilot",
    description: "Run JD match, matched skills review, missing skills detection, and action-ready feedback in one flow.",
    href: "/application-copilot",
    ctaLabel: "Open Copilot",
    tag: "JD Matching",
  },
  {
    title: "AI Resume Studio",
    description: "Build ATS-friendly resumes with guided AI writing support and recruiter-ready structure.",
    href: "/ai-resume-studio",
    ctaLabel: "Open Resume Studio",
    tag: "Resume Builder",
  },
  {
    title: "Interview Simulator",
    description: "Practice realistic interview rounds with feedback loops to improve answer clarity and confidence.",
    href: "/interview-simulator",
    ctaLabel: "Start Simulation",
    tag: "Interview Practice",
  },
  {
    title: "Analysis",
    description: "Measure role-fit quality and shortlist readiness, then prioritize the highest-impact profile fixes.",
    href: "/analysis",
    ctaLabel: "Run Analysis",
    tag: "Readiness Score",
  },
  {
    title: "Instant Fit Check",
    description: "Get a fast pre-application fit signal to decide where to invest deeper customization effort.",
    href: "/instant-fit",
    ctaLabel: "Try Instant Fit",
    tag: "Quick Scan",
  },
  {
    title: "Interview Prep",
    description: "Generate preparation checkpoints from role context and practice with a clear interview roadmap.",
    href: "/interview-prep",
    ctaLabel: "Open Interview Prep",
    tag: "Prep Planner",
  },
];

export const metadata: Metadata = {
  title: "HireScore Tools | JD Matching, Resume Builder, Interview Simulator",
  description:
    "Explore all live HireScore tools for JD matching, resume optimization, shortlist prediction, and interview simulation.",
  alternates: {
    canonical: "/tools",
  },
  keywords: [
    "hirescore tools",
    "jd matcher tool",
    "ai resume builder",
    "interview simulator online",
    "resume analysis tool",
    "job application copilot",
  ],
};

export default function ToolsPage() {
  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <div className="premium-panel rounded-[2rem] p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70 sm:text-xs sm:tracking-[0.24em]">
            HireScore Platform
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">
            All Tools In One Place
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-cyan-50/74 sm:text-base">
            Access the complete tool stack for job applications: JD matching, resume optimization, analysis, and live
            interview simulation.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <TrackedLink
              href={addUtmParams("/features", {
                source: "tools_hub",
                medium: "organic",
                campaign: "tools_feature_guides",
              })}
              eventName="cta_feature_guides_open"
              eventParams={{ cta_location: "tools_hub_hero", cta_label: "Open Feature Guides" }}
              className="w-full rounded-2xl border border-cyan-100/40 bg-cyan-200/18 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto"
            >
              Open Feature Guides
            </TrackedLink>
            <TrackedLink
              href={addUtmParams("/pricing", {
                source: "tools_hub",
                medium: "organic",
                campaign: "tools_pricing",
              })}
              eventName="cta_pricing_open"
              eventParams={{ cta_location: "tools_hub_hero", cta_label: "View Pricing" }}
              className="w-full rounded-2xl border border-cyan-100/24 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto"
            >
              View Pricing
            </TrackedLink>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-7xl">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => (
            <article key={tool.href} className="holo-sheen rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/62 sm:text-xs sm:tracking-[0.2em]">
                {tool.tag}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-cyan-50">{tool.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-cyan-50/74">{tool.description}</p>
              <TrackedLink
                href={addUtmParams(tool.href, {
                  source: "tools_hub",
                  medium: "organic",
                  campaign: "tools_card_open",
                  content: tool.href.replace("/", ""),
                })}
                eventName="cta_tool_card_open"
                eventParams={{ cta_location: "tools_hub_card", tool_path: tool.href }}
                className="mt-4 inline-flex rounded-xl border border-cyan-100/34 bg-cyan-200/14 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/22"
              >
                {tool.ctaLabel}
              </TrackedLink>
            </article>
          ))}
        </div>
      </section>

      <GrowthShareSection location="tools_hub" title="HireScore Tools Hub" />
    </main>
  );
}
