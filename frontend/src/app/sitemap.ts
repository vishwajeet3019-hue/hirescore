import type { MetadataRoute } from "next";
import { SITE_LAST_MODIFIED_ISO, SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(SITE_LAST_MODIFIED_ISO);

  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/application-copilot`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.95,
    },
    {
      url: `${SITE_URL}/privacy-policy`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms-of-service`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];
}
