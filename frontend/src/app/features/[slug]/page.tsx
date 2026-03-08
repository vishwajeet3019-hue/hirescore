import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TrackedLink from "@/app/components/tracked-link";
import GrowthShareSection from "@/app/components/growth-share-section";
import { addUtmParams } from "@/lib/utm";
import {
  featureSeoPages,
  getFeatureSeoPageBySlug,
  getRelatedFeatureSeoPages,
} from "@/lib/feature-seo-pages";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return featureSeoPages.map((item) => ({
    slug: item.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getFeatureSeoPageBySlug(slug);

  if (!page) {
    return {
      title: "Feature Guide Not Found",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: page.title,
    description: page.metaDescription,
    keywords: [page.keyword, ...page.searchPhrases],
    alternates: {
      canonical: `/features/${page.slug}`,
    },
    openGraph: {
      title: `${page.title} | HireScore AI`,
      description: page.metaDescription,
      url: `${SITE_URL}/features/${page.slug}`,
      type: "article",
      images: [
        {
          url: `${SITE_URL}/icon.svg`,
          width: 1200,
          height: 630,
          alt: `${page.title} | HireScore AI`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${page.title} | HireScore AI`,
      description: page.metaDescription,
      images: [`${SITE_URL}/icon.svg`],
    },
  };
}

export default async function FeatureSeoDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const page = getFeatureSeoPageBySlug(slug);
  if (!page) notFound();

  const relatedPages = getRelatedFeatureSeoPages(page.slug, 3);

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

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${SITE_URL}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Feature Guides",
        item: `${SITE_URL}/features`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: page.title,
        item: `${SITE_URL}/features/${page.slug}`,
      },
    ],
  };

  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "HireScore AI",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    featureList: page.coreBenefits,
    description: page.metaDescription,
    url: `${SITE_URL}${page.primaryRoute}`,
  };

  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />

      <section className="mx-auto max-w-5xl">
        <div className="premium-panel rounded-[2rem] p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70 sm:text-xs sm:tracking-[0.24em]">
            Feature-Specific SEO Guide
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">{page.h1}</h1>
          <p className="mt-4 text-sm leading-relaxed text-cyan-50/74 sm:text-base">{page.intro}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.12em] text-cyan-100/62">
            <span className="rounded-lg border border-cyan-100/24 bg-cyan-100/8 px-3 py-1.5">{page.keyword}</span>
            <span className="rounded-lg border border-cyan-100/24 bg-cyan-100/8 px-3 py-1.5">{page.intent}</span>
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <TrackedLink
              href={addUtmParams(page.primaryRoute, {
                source: "feature_seo_detail",
                medium: "organic",
                campaign: page.slug,
                content: "primary_cta",
              })}
              eventName="cta_feature_primary_click"
              eventParams={{ cta_location: "feature_detail_hero", page: page.slug, route: page.primaryRoute }}
              className="w-full rounded-2xl border border-cyan-100/40 bg-cyan-200/18 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto"
            >
              {page.primaryCtaLabel}
            </TrackedLink>
            <TrackedLink
              href={addUtmParams(page.secondaryRoute, {
                source: "feature_seo_detail",
                medium: "organic",
                campaign: page.slug,
                content: "secondary_cta",
              })}
              eventName="cta_feature_secondary_click"
              eventParams={{
                cta_location: "feature_detail_hero",
                page: page.slug,
                route: page.secondaryRoute,
              }}
              className="w-full rounded-2xl border border-cyan-100/24 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto"
            >
              {page.secondaryCtaLabel}
            </TrackedLink>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-2">
        <article className="neon-panel rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-cyan-50">Core Benefits</h2>
          <ul className="mt-4 space-y-3">
            {page.coreBenefits.map((point) => (
              <li key={point} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3 text-sm text-cyan-50/76">
                {point}
              </li>
            ))}
          </ul>
        </article>

        <article className="neon-panel rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-cyan-50">Best Use Cases</h2>
          <ul className="mt-4 space-y-3">
            {page.useCases.map((point) => (
              <li key={point} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-3 text-sm text-cyan-50/76">
                {point}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="mx-auto mt-10 max-w-5xl">
        <div className="premium-panel rounded-2xl p-6 sm:p-8">
          <h2 className="text-2xl font-semibold text-cyan-50">How This Works</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {page.howItWorks.map((step) => (
              <article key={step} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-4">
                <p className="text-sm leading-relaxed text-cyan-50/78">{step}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-5xl">
        <div className="neon-panel rounded-2xl p-6 sm:p-8">
          <h2 className="text-2xl font-semibold text-cyan-50">Search Phrases This Page Targets</h2>
          <div className="mt-5 flex flex-wrap gap-2">
            {page.searchPhrases.map((phrase) => (
              <span
                key={phrase}
                className="rounded-lg border border-cyan-100/22 bg-cyan-100/8 px-2.5 py-1 text-xs text-cyan-50/82"
              >
                {phrase}
              </span>
            ))}
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
          <h2 className="text-2xl font-semibold text-cyan-50">Related Feature Guides</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {relatedPages.map((item) => (
              <article key={item.slug} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-4">
                <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/62">{item.keyword}</p>
                <h3 className="mt-2 text-base font-semibold text-cyan-50">{item.title}</h3>
                <p className="mt-2 text-sm text-cyan-50/72">{item.metaDescription}</p>
                <TrackedLink
                  href={addUtmParams(`/features/${item.slug}`, {
                    source: "feature_seo_detail",
                    medium: "organic",
                    campaign: `${page.slug}-related`,
                    content: item.slug,
                  })}
                  eventName="cta_related_feature_open"
                  eventParams={{ cta_location: "feature_detail_related", page: page.slug, related: item.slug }}
                  className="mt-3 inline-flex rounded-lg border border-cyan-100/30 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/12"
                >
                  Read Guide
                </TrackedLink>
              </article>
            ))}
          </div>
        </div>
      </section>

      <GrowthShareSection location="feature_seo_detail" title={`${page.h1} | HireScore AI`} />
    </main>
  );
}
