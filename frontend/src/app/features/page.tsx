import type { Metadata } from "next";
import TrackedLink from "../components/tracked-link";
import GrowthShareSection from "../components/growth-share-section";
import { addUtmParams } from "@/lib/utm";
import { featureSeoPages } from "@/lib/feature-seo-pages";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Feature Guides: JD Matcher, Interview Simulator, Resume Studio",
  description:
    "Explore feature-focused guides for JD matching, resume building, analysis, and interview simulation. Each page maps directly to a live HireScore tool.",
  keywords: [
    "jd matcher tool",
    "resume vs jd match score checker",
    "ai interview simulator",
    "ai resume studio",
    "application copilot",
    "instant fit check",
    "resume analysis and shortlist prediction",
    "interview prep plan from resume and jd",
  ],
  alternates: {
    canonical: "/features",
  },
};

export default function FeaturesSeoHubPage() {
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "HireScore Feature Guides",
    itemListElement: featureSeoPages.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${SITE_URL}/features/${item.slug}`,
      name: item.title,
    })),
  };

  const openToolsHubHref = addUtmParams("/tools", {
    source: "feature_seo_hub",
    medium: "organic",
    campaign: "feature_hub_tools",
  });

  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />

      <section className="mx-auto max-w-7xl">
        <div className="premium-panel rounded-[2rem] p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/70 sm:text-xs sm:tracking-[0.24em]">
            Feature Guides
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">
            Guides For HireScore Features
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-cyan-50/74 sm:text-base">
            These pages target high-intent queries around JD matching, resume analysis, interview simulation, and
            conversion-focused application workflows. Each guide is mapped to a live product route.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <TrackedLink
              href={openToolsHubHref}
              eventName="cta_tools_hub_open"
              eventParams={{ cta_location: "feature_hub_hero", cta_label: "Open Tools Hub" }}
              className="w-full rounded-2xl border border-cyan-100/40 bg-cyan-200/18 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto"
            >
              Open Tools Hub
            </TrackedLink>
            <TrackedLink
              href={addUtmParams("/pricing", {
                source: "feature_seo_hub",
                medium: "organic",
                campaign: "feature_hub_pricing",
              })}
              eventName="cta_view_pricing_click"
              eventParams={{ cta_location: "feature_hub_hero", cta_label: "View Pricing" }}
              className="w-full rounded-2xl border border-cyan-100/24 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto"
            >
              View Pricing
            </TrackedLink>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-7xl">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featureSeoPages.map((item) => (
            <article key={item.slug} className="holo-sheen rounded-2xl border border-cyan-100/18 bg-cyan-100/6 p-5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/62 sm:text-xs sm:tracking-[0.2em]">
                {item.keyword}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-cyan-50">{item.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-cyan-50/74">{item.metaDescription}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <TrackedLink
                  href={addUtmParams(`/features/${item.slug}`, {
                    source: "feature_seo_hub",
                    medium: "organic",
                    campaign: "feature_guide_open",
                    content: item.slug,
                  })}
                  eventName="cta_feature_guide_open"
                  eventParams={{ cta_location: "feature_hub_card", page: item.slug }}
                  className="rounded-xl border border-cyan-100/34 bg-cyan-200/14 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/22"
                >
                  Open Guide
                </TrackedLink>
                <TrackedLink
                  href={addUtmParams(item.primaryRoute, {
                    source: "feature_seo_hub",
                    medium: "organic",
                    campaign: "feature_primary_tool",
                    content: item.slug,
                  })}
                  eventName="cta_feature_primary_tool_open"
                  eventParams={{ cta_location: "feature_hub_card", tool_path: item.primaryRoute }}
                  className="rounded-xl border border-cyan-100/22 px-3 py-2 text-xs font-semibold text-cyan-50/88 transition hover:bg-cyan-100/12"
                >
                  {item.primaryCtaLabel}
                </TrackedLink>
              </div>
            </article>
          ))}
        </div>
      </section>

      <GrowthShareSection location="feature_seo_hub" title="HireScore Feature Guides" />
    </main>
  );
}
