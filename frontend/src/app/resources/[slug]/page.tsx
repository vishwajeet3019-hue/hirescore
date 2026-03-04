import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TrackedLink from "@/app/components/tracked-link";
import {
  getKeywordVariantsBySlug,
  getRelatedSeoLandingPages,
  getSeoLandingPageBySlug,
  seoLandingPages,
} from "@/lib/seo-landing-pages";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return seoLandingPages.map((item) => ({
    slug: item.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getSeoLandingPageBySlug(slug);
  if (!page) {
    return {
      title: "Guide Not Found",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: page.title,
    description: page.metaDescription,
    keywords: [page.keyword, ...getKeywordVariantsBySlug(page.slug)],
    alternates: {
      canonical: `/resources/${page.slug}`,
    },
    openGraph: {
      title: `${page.title} | HireScore AI`,
      description: page.metaDescription,
      url: `${SITE_URL}/resources/${page.slug}`,
      type: "article",
    },
  };
}

export default async function SeoLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const page = getSeoLandingPageBySlug(slug);
  if (!page) notFound();

  const keywordVariants = getKeywordVariantsBySlug(page.slug);
  const relatedPages = getRelatedSeoLandingPages(page.slug, 3);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.h1,
    description: page.metaDescription,
    author: {
      "@type": "Organization",
      name: "HireScore AI",
    },
    publisher: {
      "@type": "Organization",
      name: "HireScore AI",
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/icon.svg`,
      },
    },
    mainEntityOfPage: `${SITE_URL}/resources/${page.slug}`,
  };

  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />

      <section className="mx-auto max-w-5xl">
        <div className="premium-panel rounded-[2rem] p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70 sm:text-xs sm:tracking-[0.24em]">
            Role-Specific Resume Guide
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">{page.h1}</h1>
          <p className="mt-4 text-sm leading-relaxed text-cyan-50/74 sm:text-base">{page.intro}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.12em] text-cyan-100/62">
            <span className="rounded-lg border border-cyan-100/24 bg-cyan-100/8 px-3 py-1.5">{page.roleFocus}</span>
            <span className="rounded-lg border border-cyan-100/24 bg-cyan-100/8 px-3 py-1.5">{page.keyword}</span>
          </div>
          <p className="mt-5 text-sm text-cyan-50/74">
            Search intent this page solves: <span className="font-semibold text-cyan-50">{page.searchIntent}</span>
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <TrackedLink
              href={`/upload?utm_source=seo_landing&utm_medium=organic&utm_campaign=${page.slug}`}
              eventName="cta_check_my_score_click"
              eventParams={{ cta_location: "seo_landing_hero", cta_label: "Check My Score (Free)", page: page.slug }}
              className="w-full rounded-2xl border border-cyan-100/40 bg-cyan-200/18 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto"
            >
              Check My Score (Free)
            </TrackedLink>
            <TrackedLink
              href={`/pricing?utm_source=seo_landing&utm_medium=organic&utm_campaign=${page.slug}`}
              eventName="cta_view_premium_plans_click"
              eventParams={{ cta_location: "seo_landing_hero", cta_label: "View Premium Plans", page: page.slug }}
              className="w-full rounded-2xl border border-cyan-100/25 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto"
            >
              View Premium Plans
            </TrackedLink>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-2">
        <article className="neon-panel rounded-2xl p-6 md:col-span-2">
          <h2 className="text-xl font-semibold text-cyan-50">Queries People Actually Type</h2>
          <p className="mt-2 text-sm text-cyan-50/72">
            These are natural search phrases commonly used by Indian jobseekers for this exact intent.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {keywordVariants.map((phrase) => (
              <span
                key={phrase}
                className="rounded-lg border border-cyan-100/22 bg-cyan-100/8 px-2.5 py-1 text-xs text-cyan-50/82"
              >
                {phrase}
              </span>
            ))}
          </div>
        </article>

        <article className="neon-panel rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-cyan-50">Common Resume Gaps</h2>
          <ul className="mt-4 space-y-3">
            {page.painPoints.map((point) => (
              <li key={point} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3 text-sm text-cyan-50/76">
                {point}
              </li>
            ))}
          </ul>
        </article>

        <article className="neon-panel rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-cyan-50">What You Get From HireScore</h2>
          <ul className="mt-4 space-y-3">
            {page.whatYouGet.map((point) => (
              <li key={point} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3 text-sm text-cyan-50/76">
                {point}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="mx-auto mt-10 max-w-5xl">
        <div className="premium-panel rounded-2xl p-6 sm:p-8">
          <h2 className="text-2xl font-semibold text-cyan-50">3-Step Conversion Plan</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {page.actionPlan.map((step) => (
              <article key={step} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-4">
                <p className="text-sm leading-relaxed text-cyan-50/78">{step}</p>
              </article>
            ))}
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <TrackedLink
              href={`/upload?utm_source=seo_landing&utm_medium=organic&utm_campaign=${page.slug}&step=plan`}
              eventName="cta_check_my_score_click"
              eventParams={{ cta_location: "seo_landing_plan", cta_label: "Start My Analysis", page: page.slug }}
              className="w-full rounded-xl border border-cyan-100/38 bg-cyan-200/18 px-5 py-2.5 text-center text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto"
            >
              Start My Analysis
            </TrackedLink>
            <Link
              href="/resources"
              className="w-full rounded-xl border border-cyan-100/24 px-5 py-2.5 text-center text-sm font-semibold text-cyan-50/84 transition hover:bg-cyan-100/10 sm:w-auto"
            >
              Explore All Guides
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-5xl">
        <div className="neon-panel rounded-2xl p-6 sm:p-8">
          <h2 className="text-2xl font-semibold text-cyan-50">Frequently Asked Questions</h2>
          <div className="mt-5 space-y-4">
            {page.faqs.map((faq) => (
              <article key={faq.question} className="rounded-xl border border-cyan-100/16 bg-cyan-100/7 p-4">
                <h3 className="text-base font-semibold text-cyan-50">{faq.question}</h3>
                <p className="mt-2 text-sm leading-relaxed text-cyan-50/74">{faq.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-5xl">
        <div className="premium-panel rounded-2xl p-6 sm:p-8">
          <h2 className="text-2xl font-semibold text-cyan-50">Related Resume Guides</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {relatedPages.map((item) => (
              <article key={item.slug} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-4">
                <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/62">{item.roleFocus}</p>
                <h3 className="mt-2 text-base font-semibold text-cyan-50">{item.title}</h3>
                <p className="mt-2 text-sm text-cyan-50/72">{item.metaDescription}</p>
                <Link
                  href={`/resources/${item.slug}`}
                  className="mt-3 inline-flex rounded-lg border border-cyan-100/30 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/12"
                >
                  Read Guide
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
