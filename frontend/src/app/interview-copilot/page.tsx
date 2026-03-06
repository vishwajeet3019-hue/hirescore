import type { Metadata } from "next";
import InterviewCopilotClient from "./interview-copilot-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Interview Copilot | AI Interview Prep + Job Apply Kit",
  description:
    "Generate role-specific interview questions, coaching notes, STAR drills, and outreach-ready application assets in one dedicated workspace.",
  alternates: {
    canonical: "/interview-copilot",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/interview-copilot`,
    title: "HireScore Interview Copilot",
    description: "AI interview prep and job-application messaging pack built from your role, JD, and resume context.",
  },
  twitter: {
    card: "summary_large_image",
    title: "HireScore Interview Copilot",
    description: "Create mock interview packs and recruiter-ready outreach drafts with AI.",
  },
};

export default function InterviewCopilotPage() {
  return <InterviewCopilotClient />;
}
