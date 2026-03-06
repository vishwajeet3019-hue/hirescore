import type { Metadata } from "next";
import GrowthKitClient from "./growth-kit-content";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Growth Kit for HireScore Users",
  description:
    "Daily growth prompts and posting copy for Indian jobseekers who want more recruiter attention and more visits from referrals.",
  alternates: {
    canonical: "/growth-kit",
  },
  openGraph: {
    title: "HireScore Growth Kit",
    description:
      "Use daily copy prompts, referral scripts, and roadmap posts to increase resume app traffic without ad spend.",
    type: "website",
    url: `${SITE_URL}/growth-kit`,
  },
  twitter: {
    title: "HireScore Growth Kit",
    description:
      "Use daily copy prompts, referral scripts, and roadmap posts to increase resume app traffic without ad spend.",
  },
};

export default function GrowthKitPage() {
  return <GrowthKitClient />;
}
