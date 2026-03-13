import type { Metadata } from "next";
import InstantFitClient from "./instant-fit-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Instant AI JD Fit Check | No Login",
  description:
    "Run a free no-login JD fit check. Upload or paste your resume and job description to get match percentage, missing skills, and improvement steps.",
  alternates: {
    canonical: "/instant-fit",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/instant-fit`,
    title: "Instant AI JD Fit Check",
    description: "No-login JD match with AI feedback, missing skills, and next actions.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Instant AI JD Fit Check",
    description: "Check JD-resume fit instantly and improve your shortlist readiness in minutes.",
  },
};

export default function InstantFitPage() {
  return <InstantFitClient />;
}
