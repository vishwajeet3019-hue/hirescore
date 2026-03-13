import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import AppChrome from "./components/app-chrome";
import AnalyticsBootstrap from "./components/analytics-bootstrap";
import AnalyticsPageviewTracker from "./components/analytics-pageview";
import MotionProvider from "./components/motion-provider";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "HireScore AI | Resume Analyzer and ATS Resume Builder",
    template: "%s | HireScore AI",
  },
  description:
    "Improve your resume with AI role-fit analysis, shortlist prediction, and ATS-friendly templates. Build stronger job applications with HireScore AI.",
  keywords: [
    "AI resume analyzer",
    "ATS resume builder",
    "resume score checker",
    "resume optimization",
    "shortlist prediction",
    "job application tools",
    "resume format for fresher job",
    "resume score check free",
    "ats resume checker free",
    "resume checker free online",
    "why resume not getting shortlisted",
    "how to increase interview calls",
    "job switch resume 2 years experience",
    "resume ka score kaise check kare",
  ],
  alternates: {
    canonical: "/",
    languages: {
      "en-IN": "/",
      en: "/",
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    locale: "en_IN",
    title: "HireScore AI | Resume Analyzer and ATS Resume Builder",
    description:
      "Analyze role-fit, find improvement gaps, and build recruiter-ready resumes with HireScore AI.",
    siteName: "HireScore AI",
    images: [
      {
        url: "/icon.svg",
        width: 512,
        height: 512,
        alt: "HireScore AI",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "HireScore AI | Resume Analyzer and ATS Resume Builder",
    description:
      "Analyze role-fit, improve your resume, and boost shortlist chances with AI-powered insights.",
    images: ["/icon.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-IN">
      <body
        className={`${manrope.variable} [font-family:var(--font-manrope)] antialiased overflow-x-hidden bg-[#f7f9fc] text-slate-900`}
      >
        <AnalyticsBootstrap />
        <AnalyticsPageviewTracker />
        <div className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
          <div className="futuristic-grid" />
        </div>
        <MotionProvider>
          <AppChrome>{children}</AppChrome>
        </MotionProvider>
      </body>
    </html>
  );
}
