import type { Metadata } from "next";

export const SITE_NAME = "HireScore";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hirescore.in").replace(/\/+$/, "");
export const SITE_DESCRIPTION =
  "Check if your resume will get shortlisted by matching it against a job description and getting focused suggestions.";
export const CONTACT_EMAIL = "contact@hirescore.in";
export const LOGO_PATH = "/hirescore-logo.png";
export const LOGO_URL = `${SITE_URL}${LOGO_PATH}`;
export const OG_IMAGE_PATH = "/opengraph-image";
export const OG_IMAGE_URL = `${SITE_URL}${OG_IMAGE_PATH}`;
export const COMPANY_KEYWORDS = [
  "hirescore",
  "hire score",
  "resume jd matcher",
  "resume match score",
  "resume shortlist checker",
  "resume suggestions",
  "missing skills checker",
  "resume job description match",
];

const lastModifiedInput =
  process.env.VERCEL_GIT_COMMIT_DATE?.trim() ||
  process.env.NEXT_PUBLIC_SITE_LAST_MODIFIED?.trim() ||
  "2026-03-19T00:00:00.000Z";
const safeLastModifiedInput = Number.isNaN(Date.parse(lastModifiedInput))
  ? "2026-03-19T00:00:00.000Z"
  : lastModifiedInput;

export const SITE_LAST_MODIFIED_ISO = new Date(safeLastModifiedInput).toISOString();

export const DEFAULT_OG_IMAGE = {
  url: OG_IMAGE_URL,
  width: 1200,
  height: 630,
  alt: "HireScore resume and JD matcher",
} as const;

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  keywords?: string[];
  type?: "website" | "article";
  imageAlt?: string;
};

export const buildPageMetadata = ({
  title,
  description,
  path,
  keywords,
  type = "website",
  imageAlt,
}: PageMetadataOptions): Metadata => ({
  title,
  description,
  ...(keywords ? { keywords } : {}),
  alternates: {
    canonical: path,
  },
  openGraph: {
    type,
    url: `${SITE_URL}${path}`,
    title,
    description,
    siteName: SITE_NAME,
    images: [
      {
        ...DEFAULT_OG_IMAGE,
        alt: imageAlt || title,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [DEFAULT_OG_IMAGE.url],
  },
});
