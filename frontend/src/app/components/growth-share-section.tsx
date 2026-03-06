"use client";

import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics";

type GrowthShareSectionProps = {
  title: string;
  location: string;
  summary?: string;
};

const defaultSummary = (title: string) =>
  `I used ${title} on HireScore AI to check shortlist probability and improve resume readiness before applying.`;

export default function GrowthShareSection({
  title,
  location,
  summary = defaultSummary(title),
}: GrowthShareSectionProps) {
  const pathname = usePathname() || "/";
  const pageUrl = typeof window === "undefined" ? `https://hirescore.in${pathname}` : window.location.href;
  const shareText = `${summary} ${pageUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(summary)}`;
  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}&title=${encodeURIComponent(title)}`;

  const [copied, setCopied] = useState(false);

  const trackShare = useCallback(
    (channel: string) => {
      trackEvent("social_share_click", {
        share_channel: channel,
        page: pathname,
        share_location: location,
      });
    },
    [location, pathname],
  );

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(pageUrl);
    trackShare("copy_link");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [pageUrl, trackShare]);

  return (
    <section className="mx-auto mt-10 max-w-5xl">
      <div className="premium-panel rounded-2xl p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/62">Share With Friends</p>
        <h2 className="mt-2 text-2xl font-semibold text-cyan-50">Share This Guide With A Friend</h2>
        <p className="mt-2 text-sm text-cyan-50/72">
          Indian jobseekers trust recommendations from real people. Share this page with someone who is also applying now.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackShare("whatsapp")}
            className="w-full rounded-xl border border-cyan-100/38 bg-cyan-200/18 px-4 py-2.5 text-center text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto"
          >
            Share on WhatsApp
          </a>
          <a
            href={telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackShare("telegram")}
            className="w-full rounded-xl border border-cyan-100/30 bg-cyan-100/14 px-4 py-2.5 text-center text-sm font-semibold text-cyan-50 transition hover:bg-cyan-100/22 sm:w-auto"
          >
            Share on Telegram
          </a>
          <a
            href={linkedInUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackShare("linkedin")}
            className="w-full rounded-xl border border-cyan-100/30 bg-cyan-100/10 px-4 py-2.5 text-center text-sm font-semibold text-cyan-50 transition hover:bg-cyan-100/18 sm:w-auto"
          >
            Share on LinkedIn
          </a>
          <button
            type="button"
            onClick={copyLink}
            className="w-full rounded-xl border border-cyan-100/34 bg-cyan-200/12 px-4 py-2.5 text-center text-sm font-semibold text-cyan-50/90 transition hover:bg-cyan-100/16 sm:w-auto"
          >
            {copied ? "Copied!" : "Copy Page Link"}
          </button>
        </div>
      </div>
    </section>
  );
}
