import type { Metadata } from "next";
import InterviewSimulatorClient from "./simulator-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Live Interview Simulator | AI Audio + Video Mock Interview",
  description:
    "Practice live mock interviews with adaptive AI follow-up questions, real-time scoring, and actionable next-step coaching.",
  alternates: {
    canonical: "/interview-simulator",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/interview-simulator`,
    title: "HireScore Live Interview Simulator",
    description: "Run adaptive AI mock interviews with live scoring and personalized coaching feedback.",
  },
  twitter: {
    card: "summary_large_image",
    title: "HireScore Live Interview Simulator",
    description: "Audio + video style interview simulation with AI follow-up questions and score reports.",
  },
};

export default function InterviewSimulatorPage() {
  return <InterviewSimulatorClient />;
}
