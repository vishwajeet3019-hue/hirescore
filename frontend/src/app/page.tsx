import type { Metadata } from "next";
import GrowthShareSection from "./components/growth-share-section";
import TrackedLink from "./components/tracked-link";
import { seoLandingPages } from "@/lib/seo-landing-pages";
import { addUtmParams } from "@/lib/utm";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "AI Interview Simulator + Resume Analyzer for India | HireScore",
  description:
    "Run a live interview simulator, get role-fit analysis, shortlist prediction, and actionable improvements built for job seekers in India.",
  keywords: [
    "resume analyzer India",
    "interview simulator India",
    "ATS resume checker India",
    "job switch resume India",
    "JD matcher India",
  ],
  alternates: {
    canonical: "/",
  },
};

const proofStats = [
  { label: "Interview Practice", value: "Structured Mock Interviews" },
  { label: "Prediction Layers", value: "12+" },
  { label: "Jobs We Cover", value: "All Major Domains" },
  { label: "Free Guest Interview", value: "1 Without Login" },
];

const valueCards = [
  {
    title: "Shortlist Probability",
    description: "Know your realistic shortlist chance before you apply and avoid low-conversion submissions.",
  },
  {
    title: "Precision Gap Detection",
    description: "Detect must-have gaps instantly with role-specific insights, not generic resume advice.",
  },
  {
    title: "Build, Improve, Export",
    description: "Create resumes inside the platform, improve with AI, and download polished templates.",
  },
];

const workflowSteps = [
  {
    title: "Add Role Intent",
    description: "Enter target industry, role, and your current capabilities.",
  },
  {
    title: "Run Precision Analysis",
    description: "Get shortlist prediction, confidence, and high-priority improvement signals.",
  },
  {
    title: "Build Winning Resume",
    description: "Use guided suggestions to build and export a premium recruiter-ready resume.",
  },
];

const reviewCards = [
  {
    name: "Ananya Sharma",
    role: "Software Engineer",
    city: "Bengaluru",
    quote:
      "The shortlist prediction helped me stop random applying. I focused on better-fit roles and got interview calls within two weeks.",
  },
  {
    name: "Rohit Verma",
    role: "Sales Manager",
    city: "Mumbai",
    quote:
      "I liked that it worked for non-tech roles too. The suggestions were practical and directly improved my resume quality.",
  },
  {
    name: "Priya Nair",
    role: "Product Analyst",
    city: "Pune",
    quote:
      "The confidence score and gap insights made my preparation clear. My resume now looks far more professional and focused.",
  },
];

const successStories = [
  {
    title: "Fresher To First Interview",
    person: "Karthik R. • Chennai",
    summary: "Used role-fit analysis + in-platform builder to move from no callbacks to scheduled interviews.",
    outcome: "Interview response improved from low to consistent",
  },
  {
    title: "Career Switch With Clarity",
    person: "Sneha P. • Hyderabad",
    summary: "Switched from operations to product-facing roles by closing must-have skill gaps identified in analysis.",
    outcome: "Shortlist probability improved after profile rebuild",
  },
  {
    title: "Higher Conversion In 30 Days",
    person: "Arjun M. • Delhi NCR",
    summary: "Used premium templates and targeted suggestions to optimize each application batch.",
    outcome: "More recruiter replies from the same application volume",
  },
];

