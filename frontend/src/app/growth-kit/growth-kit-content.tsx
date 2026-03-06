"use client";

import { useState } from "react";
import TrackedLink from "../components/tracked-link";
import { addUtmParams } from "@/lib/utm";
import { trackEvent } from "@/lib/analytics";
import { seoLandingPages } from "@/lib/seo-landing-pages";

type GrowthPost = {
  date: string;
  dateIso: string;
  title: string;
  pain: string;
  keyword: string;
  linkedinPost: string;
  whatsappPost: string;
  telegramPost: string;
  hashtags: string;
};

const getDayBucket = () => {
  const now = new Date();
  const zoneStart = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return Math.floor(zoneStart.getTime() / (24 * 60 * 60 * 1000));
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
};

const toHashtag = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => (index === 0 ? `${word[0]?.toUpperCase()}${word.slice(1)}` : word))
    .join("");

const generateGrowthPosts = (): GrowthPost[] => {
  const baseIndex = getDayBucket();
  const orderedPages = [...seoLandingPages];

  return Array.from({ length: 7 }, (_, dayOffset) => {
    const page = orderedPages[(baseIndex + dayOffset) % orderedPages.length];
    const dayDate = new Date();
    dayDate.setDate(dayDate.getDate() + dayOffset);
    const hookSet = [
      "India job market ke current filter mein ek cheez clear hoti ja rahi hai:",
      "Aaj ka resume tracker reminder:",
      "Real issue ye nahi hai ki you don't apply, issue ye hai that resume filter se clear nahi hota:",
    ];
    const proofSet = [
      "minimum edits + targeted keyword",
      "ATS mismatch + unclear outcomes",
      "too generic summary + weak metrics",
    ];

    const hook = hookSet[dayOffset % hookSet.length];
    const proof = proofSet[dayOffset % proofSet.length];
    const keyword = page.keyword;
    const pain = page.painPoints[dayOffset % page.painPoints.length];
    const role = page.roleFocus;

    const commonTagline = `If your target is ${role}, this is where most people lose momentum.`;
    const hashtagList = [
      "#jobsearchIndia",
      "#resumeTips",
      `#${toHashtag(role)}Jobs`,
      `#${toHashtag(keyword)}Check`,
      "#HireScore",
    ];

    const linkedinPost = `${hook}\n\n${commonTagline}\n\n${page.h1}\nProblem: ${proof}\nAction: ${pain}\n\nIf you are in role conversion mode, use this 2-minute check:\n1) Run role-fit score\n2) Rewrite top 3 bullets with impact\n3) Re-run and track improvement\n\nShare this with a friend who is also applying right now.`;

    const whatsappPost = `${role} friends, quick fix today: ${page.intro}\n\nIf you are getting no calls, try:\n• ${pain}\n• Add measurable numbers in top 3 bullets\n• Add 1 line of outcome for each point\n\nCheck your shortlist readiness: ${addUtmParams("/upload", {
      source: "growth_kit",
      medium: "social_share",
      campaign: `day_${dayOffset + 1}`,
      content: page.slug,
    })}`;

    const telegramPost = `Share this with someone applying:\n"${keyword}" strategy for this week:\n- Fix headline + summary mismatch.\n- Add role-specific measurable outcomes.\n- Run fresh review before sending next batch.\n\n${hashtagList.join(" ")}`;

    return {
      date: formatDate(dayDate),
      dateIso: dayDate.toISOString().slice(0, 10),
      title: `Day ${dayOffset + 1} Growth Post`,
      pain,
      keyword,
      hashtags: hashtagList.join(" "),
      linkedinPost,
      whatsappPost,
      telegramPost,
    };
  });
};

