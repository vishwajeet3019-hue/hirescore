import type { Metadata } from "next";
import Link from "next/link";
import TrackedLink from "./components/tracked-link";
import { seoLandingPages } from "@/lib/seo-landing-pages";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "AI Resume Analyzer for Better Shortlisting",
  description:
    "Run AI role-fit analysis, see shortlist prediction, and improve your resume with actionable recommendations.",
  alternates: {
    canonical: "/",
  },
};

const proofStats = [
  { label: "Prediction Layers", value: "12+" },
  { label: "Jobs We Cover", value: "All Major Domains" },
  { label: "Premium Resume Templates", value: "6" },
  { label: "Actionable Suggestions", value: "Deep Strategy" },
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
    description: "Enter target industry, target role, and your current capabilities.",
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
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "HireScore AI",
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    sameAs: [],
  };

  const softwareApplicationJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "HireScore AI",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
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
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />

      <section className="mx-auto max-w-7xl">
        <div className="premium-panel relative overflow-hidden rounded-[2.25rem] p-6 sm:p-10">
          <div className="absolute -right-24 -top-20 h-72 w-72 rounded-full bg-cyan-300/12 blur-[96px]" />
          <div className="absolute -left-20 bottom-[-130px] h-72 w-72 rounded-full bg-amber-100/12 blur-[96px]" />
          <div className="relative z-10 grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full glow-chip px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-cyan-100/80 sm:px-4 sm:text-xs sm:tracking-[0.24em]">
                <span className="live-dot" />
                Resume Intelligence Platform
              </p>
              <h1 className="mt-5 text-3xl font-semibold leading-[1.08] text-cyan-50 sm:text-5xl lg:text-6xl">
                Build A Stronger
                <span className="block bg-gradient-to-r from-cyan-100 via-cyan-300 to-amber-100 bg-clip-text text-transparent">
                  Interview Pipeline
                </span>
              </h1>
              <p className="mt-6 max-w-2xl text-sm leading-relaxed text-cyan-50/72 sm:text-base">
                Measure role fit, close application gaps, and improve shortlist outcomes using a structured, data-backed process.
              </p>
              <div className="mt-8 flex flex-wrap gap-3 sm:gap-4">
                <TrackedLink
                  href="/upload"
                  eventName="cta_check_my_score_click"
                  eventParams={{ cta_location: "home_hero", cta_label: "Run Assessment" }}
                  className="w-full rounded-2xl border border-cyan-100/40 bg-gradient-to-r from-cyan-300/24 via-cyan-200/24 to-amber-100/16 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:brightness-110 sm:w-auto"
                >
                  Run Assessment
                </TrackedLink>
                <TrackedLink
                  href="/pricing"
                  eventName="cta_view_premium_plans_click"
                  eventParams={{ cta_location: "home_hero", cta_label: "View Plans" }}
                  className="w-full rounded-2xl border border-cyan-100/30 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-100/10 sm:w-auto"
                >
                  View Plans
                </TrackedLink>
              </div>

              <div className="mt-8 overflow-hidden rounded-xl border border-cyan-100/20 bg-cyan-100/8 p-3">
                <div className="marquee-track">
                  {proofStats.map((stat) => (
                    <span key={stat.label} className="inline-flex items-center gap-2 text-xs font-medium text-cyan-50/80">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-200" />
                      {stat.label}: {stat.value}
                    </span>
                  ))}
                  {proofStats.map((stat) => (
                    <span key={`${stat.label}-dup`} className="inline-flex items-center gap-2 text-xs font-medium text-cyan-50/80">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-200" />
                      {stat.label}: {stat.value}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <aside className="grid gap-4 sm:grid-cols-[0.7fr_1fr] xl:grid-cols-[0.62fr_1fr]">
              <div className="rounded-2xl border border-cyan-100/20 bg-cyan-100/7 p-4">
                <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/66">Operating Flow</p>
                <ol className="mt-3 space-y-3">
                  {workflowSteps.map((step, index) => (
                    <li key={step.title} className="relative pl-7 text-xs text-cyan-50/78">
                      <span className="absolute left-0 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-cyan-100/34 text-[10px] font-semibold text-cyan-100">
                        {index + 1}
                      </span>
                      <span className="font-semibold text-cyan-50">{step.title}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="neon-panel rounded-2xl p-4">
                <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/66">Live Assessment Board</p>
                <div className="mt-3 space-y-3">
                  {valueCards.map((card) => (
                    <article key={card.title} className="rounded-xl border border-cyan-100/22 bg-cyan-100/8 px-3 py-3">
                      <h3 className="text-sm font-semibold text-cyan-50">{card.title}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-cyan-50/72">{card.description}</p>
                    </article>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-7xl">
        <div className="neon-panel rounded-[2rem] p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/66">Outcome Matrix</p>
              <h2 className="mt-2 text-2xl font-semibold text-cyan-50 sm:text-3xl">Where the platform improves conversion quality</h2>
            </div>
            <p className="text-sm text-cyan-50/70">Designed for fresher and experienced applicants</p>
          </div>
          <div className="mt-5 overflow-hidden rounded-xl border border-cyan-100/22">
            <table className="w-full text-left">
              <thead className="bg-cyan-100/12 text-[11px] uppercase tracking-[0.12em] text-cyan-100/70">
                <tr>
                  <th className="px-4 py-3 font-medium">Focus Area</th>
                  <th className="px-4 py-3 font-medium">Platform Signal</th>
                  <th className="px-4 py-3 font-medium">Expected Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyan-100/12">
                {valueCards.map((card, index) => (
                  <tr key={card.title} className="bg-cyan-100/6">
                    <td className="px-4 py-3 text-sm font-semibold text-cyan-50">Track {index + 1}: {card.title}</td>
                    <td className="px-4 py-3 text-sm text-cyan-50/74">{card.description}</td>
                    <td className="px-4 py-3 text-sm text-cyan-50/74">{successStories[index]?.outcome || "Improved shortlist consistency"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto mt-12 max-w-7xl">
        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <article className="premium-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/62">Client Results</p>
            <h3 className="mt-2 text-2xl font-semibold text-cyan-50 sm:text-3xl">Recent improvement stories</h3>
            <div className="mt-5 space-y-4">
              {successStories.map((story, index) => (
                <article key={story.title} className="relative border-l border-cyan-100/20 pl-4">
                  <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-cyan-200" />
                  <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/62">Case {index + 1}</p>
                  <h4 className="mt-1 text-lg font-semibold text-cyan-50">{story.title}</h4>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-cyan-100/62">{story.person}</p>
                  <p className="mt-2 text-sm text-cyan-50/74">{story.summary}</p>
                </article>
              ))}
            </div>
          </article>

          <div className="space-y-4">
            <article className="neon-panel rounded-2xl p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/62">Execution Path</p>
              <div className="mt-3 space-y-3">
                {workflowSteps.map((step, index) => (
                  <div key={step.title} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/62">Step {index + 1}</p>
                    <p className="mt-1 text-sm font-semibold text-cyan-50">{step.title}</p>
                    <p className="mt-1 text-xs text-cyan-50/74">{step.description}</p>
                  </div>
                ))}
              </div>
            </article>
            <article className="premium-panel rounded-2xl p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/62">Resume Studio</p>
              <p className="mt-2 text-sm leading-relaxed text-cyan-50/72">
                Apply role-specific edits, structure achievements, and export a professional resume aligned to your target role.
              </p>
              <Link
                href="/studio"
                className="mt-4 inline-flex rounded-xl border border-cyan-100/34 bg-cyan-200/16 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
              >
                Open Resume Studio
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-7xl">
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <article className="premium-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/62">User Feedback</p>
            <h3 className="mt-2 text-2xl font-semibold text-cyan-50">Trusted by candidates across India</h3>
            <div className="mt-4 space-y-3">
              {reviewCards.map((review) => (
                <blockquote key={review.name} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-4">
                  <p className="text-sm text-cyan-50/78">&ldquo;{review.quote}&rdquo;</p>
                  <footer className="mt-2 text-xs uppercase tracking-[0.12em] text-cyan-100/62">
                    {review.name} • {review.role} • {review.city}
                  </footer>
                </blockquote>
              ))}
            </div>
          </article>
          <article className="neon-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/62">Knowledge Base</p>
            <h3 className="mt-2 text-2xl font-semibold text-cyan-50">Role-Specific Resume Playbooks</h3>
            <div className="mt-4 divide-y divide-cyan-100/14 rounded-xl border border-cyan-100/18 bg-cyan-100/7">
              {featuredGuides.map((guide) => (
                <article key={guide.slug} className="p-4">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/62">{guide.roleFocus}</p>
                  <h4 className="mt-1 text-sm font-semibold text-cyan-50">{guide.title}</h4>
                  <p className="mt-1 text-xs text-cyan-50/70">{guide.metaDescription}</p>
                  <Link
                    href={`/resources/${guide.slug}`}
                    className="mt-2 inline-flex text-xs font-semibold text-cyan-100 underline-offset-2 transition hover:underline"
                  >
                    Read Guide
                  </Link>
                </article>
              ))}
            </div>
            <Link
              href="/resources"
              className="mt-5 inline-flex rounded-xl border border-cyan-100/30 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-100/10"
            >
              Explore All {seoLandingPages.length} Guides
            </Link>
          </article>
        </div>
      </section>
    </main>
  );
}
