import type { Metadata } from "next";
import Script from "next/script";
import AppChrome from "./components/app-chrome";
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
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
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
    <html lang="en">
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
                gtag('config', '${GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        ) : null}
        <div className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
          <div className="futuristic-grid" />
          <div className="absolute -left-20 top-12 h-64 w-64 rounded-full bg-cyan-400/14 blur-[72px]" />
          <div className="absolute -right-16 top-52 h-72 w-72 rounded-full bg-sky-400/14 blur-[78px]" />
          <div className="absolute bottom-[-140px] left-1/3 h-[260px] w-[260px] rounded-full bg-amber-200/12 blur-[76px]" />
        </div>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
