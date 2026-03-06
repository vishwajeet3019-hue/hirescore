import type { Metadata } from "next";
import TrackedLink from "../components/tracked-link";
import GrowthShareSection from "../components/growth-share-section";
import { addUtmParams } from "@/lib/utm";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Case Studies - Resume Results and Interview Conversion",
  description:
    "Real examples of how users improved resume quality and interview conversion with AI role-fit scoring, gap fixes, and targeted resume optimization.",
  alternates: {
    canonical: "/case-studies",
  },
};

const caseStudies = [
  {
    title: "Fresher To First Interview",
    person: "Karthik R. • Chennai",
    role: "Software Engineer (0-1 years)",
    result: "Interview response improved from low to consistent in 3 weeks.",
    metric: "1st interview achieved from 24 applications",
    detail:
      "Used role-fit analysis + targeted action plan to remove generic bullets and add impact-focused achievements before applying in waves.",
  },
  {
    title: "Career Switch With Clarity",
    person: "Sneha P. • Hyderabad",
    role: "Operations to Product Support",
    result: "Shortlist probability improved after profile rebuild.",
    metric: "3x improvement in recruiter replies",
    detail:
      "Converted operational experience to role-match signals by reframing ownership, results, and metrics for product-facing applications.",
  },
  {
    title: "Higher Conversion In 30 Days",
    person: "Arjun M. • Delhi NCR",
    role: "Product Analyst",
    result: "More recruiter replies from the same application volume.",
    metric: "4+ callbacks from 1 interview prep cycle",
    detail:
      "Applied monthly action plans with shortlisting predictions before each application batch and improved output quality using priority fixes.",
  },
  {
    title: "Higher Offer Confidence",
    person: "Nisha S. • Pune",
    role: "Business Analyst (2 years)",
    result: "Moved from 'no response' to scheduled recruiter screens.",
    metric: "7 relevant calls in 28 days",
    detail:
      "Reworked project language around decisions influenced, not tasks completed, and aligned achievements to business outcomes.",
  },
];

export default function CaseStudiesPage() {
  const startAnalysisHref = addUtmParams("/upload", {
    source: "case_studies",
    medium: "organic",
    campaign: "case_studies",
  });
  const resourcesHref = addUtmParams("/resources", {
    source: "case_studies",
    medium: "organic",
    campaign: "case_studies",
  });

  const caseStudiesJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "HireScore AI Case Studies",
    url: `${SITE_URL}/case-studies`,
    itemListElement: caseStudies.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.title,
      item: `${SITE_URL}/case-studies`,
      description: item.result,
    })),
  };

  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(caseStudiesJsonLd) }}
      />

      <section className="mx-auto max-w-5xl">
        <div className="premium-panel rounded-[2rem] p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/64 sm:text-xs sm:tracking-[0.2em]">
            Real Results
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">
            Case Studies
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-cyan-50/74 sm:text-base">
            Results are generated from users using our role-fit scoring, gap detection, and guided roadmap approach.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <TrackedLink
              href={startAnalysisHref}
              eventName="cta_check_my_score_click"
              eventParams={{ cta_location: "case_studies", cta_label: "Start My Resume Check" }}
              className="w-full rounded-2xl border border-cyan-100/40 bg-cyan-200/18 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto"
            >
              Start My Resume Check
            </TrackedLink>
            <TrackedLink
              href={resourcesHref}
              eventName="cta_resources_open"
              eventParams={{ cta_location: "case_studies", cta_label: "Browse Resume Guides" }}
              className="w-full rounded-2xl border border-cyan-100/25 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto"
            >
              Browse Resume Guides
            </TrackedLink>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-5xl">
        <div className="grid gap-4 md:grid-cols-2">
          {caseStudies.map((item) => (
            <article key={item.title} className="neon-panel rounded-2xl p-6">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/62 sm:text-xs sm:tracking-[0.2em]">
                {item.role}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-cyan-50">{item.title}</h2>
              <p className="mt-2 text-sm text-cyan-50/72">{item.person}</p>
              <p className="mt-4 rounded-xl border border-cyan-100/26 bg-cyan-100/8 px-3 py-2 text-sm font-semibold text-cyan-50/88">
                {item.result}
              </p>
              <p className="mt-3 text-sm text-cyan-100">{item.metric}</p>
              <p className="mt-3 text-sm leading-relaxed text-cyan-50/74">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <GrowthShareSection
        location="case_studies"
        title="HireScore AI Case Studies"
      />
    </main>
  );
}
