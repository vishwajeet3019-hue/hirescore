import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resume Studio",
  description:
    "Build, polish, and export ATS-friendly resumes with AI assistance and premium templates in HireScore Resume Studio.",
  alternates: {
    canonical: "/studio",
  },
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
