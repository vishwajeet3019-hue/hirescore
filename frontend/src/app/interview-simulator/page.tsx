import type { Metadata } from "next";
import InterviewSimulatorClient from "./simulator-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";

export const metadata: Metadata = {
  title: "Live Interview Simulator | 1 Free Interview Without Login",
  description:
    "Practice live mock interviews with adaptive follow-up questions, real-time scoring, and dashboard report archive. First interview is free without login.",
  alternates: {
    canonical: "/interview-simulator",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/interview-simulator`,
    title: "HireScore Live Interview Simulator",
    description: "Run a free guest interview simulation, then unlock unlimited signed-in runs with dashboard report history.",
  },
  twitter: {
    card: "summary_large_image",
    title: "HireScore Live Interview Simulator",
    description: "1 free interview without login, live scoring, and dashboard report archive after sign-in.",
  },
};

export default function InterviewSimulatorPage() {
  return <InterviewSimulatorClient />;
}
