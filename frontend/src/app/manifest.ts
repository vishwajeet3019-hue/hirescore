import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: SITE_URL,
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3ecdf",
    theme_color: "#f3ecdf",
    categories: ["business", "productivity", "education"],
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: "/favicon-48x48.png",
        sizes: "48x48",
        type: "image/png",
      },
      {
        src: "/favicon-96x96.png",
        sizes: "96x96",
        type: "image/png",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