export default function GrowthKitContent() {
  const growthPosts = generateGrowthPosts();
  const ctaUploadHref = addUtmParams("/upload", {
    source: "growth_kit",
    medium: "internal",
    campaign: "growth_kit",
    content: "hero",
  });
  const ctaResourceHref = addUtmParams("/resources", {
    source: "growth_kit",
    medium: "internal",
    campaign: "growth_kit",
    content: "resources",
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const onCopy = async (key: string, text: string) => {
    if (!navigator?.clipboard) return;
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1400);
    trackEvent("growth_kit_copy", {
      copy_source: key,
      campaign: "growth_kit",
      platform: key.includes("linkedin") ? "linkedin" : key.includes("telegram") ? "telegram" : "whatsapp",
    });
  };

  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <section className="mx-auto max-w-6xl">
        <div className="premium-panel rounded-[2rem] p-6 sm:p-8">
          <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/72 sm:text-xs sm:tracking-[0.24em]">
            Daily Traffic Growth Kit
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">Growth Kit: India-First Copy</h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-cyan-50/74 sm:text-base">
            7-day campaign prompts for zero-ad traffic growth. Share these as WhatsApp/Telegram/LinkedIn messages from your
            existing network.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <TrackedLink
              href={ctaUploadHref}
              eventName="cta_check_my_score_click"
              eventParams={{ cta_location: "growth_kit", cta_label: "Run Score Check" }}
              className="w-full rounded-2xl border border-cyan-100/40 bg-cyan-200/18 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto sm:px-7 sm:py-3.5"
            >
              Run Score Check
            </TrackedLink>
            <TrackedLink
              href={ctaResourceHref}
              eventName="cta_resources_open"
              eventParams={{ cta_location: "growth_kit", cta_label: "Open SEO Guides" }}
              className="w-full rounded-2xl border border-cyan-100/25 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto sm:px-7 sm:py-3.5"
            >
              Open SEO Guides
            </TrackedLink>
            <TrackedLink
              href="/"
              eventName="cta_navigation"
              eventParams={{ cta_location: "growth_kit", cta_label: "Back Home" }}
              className="w-full rounded-2xl border border-cyan-100/26 bg-cyan-100/10 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/80 transition hover:bg-cyan-100/20 sm:w-auto sm:px-7 sm:py-3.5"
            >
              Back to Home
            </TrackedLink>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-8 grid max-w-6xl gap-4 md:grid-cols-2">
        {growthPosts.map((post) => {
          const copyPrefix = `day-${post.dateIso}`;
          return (
            <article
              key={post.dateIso}
              className="rounded-2xl border border-cyan-100/20 bg-cyan-100/6 p-5 sm:p-6"
            >
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/62">{post.date}</p>
              <h2 className="mt-2 text-xl font-semibold text-cyan-50">{post.title}</h2>
              <p className="mt-1 text-xs text-cyan-100/72">Search intent: {post.keyword}</p>
              <p className="mt-3 rounded-lg border border-cyan-100/24 bg-cyan-100/10 p-3 text-sm text-cyan-50/82">{post.pain}</p>
              <p className="mt-3 text-xs uppercase tracking-[0.12em] text-cyan-100/62">{post.hashtags}</p>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-cyan-50">LinkedIn Post</p>
                  <p className="mt-2 text-sm text-cyan-50/78">{post.linkedinPost}</p>
                  <button
                    type="button"
                    onClick={() => onCopy(`${copyPrefix}-linkedin`, post.linkedinPost)}
                    className="mt-2 rounded-xl border border-cyan-100/34 bg-cyan-100/12 px-4 py-2 text-xs font-semibold text-cyan-50"
                  >
                    {copiedKey === `${copyPrefix}-linkedin` ? "Copied!" : "Copy LinkedIn Text"}
                  </button>
                </div>

                <div>
                  <p className="text-sm font-semibold text-cyan-50">WhatsApp Text</p>
                  <p className="mt-2 text-sm text-cyan-50/78">{post.whatsappPost}</p>
                  <button
                    type="button"
                    onClick={() => onCopy(`${copyPrefix}-whatsapp`, post.whatsappPost)}
                    className="mt-2 rounded-xl border border-cyan-100/34 bg-cyan-100/12 px-4 py-2 text-xs font-semibold text-cyan-50"
                  >
                    {copiedKey === `${copyPrefix}-whatsapp` ? "Copied!" : "Copy WhatsApp Text"}
                  </button>
                </div>

                <div>
                  <p className="text-sm font-semibold text-cyan-50">Telegram Text</p>
                  <p className="mt-2 text-sm text-cyan-50/78">{post.telegramPost}</p>
                  <button
                    type="button"
                    onClick={() => onCopy(`${copyPrefix}-telegram`, post.telegramPost)}
                    className="mt-2 rounded-xl border border-cyan-100/34 bg-cyan-100/12 px-4 py-2 text-xs font-semibold text-cyan-50"
                  >
                    {copiedKey === `${copyPrefix}-telegram` ? "Copied!" : "Copy Telegram Text"}
                  </button>
                </div>
              </div>

              <TrackedLink
                href={`/growth-kit?day=${post.dateIso}`}
                eventName="growth_kit_open_day"
                eventParams={{ cta_location: "growth_kit", cta_label: post.dateIso }}
                className="mt-4 inline-flex rounded-lg border border-cyan-100/24 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-100/12"
              >
                Copy this day
              </TrackedLink>
            </article>
          );
        })}
      </section>
    </main>
  );
}
