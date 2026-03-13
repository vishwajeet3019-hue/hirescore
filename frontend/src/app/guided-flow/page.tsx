import type { Metadata } from "next";
import TrackedLink from "../components/tracked-link";
import { addUtmParams } from "@/lib/utm";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Guided Flow | Resume To Interview Action Plan",
  description:
    "Follow one guided flow from resume upload to JD match, high-impact fixes, interview practice, and weekly execution plan.",
  alternates: {
    canonical: "/guided-flow",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/guided-flow`,
    title: "HireScore Guided Flow",
    description: "One guided workflow for better shortlist outcomes and interview readiness.",
  },
};

const flowSteps = [
  {
    title: "Upload Resume",
    description: "Start with your latest resume to establish baseline role-fit and shortlist confidence.",
    href: "/upload",
    ctaLabel: "Start Analysis",
  },
  {
    title: "JD Match + Gap Scan",
    description: "Run Application Copilot to compare your profile against a real job description.",
    href: "/application-copilot",
    ctaLabel: "Open Application Copilot",
  },
  {
    title: "High-Impact Fixes",
    description: "Prioritize top 3 improvements and apply edits before your next application batch.",
    href: "/application-copilot",
    ctaLabel: "Review Fixes",
  },
  {
    title: "Interview Practice",
    description: "Generate role-specific prep and rehearse with your personalized question set.",
    href: "/interview-prep",
    ctaLabel: "Open Interview Prep",
  },
  {
    title: "Weekly Action Plan",
    description: "Track applications, follow-ups, and weekly tasks from one dashboard.",
    href: "/dashboard",
    ctaLabel: "Open Dashboard Plan",
  },
];

export default function GuidedFlowPage() {
  const guidedFlowPricingHref = addUtmParams("/pricing", {
    source: "guided_flow",
    medium: "internal",
    campaign: "guided_flow_pricing",
  });
  const guidedFlowTrackerHref = addUtmParams("/application-copilot?tab=tracks", {
    source: "guided_flow",
    medium: "internal",
    campaign: "guided_flow_tracker",
  });

  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <section className="mx-auto max-w-7xl rounded-[2rem] border border-cyan-100/24 bg-[linear-gradient(155deg,rgba(8,30,56,0.94),rgba(5,17,33,0.96)_58%,rgba(15,41,58,0.9))] p-6 shadow-[0_26px_70px_rgba(2,8,22,0.48)] sm:p-10">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/72">Guided Growth Workflow</p>
        <h1 className="mt-3 text-3xl font-semibold text-cyan-50 sm:text-5xl">One Flow. Better Interview Outcomes.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-cyan-50/78 sm:text-base">
          Follow this path every week: diagnose your fit, fix the biggest gaps, practice interviews, and execute a
          tracked application plan.
        </p>
      </section>

      <section className="mx-auto mt-8 grid max-w-7xl gap-4 md:grid-cols-2 xl:grid-cols-5">
        {flowSteps.map((step, index) => (
          <article key={step.title} className="rounded-2xl border border-cyan-100/20 bg-cyan-100/8 p-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/70">Step {index + 1}</p>
            <h2 className="mt-2 text-lg font-semibold text-cyan-50">{step.title}</h2>
            <p className="mt-2 text-sm text-cyan-50/76">{step.description}</p>
            <TrackedLink
              href={addUtmParams(step.href, {
                source: "guided_flow",
                medium: "internal",
                campaign: "guided_flow_step",
                content: `step_${index + 1}`,
              })}
              eventName="guided_flow_step_click"
              eventParams={{ step: index + 1, label: step.title }}
              className="mt-4 inline-flex rounded-xl border border-cyan-100/34 bg-cyan-200/14 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
            >
              {step.ctaLabel}
            </TrackedLink>
          </article>
        ))}
      </section>

      <section className="mx-auto mt-8 max-w-7xl rounded-2xl border border-cyan-100/24 bg-[linear-gradient(150deg,rgba(7,24,44,0.9),rgba(5,16,31,0.94))] p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/70">Critical Retention Feature</p>
        <h3 className="mt-2 text-2xl font-semibold text-cyan-50 sm:text-3xl">Application Tracker + Weekly AI Coach</h3>
        <p className="mt-3 max-w-3xl text-sm text-cyan-50/78 sm:text-base">
          Save target roles as tracks, update status (saved/applied/interview/offer), and use weekly coach tasks to
          keep your pipeline active.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <TrackedLink
            href={guidedFlowTrackerHref}
            eventName="cta_application_tracker_open"
            eventParams={{ cta_location: "guided_flow", cta_label: "Open Application Tracker" }}
            className="rounded-xl border border-cyan-100/34 bg-cyan-200/16 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
          >
            Open Application Tracker
          </TrackedLink>
          <TrackedLink
            href={guidedFlowPricingHref}
            eventName="cta_view_premium_plans_click"
            eventParams={{ cta_location: "guided_flow", cta_label: "View Premium Plans" }}
            className="rounded-xl border border-cyan-100/24 px-4 py-2 text-sm font-semibold text-cyan-50/88 transition hover:bg-cyan-100/10"
          >
            View Premium Plans
          </TrackedLink>
        </div>
      </section>
    </main>
  );
}
