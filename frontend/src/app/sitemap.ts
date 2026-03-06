import type { MetadataRoute } from "next";
import { seoLandingPages } from "@/lib/seo-landing-pages";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in").replace(/\/+$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const baseRoutes: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/upload`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/studio`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/case-studies`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.82,
    },
  ];

  const resourceRoutes: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/resources`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.85,
    },
    ...seoLandingPages.map((item) => ({
      url: `${SITE_URL}/resources/${item.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.75,
    })),
  ];

  return [...baseRoutes, ...resourceRoutes];
}
