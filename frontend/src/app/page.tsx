"use client";

import Link from "next/link";

const proofStats = [
  { label: "Prediction Layers", value: "12+", showAurora: true },
  { label: "Role Universe", value: "Unlimited", showAurora: true },
  { label: "Resume Output Modes", value: "3", showAurora: false },
  { label: "Actionable Suggestions", value: "Deep Strategy", showAurora: false },
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
  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <div className="premium-panel holo-sheen relative overflow-hidden rounded-[2rem] p-6 sm:rounded-[2.2rem] sm:p-10 lg:p-12">
          <div className="absolute -top-24 right-[-60px] h-72 w-72 rounded-full bg-cyan-200/24 blur-[100px]" />
          <div className="absolute bottom-[-120px] left-[-40px] h-72 w-72 rounded-full bg-amber-100/16 blur-[110px]" />

          <div className="relative z-10 grid gap-10 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full glow-chip px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-cyan-100/82 sm:px-4 sm:text-xs sm:tracking-[0.28em]">
                <span className="live-dot" />
                Premium Resume Intelligence
              </p>

              <h1 className="mt-5 text-3xl font-semibold leading-tight text-cyan-50 sm:mt-6 sm:text-5xl lg:text-6xl">
                Stop Applying Blind.
                <span className="block bg-gradient-to-r from-cyan-100 via-cyan-300 to-amber-100 bg-clip-text text-transparent">
                  Know your real shortlisting chances before you apply.
                </span>
              </h1>

              <p className="mt-6 max-w-2xl text-sm leading-relaxed text-cyan-50/72 sm:text-base">
                HireScore helps candidates spend effort where it converts. Analyze role fit, close high-impact gaps, and
                build professional resumes that improve interview outcomes.
              </p>

              <div className="mt-8 flex flex-wrap gap-3 sm:mt-10 sm:gap-4">
                <Link
                  href="/upload"
                  className="w-full rounded-2xl border border-cyan-100/40 bg-gradient-to-r from-cyan-300/28 via-cyan-200/30 to-amber-100/20 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:brightness-110 sm:w-auto sm:px-7 sm:py-3.5"
                >
                  Check My Score (Free)
                </Link>

                <Link
                  href="/pricing"
                  className="w-full rounded-2xl border border-cyan-100/25 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto sm:px-7 sm:py-3.5"
                >
                  View Premium Plans
                </Link>
              </div>
            </div>

            <div className="space-y-3">
              {proofStats.map((stat) => (
                <div key={stat.label} className="holo-sheen soft-pulse rounded-2xl border border-cyan-100/18 bg-cyan-100/7 p-4">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/62 sm:text-xs sm:tracking-[0.2em]">{stat.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-cyan-50">{stat.value}</p>
                  {stat.showAurora && <div className="aurora-strip mt-3 h-1 rounded-full" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-7xl">
        <div className="grid gap-5 md:grid-cols-3">
          {valueCards.map((card, index) => (
            <article key={card.title} className="neon-panel holo-sheen rounded-3xl p-5 sm:p-6 transition-transform duration-200 hover:-translate-y-1">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/64 sm:text-xs sm:tracking-[0.2em]">Value {index + 1}</p>
              <h2 className="mt-4 text-xl font-semibold text-cyan-50 sm:text-2xl">{card.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-cyan-50/70">{card.description}</p>

              <div className="signal-line mt-6 h-2 rounded-full bg-cyan-100/12">
                <div className="h-full w-full rounded-full bg-gradient-to-r from-cyan-300 to-amber-100" />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-7xl">
        <div className="neon-panel rounded-[2rem] p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/64 sm:text-xs sm:tracking-[0.22em]">
                Reviews
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-cyan-50 sm:text-3xl">What Users In India Are Saying</h3>
            </div>
            <p className="text-sm text-cyan-50/62">Freshers and professionals across domains</p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {reviewCards.map((review) => (
              <article key={review.name} className="holo-sheen rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-5">
                <p className="text-sm leading-relaxed text-cyan-50/78">&quot;{review.quote}&quot;</p>
                <p className="mt-4 text-sm font-semibold text-cyan-50">{review.name}</p>
                <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/62">
                  {review.role} • {review.city}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-7xl">
        <div className="premium-panel rounded-[2rem] p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/64 sm:text-xs sm:tracking-[0.22em]">
            Success Stories
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-cyan-50 sm:text-4xl">
            Real Career Outcomes From Indian Users
          </h3>

          <div className="mt-7 grid gap-4 md:grid-cols-3">
            {successStories.map((story) => (
              <article key={story.title} className="holo-sheen rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/62">Case</p>
                <h4 className="mt-2 text-lg font-semibold text-cyan-50">{story.title}</h4>
                <p className="mt-2 text-xs uppercase tracking-[0.12em] text-cyan-100/60">{story.person}</p>
                <p className="mt-3 text-sm leading-relaxed text-cyan-50/74">{story.summary}</p>
                <p className="mt-4 text-sm font-semibold text-cyan-100">{story.outcome}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto mt-14 max-w-7xl">
        <div className="premium-panel holo-sheen rounded-[2rem] p-6 sm:p-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/64 sm:text-xs sm:tracking-[0.24em]">Workflow</p>
              <h3 className="mt-2 text-2xl font-semibold leading-tight text-cyan-50 sm:text-4xl">From Profile Input to Offer-Ready Resume</h3>
            </div>
            <Link
              href="/studio"
              className="w-full rounded-xl border border-cyan-100/30 bg-cyan-200/16 px-5 py-2.5 text-center text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/24 sm:w-auto"
            >
              Open Resume Studio
            </Link>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {workflowSteps.map((step, index) => (
              <article key={step.title} className="rounded-2xl border border-cyan-100/16 bg-cyan-100/6 p-5">
                <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/64 sm:text-xs sm:tracking-[0.2em]">Step {index + 1}</p>
                <h4 className="mt-2 text-lg font-semibold text-cyan-50 sm:text-xl">{step.title}</h4>
                <p className="mt-3 text-sm leading-relaxed text-cyan-50/72">{step.description}</p>
              </article>
            ))}
          </div>

        </div>
      </section>

      <section className="mx-auto mt-14 max-w-7xl">
        <div className="neon-panel holo-sheen rounded-[2rem] p-6 text-center sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/62 sm:text-xs sm:tracking-[0.26em]">Monetization Promise</p>
          <h3 className="mx-auto mt-3 max-w-3xl text-2xl font-semibold text-cyan-50 sm:text-4xl">
            You are not paying for a resume editor. You are paying for a higher probability of getting shortlisted.
          </h3>
          <div className="mt-8 flex flex-wrap justify-center gap-3 sm:gap-4">
            <Link
              href="/pricing"
              className="w-full rounded-2xl border border-cyan-100/40 bg-cyan-200/18 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto sm:px-7 sm:py-3.5"
            >
              Compare Plans
            </Link>
            <Link
              href="/upload"
              className="w-full rounded-2xl border border-cyan-100/25 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto sm:px-7 sm:py-3.5"
            >
              Start Analysis
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
