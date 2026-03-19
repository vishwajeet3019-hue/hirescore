import type { Metadata } from "next";
import { COMPANY_KEYWORDS, DEFAULT_OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";
import AppChrome from "./components/app-chrome";
import AnalyticsBootstrap from "./components/analytics-bootstrap";
import AnalyticsPageviewTracker from "./components/analytics-pageview";
import MotionProvider from "./components/motion-provider";
import PublicAccessBootstrap from "./components/public-access-bootstrap";
import "./globals.css";

const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION?.trim();
const BING_SITE_VERIFICATION = process.env.BING_SITE_VERIFICATION?.trim();
const YANDEX_SITE_VERIFICATION = process.env.YANDEX_SITE_VERIFICATION?.trim();

const siteVerification =
  GOOGLE_SITE_VERIFICATION || BING_SITE_VERIFICATION || YANDEX_SITE_VERIFICATION
    ? {
        ...(GOOGLE_SITE_VERIFICATION ? { google: GOOGLE_SITE_VERIFICATION } : {}),
        ...(YANDEX_SITE_VERIFICATION ? { yandex: YANDEX_SITE_VERIFICATION } : {}),
        ...(BING_SITE_VERIFICATION
          ? {
              other: {
                "msvalidate.01": BING_SITE_VERIFICATION,
              },
            }
          : {}),
      }
    : undefined;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "career tools",
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  manifest: "/manifest.webmanifest",
  title: {
    default: `${SITE_NAME} | Resume JD Matcher`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: COMPANY_KEYWORDS,
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
    title: `${SITE_NAME} | Resume JD Matcher`,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | Resume JD Matcher`,
    description: SITE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE.url],
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
  ...(siteVerification ? { verification: siteVerification } : {}),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-IN">
      <body className="antialiased">
        <AnalyticsBootstrap />
        <AnalyticsPageviewTracker />
        <PublicAccessBootstrap />
        <MotionProvider>
          <AppChrome>{children}</AppChrome>
        </MotionProvider>
      </body>
    </html>
  );
}
