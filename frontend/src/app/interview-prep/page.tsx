import type { Metadata } from "next";
import InterviewCopilotClient from "../interview-copilot/interview-copilot-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Interview Prep | AI Mock Questions + Answer Drills",
  description:
    "Generate role-specific interview questions, coaching notes, STAR drills, and recruiter-ready outreach assets in one interview prep workspace.",
  alternates: {
    canonical: "/interview-prep",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/interview-prep`,
    title: "HireScore Interview Prep",
    description: "AI interview prep and job-application messaging pack built from your role, JD, and resume context.",
  },
  twitter: {
    card: "summary_large_image",
    title: "HireScore Interview Prep",
    description: "Create mock interview packs and recruiter-ready outreach drafts with AI.",
  },
};

export default function InterviewPrepPage() {
  return <InterviewCopilotClient />;
}
