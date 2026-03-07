import type { Metadata } from "next";
import ApplicationCopilotClient from "./application-copilot-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Application Copilot | JD Match + Resume + Interview Prep",
  description:
    "Run one end-to-end AI workflow from JD and resume to match score, missing skills, resume improvements, and interview-ready next steps.",
  alternates: {
    canonical: "/application-copilot",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/application-copilot`,
    title: "HireScore Application Copilot",
    description: "One workflow to move from JD to interview-ready execution with AI guidance.",
  },
  twitter: {
    card: "summary_large_image",
    title: "HireScore Application Copilot",
    description: "JD match, resume fixes, interview prep, and a 7-day action plan in one console.",
  },
};

export default function ApplicationCopilotPage() {
  return <ApplicationCopilotClient />;
}

