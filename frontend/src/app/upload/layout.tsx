import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resume Analysis",
  description:
    "Upload resume details and get AI-based role-fit score, shortlist prediction, salary insights, and improvement actions.",
  alternates: {
    canonical: "/upload",
  },
};

export default function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
