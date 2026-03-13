import type { Metadata } from "next";
import Script from "next/script";
import AppChrome from "./components/app-chrome";
import AnalyticsPageviewTracker from "./components/analytics-pageview";
import MotionProvider from "./components/motion-provider";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in";
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || "";

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
      { url: "/favicon-48x48.png?v=20260312b", sizes: "48x48", type: "image/png" },
      { url: "/favicon-96x96.png?v=20260312b", sizes: "96x96", type: "image/png" },
      { url: "/favicon.ico?v=20260312b", sizes: "any" },
      { url: "/icon.svg?v=20260312b", type: "image/svg+xml" },
    ],
    shortcut: [{ url: "/favicon.ico?v=20260312b" }],
    apple: [{ url: "/apple-icon.png?v=20260312b", sizes: "180x180", type: "image/png" }],
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
      <body className="antialiased overflow-x-hidden">
        {GA_MEASUREMENT_ID ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });
              `}
            </Script>
            <AnalyticsPageviewTracker />
          </>
        ) : null}
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
