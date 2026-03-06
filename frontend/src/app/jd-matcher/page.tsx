import type { Metadata } from "next";
import JdMatcherClient from "./jd-matcher-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "JD Matcher | Job Description Match Scanner",
  description:
    "Match your resume against any job description, identify missing keywords, and get action-ready rewrite suggestions.",
  alternates: {
    canonical: "/jd-matcher",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/jd-matcher`,
    title: "HireScore JD Matcher",
    description: "Scan JD fit, uncover keyword gaps, and improve interview shortlist probability.",
  },
  twitter: {
    card: "summary_large_image",
    title: "HireScore JD Matcher",
    description: "Dedicated JD matching workspace with gap insights and targeted improvement actions.",
  },
};

export default function JdMatcherPage() {
  return <JdMatcherClient />;
}
