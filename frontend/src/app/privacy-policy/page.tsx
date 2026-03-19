import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How HireScore collects, uses, and protects resume and job description data.",
  alternates: {
    canonical: "/privacy-policy",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-20 pt-10 sm:px-6 sm:pt-12">
      <h1 className="text-3xl font-semibold text-[#203528] sm:text-4xl">Privacy Policy</h1>
      <p className="mt-3 text-sm text-[#677463]">Last updated: March 19, 2026</p>

      <section className="surface-panel mt-8 space-y-4 rounded-[1.8rem] p-5 text-sm leading-relaxed text-[#203528] sm:p-6">
        <p>
          HireScore is focused on resume-to-job-description matching. We collect only the data needed to process your resume,
          the target job description, and the resulting suggestions.
        </p>
        <p>
          Data we may process includes resume content, job description content, page interactions, and basic technical logs used
          for reliability and abuse prevention.
        </p>
        <p>
          We use this data to generate your results, improve product quality, and keep the service stable. We do not sell your personal data.
        </p>
        <p>
          If you would like your data deleted or exported, contact{" "}
          <a href="mailto:contact@hirescore.in" className="font-semibold text-[#355e46] hover:text-[#2d503c]">
            contact@hirescore.in
          </a>.
        </p>
      </section>
    </main>
  );
}
