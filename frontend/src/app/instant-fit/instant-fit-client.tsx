"use client";

import Link from "next/link";

export default function InstantFitClient() {
  return (
    <main className="min-h-screen px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-4xl rounded-[2rem] border border-cyan-100/24 bg-[linear-gradient(150deg,rgba(8,28,52,0.92),rgba(5,18,34,0.95)_58%,rgba(16,44,64,0.86))] p-6 shadow-[0_24px_64px_rgba(2,8,22,0.46)] sm:p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/78">Instant Fit</p>
        <h1 className="mt-3 text-3xl font-semibold text-cyan-50 sm:text-4xl">JD Fit Check Is Being Prepared</h1>
        <p className="mt-3 text-sm text-cyan-50/78 sm:text-base">
          This route is active and will host the no-login JD fit workflow. For now, use Analyze to run a full role-fit report.
        </p>
        <Link
          href="/upload"
          className="mt-5 inline-flex rounded-xl border border-cyan-100/38 bg-cyan-200/16 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-200/24"
        >
          Go To Analyze
        </Link>
      </section>
    </main>
  );
}
