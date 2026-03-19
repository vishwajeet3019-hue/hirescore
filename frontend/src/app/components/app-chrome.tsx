import Link from "next/link";
import { BRAND_DESCRIPTION, BRAND_FOOTER_TAGLINE } from "@/lib/brand";
import BrandLogo from "./brand-logo";
import SiteHeader from "./site-header";

type AppChromeProps = {
  children: React.ReactNode;
};

export default function AppChrome({ children }: AppChromeProps) {
  return (
    <>
      <SiteHeader />

      <main className="relative">{children}</main>

      <footer className="mt-16 border-t border-[#d9ccb5] px-4 py-10 sm:px-6 sm:py-12">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
          <div>
            <BrandLogo titleClassName="text-lg" />
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#52604d]">{BRAND_DESCRIPTION}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#7a846e]">Product</p>
            <div className="mt-3 grid gap-2 text-sm">
              <Link href="/" className="font-medium text-[#203528] transition hover:text-[#355e46]">
                Home
              </Link>
              <Link href="/application-copilot" className="font-medium text-[#203528] transition hover:text-[#355e46]">
                Resume Matcher
              </Link>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#7a846e]">Legal</p>
            <div className="mt-3 grid gap-2 text-sm">
              <Link href="/privacy-policy" className="font-medium text-[#203528] transition hover:text-[#355e46]">
                Privacy Policy
              </Link>
              <Link href="/terms-of-service" className="font-medium text-[#203528] transition hover:text-[#355e46]">
                Terms of Service
              </Link>
              <a href="mailto:contact@hirescore.in" className="font-medium text-[#203528] transition hover:text-[#355e46]">
                contact@hirescore.in
              </a>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-7xl text-center text-xs uppercase tracking-[0.18em] text-[#7a846e]">
          {BRAND_FOOTER_TAGLINE}
        </p>
      </footer>
    </>
  );
}
