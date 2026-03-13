import type { Metadata } from "next";
import InstantFitShareClient from "./share-view-client";

type PageProps = {
  params: Promise<{
    shareId: string;
  }>;
};

export const metadata: Metadata = {
  title: "Shared JD Fit Score Card",
  description: "View a shared HireScore Instant JD Fit result card and run your own check.",
  robots: {
    index: false,
    follow: true,
  },
};

export default async function InstantFitSharePage({ params }: PageProps) {
  const { shareId } = await params;
  return <InstantFitShareClient shareId={shareId} />;
}