export default function Home() {
  const featuredGuides = seoLandingPages.slice(0, 3);
  const homeUploadHref = addUtmParams("/instant-fit", {
    source: "home",
    medium: "organic",
    campaign: "home_instant_fit",
  });
  const homeGuidedFlowHref = addUtmParams("/guided-flow", {
    source: "home",
    medium: "organic",
    campaign: "home_guided_flow",
  });
  const homePricingHref = addUtmParams("/pricing", {
    source: "home",
    medium: "organic",
    campaign: "home_hero",
  });
  const homeInterviewDemoHref = addUtmParams("/interview-simulator?mode=demo", {
    source: "home",
    medium: "organic",
    campaign: "home_demo_hero",
  });
  const homeCaseStudiesHref = addUtmParams("/case-studies", {
    source: "home",
    medium: "organic",
    campaign: "home_case_studies",
  });
  const homeStudioHref = addUtmParams("/studio", {
    source: "home",
    medium: "organic",
    campaign: "home_workflow",
  });
  const homeResourcesHref = addUtmParams("/resources", {
    source: "home",
    medium: "organic",
    campaign: "home_resources",
  });
  const homeFeatureGuidesHref = addUtmParams("/features", {
    source: "home",
    medium: "organic",
    campaign: "home_feature_guides",
  });
  const homeToolsHubHref = addUtmParams("/tools", {
    source: "home",
    medium: "organic",
    campaign: "home_tools_hub",
  });
  const homeMonetizationUploadHref = addUtmParams("/upload", {
    source: "home",
    medium: "organic",
    campaign: "home_monetization",
  });
  const homeMonetizationPricingHref = addUtmParams("/pricing", {
    source: "home",
    medium: "organic",
    campaign: "home_monetization",
  });

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "HireScore AI",
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    areaServed: {
      "@type": "Country",
      name: "India",
    },
    sameAs: [],
  };

  const softwareApplicationJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "HireScore AI",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    areaServed: {
      "@type": "Country",
      name: "India",
    },
    description:
      "AI-powered resume analyzer and builder with role-fit scoring, shortlist prediction, and template exports.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
    },
  };

  return (
    <main className="min-h-screen bg-[#f7f9fc] px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />

      <section className="mx-auto max-w-7xl">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)] sm:p-8 lg:p-10">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1.5 text-xs font-medium tracking-[0.08em] text-slate-700">
                HireScore • hirescore.in
              </p>

              <h1 className="mt-6 text-4xl font-semibold leading-[1.05] text-slate-900 sm:text-5xl lg:text-6xl">
                Building interview-ready careers,
                <span className="block bg-gradient-to-r from-cyan-500 via-emerald-500 to-lime-500 bg-clip-text text-transparent">
                  one focused application at a time.
                </span>
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-600">
                Run live interview practice, check role-fit confidence, close must-have gaps, and build recruiter-ready resumes without switching tools.
              </p>

              <div className="mt-8 flex flex-wrap gap-3 sm:gap-4">
                <TrackedLink
                  href={homeUploadHref}
                  eventName="cta_instant_fit_click"
                  eventParams={{ cta_location: "home_hero", cta_label: "Instant Fit Check (Free)" }}
                  className="w-full rounded-2xl border border-amber-300 bg-amber-300 px-6 py-3 text-center text-sm font-semibold text-slate-900 transition hover:bg-amber-200 sm:w-auto sm:px-7 sm:py-3.5"
                >
                  Instant Fit Check (Free)
                </TrackedLink>

                <TrackedLink
                  href={homeGuidedFlowHref}
                  eventName="guided_flow_step_click"
                  eventParams={{ cta_location: "home_hero", step: 0, label: "Guided Flow" }}
                  className="w-full rounded-2xl border border-emerald-100/34 bg-gradient-to-r from-emerald-300/24 via-cyan-300/20 to-cyan-200/14 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:brightness-110 sm:w-auto sm:px-7 sm:py-3.5"
                >
                  Open Guided Flow
                </TrackedLink>

                <TrackedLink
                  href={homeInterviewDemoHref}
                  eventName="cta_interview_demo_click"
                  eventParams={{ cta_location: "home_hero", cta_label: "Try Free 90-Second Interview" }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-6 py-3 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto sm:px-7 sm:py-3.5"
                >
                  Try Free 90-Second Interview
                </TrackedLink>

                <TrackedLink
                  href={homePricingHref}
                  eventName="cta_view_premium_plans_click"
                  eventParams={{ cta_location: "home_hero", cta_label: "View Premium Plans" }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-6 py-3 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto sm:px-7 sm:py-3.5"
                >
                  View Premium Plans
                </TrackedLink>
              </div>
            </div>

            <div>
              <div className="relative overflow-hidden rounded-[1.6rem] border border-slate-200 bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 p-6 sm:p-8">
                <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan-200/60 blur-2xl" />
                <div className="absolute -bottom-10 -left-8 h-24 w-24 rounded-full bg-emerald-200/70 blur-2xl" />

                <div className="relative space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Role Fit Snapshot</p>
                    <div className="mt-3 flex items-end justify-between">
                      <p className="text-3xl font-semibold text-slate-900">82%</p>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        Strong Match
                      </span>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-slate-100">
                      <div className="h-2 w-[82%] rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Next Actions</p>
                    <ul className="mt-3 space-y-2 text-sm text-slate-700">
                      <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Improve quantified impact in latest role</li>
                      <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Align summary with target job keywords</li>
                      <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Practice 10 high-priority interview prompts</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {proofStats.map((stat) => (
              <article key={stat.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-slate-500">{stat.label}</p>
                <p className="mt-1.5 text-lg font-semibold text-slate-900">{stat.value}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-7xl">
        <div className="grid gap-5 md:grid-cols-3">
          {valueCards.map((card, index) => (
            <article
              key={card.title}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.05)] transition-transform duration-200 hover:-translate-y-1"
            >
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Value {index + 1}</p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">{card.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-7xl">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_14px_34px_rgba(15,23,42,0.06)] sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Reviews</p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">What users in India are saying</h3>
            </div>
            <p className="text-sm text-slate-500">Freshers and professionals across domains</p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {reviewCards.map((review) => (
              <article key={review.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm leading-relaxed text-slate-700">&quot;{review.quote}&quot;</p>
                <p className="mt-4 text-sm font-semibold text-slate-900">{review.name}</p>
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">
                  {review.role} • {review.city}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto mt-12 max-w-7xl">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_14px_34px_rgba(15,23,42,0.06)] sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Workflow</p>
              <h3 className="mt-2 text-2xl font-semibold leading-tight text-slate-900 sm:text-3xl">
                From profile upload to interview-ready output
              </h3>
            </div>
            <TrackedLink
              href={homeStudioHref}
              eventName="cta_navigation"
              eventParams={{ cta_location: "home_workflow", cta_label: "Open Resume Studio" }}
              className="w-full rounded-xl border border-cyan-200 bg-cyan-500 px-5 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-cyan-600 sm:w-auto"
            >
              Open Resume Studio
            </TrackedLink>
          </div>

          <div className="mt-7 grid gap-4 md:grid-cols-3">
            {workflowSteps.map((step, index) => (
              <article key={step.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Step {index + 1}</p>
                <h4 className="mt-2 text-lg font-semibold text-slate-900">{step.title}</h4>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-7xl">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_14px_34px_rgba(15,23,42,0.06)] sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Success Stories</p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">Real outcomes from Indian users</h3>
            </div>
            <TrackedLink
              href={homeCaseStudiesHref}
              eventName="cta_case_studies_click"
              eventParams={{ cta_location: "home_case_studies", cta_label: "View All Proof Stories" }}
              className="w-full rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto"
            >
              View All Proof Stories
            </TrackedLink>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {successStories.map((story) => (
              <article key={story.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{story.person}</p>
                <h4 className="mt-2 text-lg font-semibold text-slate-900">{story.title}</h4>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{story.summary}</p>
                <p className="mt-4 text-sm font-semibold text-cyan-700">{story.outcome}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <GrowthShareSection location="home" title="HireScore AI Resume Analyzer" />

      <section className="mx-auto mt-12 max-w-7xl">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_14px_34px_rgba(15,23,42,0.06)] sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">SEO Guides</p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">Role-specific resume playbooks</h3>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <TrackedLink
                href={homeResourcesHref}
                eventName="cta_navigation"
                eventParams={{ cta_location: "home_resources", cta_label: "Explore All Guides" }}
                className="w-full rounded-xl border border-cyan-200 bg-cyan-500 px-5 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-cyan-600 sm:w-auto"
              >
                Explore All {seoLandingPages.length} Guides
              </TrackedLink>
              <TrackedLink
                href={homeFeatureGuidesHref}
                eventName="cta_navigation"
                eventParams={{ cta_location: "home_resources", cta_label: "Feature Guides" }}
                className="w-full rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto"
              >
                Feature Guides
              </TrackedLink>
              <TrackedLink
                href={homeToolsHubHref}
                eventName="cta_navigation"
                eventParams={{ cta_location: "home_resources", cta_label: "Tools Hub" }}
                className="w-full rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto"
              >
                Tools Hub
              </TrackedLink>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {featuredGuides.map((guide) => (
              <article key={guide.slug} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{guide.roleFocus}</p>
                <h4 className="mt-2 text-lg font-semibold text-slate-900">{guide.title}</h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{guide.metaDescription}</p>
                <TrackedLink
                  href={addUtmParams(`/resources/${guide.slug}`, {
                    source: "home_resources",
                    medium: "organic",
                    campaign: "home_guide_featured",
                    content: guide.slug,
                  })}
                  eventName="cta_resources_open"
                  eventParams={{ cta_location: "home_resources", cta_label: "Read Guide", content: guide.slug }}
                  className="mt-4 inline-flex rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Read Guide
                </TrackedLink>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-7xl">
        <div className="rounded-[2rem] border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-cyan-900 p-6 text-center shadow-[0_18px_40px_rgba(15,23,42,0.3)] sm:p-10">
          <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/80">Conversion Promise</p>
          <h3 className="mx-auto mt-3 max-w-3xl text-2xl font-semibold text-white sm:text-4xl">
            You are not paying for another resume editor. You are paying for better shortlisting outcomes.
          </h3>
          <div className="mt-8 flex flex-wrap justify-center gap-3 sm:gap-4">
            <TrackedLink
              href={homeMonetizationPricingHref}
              eventName="cta_view_premium_plans_click"
              eventParams={{ cta_location: "home_monetization", cta_label: "Compare Plans" }}
              className="w-full rounded-2xl border border-amber-300 bg-amber-300 px-6 py-3 text-center text-sm font-semibold text-slate-900 transition hover:bg-amber-200 sm:w-auto sm:px-7 sm:py-3.5"
            >
              Compare Plans
            </TrackedLink>
            <TrackedLink
              href={homeMonetizationUploadHref}
              eventName="cta_check_my_score_click"
              eventParams={{ cta_location: "home_monetization", cta_label: "Start Analysis" }}
              className="w-full rounded-2xl border border-cyan-200/40 bg-white/10 px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/20 sm:w-auto sm:px-7 sm:py-3.5"
            >
              Start Analysis
            </TrackedLink>
          </div>
        </div>
      </section>
    </main>
  );
}
