import type { Metadata } from "next";
import TrackedLink from "../components/tracked-link";
import GrowthShareSection from "../components/growth-share-section";
import { addUtmParams } from "@/lib/utm";
import {
  getPopularIndianJobSeekerKeywords,
  indianJobSeekerKeywordClusters,
  seoLandingPages,
} from "@/lib/seo-landing-pages";
import { featureSeoPages } from "@/lib/feature-seo-pages";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Resume Guides and Role-Specific Checklists",
  description:
    "Explore role-specific resume guides and ATS optimization checklists for software, product, marketing, sales, and fresher job applications.",
  keywords: [
    "resume format for fresher job",
    "resume score check free",
    "ats resume checker free",
    "how to increase interview calls",
    "job switch resume 2 years experience",
    "resume ka score kaise check kare",
    ...getPopularIndianJobSeekerKeywords(20),
  ],
  alternates: {
    canonical: "/resources",
  },
};

export default function ResourcesPage() {
  const resourcesUploadHref = addUtmParams("/upload", {
    source: "resources_hub",
    medium: "organic",
    campaign: "resource_hub",
  });
  const resourcesPricingHref = addUtmParams("/pricing", {
    source: "resources_hub",
    medium: "organic",
    campaign: "resource_hub",
  });
  const resourcesFeatureHref = addUtmParams("/features", {
    source: "resources_hub",
    medium: "organic",
    campaign: "feature_seo_hub",
  });
  const getResourceGuideHref = (slug: string) =>
    addUtmParams(`/resources/${slug}`, {
      source: "resources_hub",
      medium: "organic",
      campaign: "resource_card",
      content: slug,
    });

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "HireScore AI Resume Resources",
    itemListElement: seoLandingPages.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${SITE_URL}/resources/${item.slug}`,
      name: item.title,
    })),
  };

  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />

      <section className="mx-auto max-w-7xl">
        <div className="premium-panel rounded-[2rem] p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70 sm:text-xs sm:tracking-[0.24em]">
            Resource Hub
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">
            {seoLandingPages.length} Role-Specific Resume Optimization Guides
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-cyan-50/74 sm:text-base">
            Use these pages to improve ATS fit, resume quality, and shortlist probability. Each guide includes a focused
            action plan plus direct links to run analysis and optimize your profile.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <TrackedLink
              href={resourcesUploadHref}
              eventName="cta_check_my_score_click"
              eventParams={{ cta_location: "resources_hub", cta_label: "Check My Score (Free)" }}
              className="w-full rounded-2xl border border-cyan-100/40 bg-cyan-200/18 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto"
            >
              Check My Score (Free)
            </TrackedLink>
            <TrackedLink
              href={resourcesPricingHref}
              eventName="cta_view_premium_plans_click"
              eventParams={{ cta_location: "resources_hub", cta_label: "View Premium Plans" }}
              className="w-full rounded-2xl border border-cyan-100/25 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto"
            >
              View Premium Plans
            </TrackedLink>
            <TrackedLink
              href={resourcesFeatureHref}
              eventName="cta_feature_guides_open"
              eventParams={{ cta_location: "resources_hub", cta_label: "Feature SEO Guides" }}
              className="w-full rounded-2xl border border-cyan-100/25 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto"
            >
              Feature SEO Guides ({featureSeoPages.length})
            </TrackedLink>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-7xl">
        <div className="premium-panel rounded-2xl p-5 sm:p-7">
          <h2 className="text-2xl font-semibold text-cyan-50">How Indian Jobseekers Actually Search</h2>
          <p className="mt-2 text-sm text-cyan-50/72">
            We build pages around real-world query language, not only textbook SEO keywords.
          </p>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {indianJobSeekerKeywordClusters.map((cluster) => (
              <article key={cluster.label} className="rounded-xl border border-cyan-100/18 bg-cyan-100/7 p-4">
                <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/62">{cluster.label}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {cluster.phrases.map((phrase) => (
                    <span
                      key={phrase}
                      className="rounded-lg border border-cyan-100/22 bg-cyan-100/8 px-2.5 py-1 text-xs text-cyan-50/82"
                    >
                      {phrase}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-7xl">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {seoLandingPages.map((item) => (
            <article
              key={item.slug}
              className="holo-sheen rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-5"
            >
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/62 sm:text-xs sm:tracking-[0.2em]">
                {item.roleFocus}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-cyan-50">{item.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-cyan-50/74">{item.metaDescription}</p>
              <p className="mt-3 text-xs uppercase tracking-[0.12em] text-cyan-100/62">Keyword: {item.keyword}</p>
              <TrackedLink
                href={getResourceGuideHref(item.slug)}
                eventName="cta_resource_guide_open"
                eventParams={{ cta_location: "resources_grid", cta_label: "Open Guide", resource_slug: item.slug }}
                className="mt-4 inline-flex rounded-xl border border-cyan-100/34 bg-cyan-200/14 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/22"
              >
                Open Guide
              </TrackedLink>
            </article>
          ))}
        </div>
      </section>

      <GrowthShareSection
        location="resources"
        title="HireScore AI Resume Guides"
      />
    </main>
  );
}
