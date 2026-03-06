import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing and Credits",
  description:
    "Compare HireScore AI credit packages and feature usage costs for resume analysis, JD matching, AI generation, and template downloads.",
  alternates: {
    canonical: "/pricing",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
