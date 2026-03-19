import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms for using HireScore resume and job description matching.",
  alternates: {
    canonical: "/terms-of-service",
  },
};

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-20 pt-10 sm:px-6 sm:pt-12">
      <h1 className="text-3xl font-semibold text-[#203528] sm:text-4xl">Terms of Service</h1>
      <p className="mt-3 text-sm text-[#677463]">Last updated: March 19, 2026</p>

      <section className="surface-panel mt-8 space-y-4 rounded-[1.8rem] p-5 text-sm leading-relaxed text-[#203528] sm:p-6">
        <p>
          HireScore provides AI-assisted guidance for matching resumes against job descriptions and surfacing improvement suggestions.
        </p>
        <p>
          Results are guidance, not guarantees. You remain responsible for your final resume, application decisions, and any use of the suggestions.
        </p>
        <p>
          You agree not to upload harmful, deceptive, or unauthorized content and not to misuse the service in ways that harm other users or the platform.
        </p>
        <p>
          Payments and credits are currently disabled while HireScore is focused on this single product workflow.
        </p>
        <p>
          If you need help, contact{" "}
          <a href="mailto:contact@hirescore.in" className="font-semibold text-[#355e46] hover:text-[#2d503c]">
            contact@hirescore.in
          </a>.
        </p>
      </section>
    </main>
  );
}
