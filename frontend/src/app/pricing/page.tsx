"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

type CreditWallet = {
  credits: number;
  welcome_credits: number;
  free_analysis_included: number;
  pricing: {
    analyze: number;
    ai_resume_generation: number;
    template_pdf_download: number;
  };
};

type AuthUser = {
  id: number;
  email: string;
  created_at: string;
};

type AuthPayload = {
  auth_token?: string;
  user?: AuthUser;
  wallet?: CreditWallet;
  feedback_required?: boolean;
};

type PaymentPackage = {
  id: string;
  label: string;
  credits: number;
  amount_inr: number;
};

type PaymentPackagesPayload = {
  stripe_enabled: boolean;
  packages: PaymentPackage[];
};

type ApiErrorDetail = {
  message?: string;
  wallet?: CreditWallet;
};

type ApiErrorPayload = {
  detail?: string | ApiErrorDetail;
  wallet?: CreditWallet;
  auth_token?: string;
  user?: AuthUser;
};

const creditRules = [
  {
    title: "Welcome Credits",
    value: "5 Credits",
    description: "Every new user gets 5 free credits, equal to exactly one free analysis report.",
  },
  {
    title: "Analysis Report",
    value: "5 Credits",
    description: "Use on /upload for shortlist probability, salary insights, and callback forecast.",
  },
  {
    title: "AI Resume Build + TXT",
    value: "15 Credits",
    description: "Generate or enhance resume content in Resume Studio and download as TXT.",
  },
  {
    title: "Template PDF Download",
    value: "20 Credits",
    description: "Export your final resume as a styled PDF template from Resume Studio.",
  },
];

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const AUTH_REQUEST_TIMEOUT_MS = 15000;

export default function PricingPage() {
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authUserEmail, setAuthUserEmail] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packagesError, setPackagesError] = useState("");
  const [paymentPackages, setPaymentPackages] = useState<PaymentPackage[]>([]);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [checkoutLoadingId, setCheckoutLoadingId] = useState<string | null>(null);

  const authHeader = useMemo(
    () => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined),
    [authToken]
  );

  const applyAuthPayload = (payload: AuthPayload | null | undefined) => {
    if (payload?.wallet) setWallet(payload.wallet);
    if (payload?.user?.email) setAuthUserEmail(payload.user.email);
    if (payload?.auth_token) {
      setAuthToken(payload.auth_token);
      window.localStorage.setItem("hirescore_auth_token", payload.auth_token);
    }
  };

  const parseApiError = async (response: Response) => {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    if (payload?.wallet) setWallet(payload.wallet);
    if (payload?.auth_token || payload?.user) applyAuthPayload(payload);

    if (payload?.detail && typeof payload.detail === "object") {
      if (payload.detail.wallet) setWallet(payload.detail.wallet);
      return payload.detail.message || `Request failed (${response.status})`;
    }
    if (typeof payload?.detail === "string") return payload.detail;
    return `Request failed (${response.status})`;
  };

  const submitAuthRequest = async (mode: "login" | "signup", email: string, password: string) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(apiUrl(mode === "signup" ? "/auth/signup" : "/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await parseApiError(response));
      return (await response.json()) as AuthPayload;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Login timed out while server was waking up. Please click Login once more.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  useEffect(() => {
    const run = async () => {
      setPackagesLoading(true);
      setPackagesError("");
      try {
        const response = await fetch(apiUrl("/payments/packages"));
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(payload?.detail || `Request failed (${response.status})`);
        }
        const payload = (await response.json()) as PaymentPackagesPayload;
        setStripeEnabled(Boolean(payload.stripe_enabled));
        setPaymentPackages(payload.packages || []);
      } catch (error) {
        setPackagesError(error instanceof Error ? error.message : "Unable to load payment packages.");
      } finally {
        setPackagesLoading(false);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    const token = window.localStorage.getItem("hirescore_auth_token");
    if (!token) return;
    setAuthToken(token);
    fetch(apiUrl("/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session expired");
        const payload = (await response.json()) as AuthPayload;
        applyAuthPayload(payload);
      })
      .catch(() => {
        setAuthToken("");
        setWallet(null);
        setAuthUserEmail("");
        window.localStorage.removeItem("hirescore_auth_token");
      });
  }, []);

  const handleAuthSubmit = async () => {
    const email = authEmail.trim();
    const password = authPassword.trim();
    if (!email || !password) {
      setAuthError("Enter email and password.");
      return;
    }

    setAuthLoading(true);
    setAuthError("");
    const loadingGuard = window.setTimeout(() => {
      setAuthLoading(false);
      setAuthError((prev) => prev || "Login request timed out. Please try again.");
    }, AUTH_REQUEST_TIMEOUT_MS + 2500);
    try {
      const payload = await submitAuthRequest(authMode, email, password);
      applyAuthPayload(payload);
      setAuthPassword("");
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to authenticate.");
    } finally {
      window.clearTimeout(loadingGuard);
      setAuthLoading(false);
    }
  };

  const handleCheckout = async (packageId: string) => {
    if (!authToken || !authHeader) {
      setAuthError("Login required before purchasing credits.");
      return;
    }

    setCheckoutLoadingId(packageId);
    setAuthError("");
    try {
      const response = await fetch(apiUrl("/payments/checkout"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          package_id: packageId,
          auth_token: authToken,
        }),
      });
      if (!response.ok) throw new Error(await parseApiError(response));
      const payload = (await response.json()) as { checkout_url?: string };
      if (!payload.checkout_url) throw new Error("Payment link was not returned.");
      window.location.href = payload.checkout_url;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to start payment.");
    } finally {
      setCheckoutLoadingId(null);
    }
  };

  const handleSignOut = () => {
    setAuthToken("");
    setAuthUserEmail("");
    setWallet(null);
    setAuthError("");
    window.localStorage.removeItem("hirescore_auth_token");
  };

  return (
    <main className="min-h-screen px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="premium-panel holo-sheen relative overflow-hidden rounded-[2rem] p-6 sm:p-12"
        >
          <div className="absolute -top-24 right-[-60px] h-72 w-72 rounded-full bg-cyan-200/20 blur-[100px]" />
          <div className="absolute bottom-[-120px] left-[-40px] h-72 w-72 rounded-full bg-amber-100/14 blur-[110px]" />

          <div className="relative z-10 text-center">
            <p className="inline-flex items-center gap-2 rounded-full glow-chip px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-cyan-100/82 sm:px-4 sm:text-xs sm:tracking-[0.28em]">
              <span className="live-dot" />
              Credit Pricing
            </p>
            <h1 className="mt-5 text-3xl font-semibold leading-tight text-cyan-50 sm:text-5xl">
              One Free Analysis, Then Credit-Based Usage
            </h1>
            <p className="mx-auto mt-4 max-w-3xl text-sm text-cyan-50/72 sm:text-base">
              Buy wallet credits to run more analyses and unlock premium Resume Studio actions.
            </p>
          </div>
        </motion.div>
      </section>

      <section className="mx-auto mt-8 grid max-w-7xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="neon-panel rounded-3xl p-5 sm:p-6">
          <p className="text-xs uppercase tracking-[0.15em] text-cyan-100/70">Wallet Access</p>
          {authToken && wallet ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm font-semibold text-cyan-50">{authUserEmail || "Signed in"}</p>
              <div className="flex flex-wrap gap-2 text-xs text-cyan-50/74">
                <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1.5">Credits: {wallet.credits}</span>
                <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1.5">
                  Analysis: {wallet.pricing.analyze} credits
                </span>
                <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1.5">
                  AI Resume: {wallet.pricing.ai_resume_generation} credits
                </span>
                <span className="rounded-lg border border-cyan-100/20 bg-cyan-100/8 px-2.5 py-1.5">
                  Template PDF: {wallet.pricing.template_pdf_download} credits
                </span>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-cyan-50/76">Login or signup to buy credits and use paid features.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="Email"
                  className="w-full rounded-2xl border border-cyan-200/35 bg-[#021327]/92 px-4 py-3 text-cyan-50 placeholder:text-cyan-100/45 outline-none transition focus:border-cyan-100"
                />
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="Password"
                  className="w-full rounded-2xl border border-cyan-200/35 bg-[#021327]/92 px-4 py-3 text-cyan-50 placeholder:text-cyan-100/45 outline-none transition focus:border-cyan-100"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleAuthSubmit()}
                  disabled={authLoading}
                  className="rounded-xl border border-cyan-100/35 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:opacity-60"
                >
                  {authLoading ? "Please wait..." : authMode === "signup" ? "Create Account" : "Login"}
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode((prev) => (prev === "signup" ? "login" : "signup"))}
                  className="rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10"
                >
                  {authMode === "signup" ? "Use Login" : "Use Signup"}
                </button>
              </div>
            </>
          )}
          {authError && <p className="mt-3 text-xs text-amber-100">{authError}</p>}
        </article>

        <article className="neon-panel rounded-3xl p-5 sm:p-6">
          <p className="text-xs uppercase tracking-[0.15em] text-cyan-100/70">Payments</p>
          <h3 className="mt-2 text-2xl font-semibold text-cyan-50">Stripe Credit Packs</h3>
          <p className="mt-2 text-sm text-cyan-50/72">
            Choose a pack and complete checkout. Credits are added automatically after payment confirmation.
          </p>
          {packagesError && <p className="mt-3 text-xs text-amber-100">{packagesError}</p>}
          {!packagesLoading && !stripeEnabled && (
            <p className="mt-3 text-xs text-amber-100">
              Stripe is not enabled yet. Add Stripe env vars on backend to activate live payments.
            </p>
          )}
          <div className="mt-4 space-y-2">
            {paymentPackages.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-100/20 bg-cyan-100/8 p-3">
                <div>
                  <p className="text-sm font-semibold text-cyan-50">{item.label}</p>
                  <p className="text-xs text-cyan-50/72">{item.credits} credits</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-cyan-100">₹{item.amount_inr}</p>
                  <button
                    type="button"
                    disabled={!stripeEnabled || checkoutLoadingId === item.id}
                    onClick={() => void handleCheckout(item.id)}
                    className="rounded-xl border border-cyan-100/34 bg-cyan-200/16 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:opacity-60"
                  >
                    {checkoutLoadingId === item.id ? "Opening..." : "Buy"}
                  </button>
                </div>
              </div>
            ))}
            {!packagesLoading && paymentPackages.length === 0 && (
              <p className="text-xs text-cyan-50/70">No credit packs configured yet.</p>
            )}
          </div>
        </article>
      </section>

      <section className="mx-auto mt-10 grid max-w-7xl gap-5 md:grid-cols-2 xl:grid-cols-4">
        {creditRules.map((rule, index) => (
          <motion.article
            key={rule.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ delay: index * 0.06, duration: 0.35 }}
            className="neon-panel rounded-3xl p-5 sm:p-6"
          >
            <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/64 sm:text-xs sm:tracking-[0.2em]">{rule.title}</p>
            <p className="mt-4 text-3xl font-semibold text-cyan-50">{rule.value}</p>
            <p className="mt-3 text-sm text-cyan-50/78">{rule.description}</p>
          </motion.article>
        ))}
      </section>

      <section className="mx-auto mt-12 max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-20px" }}
          className="premium-panel holo-sheen rounded-[2rem] p-6 text-center sm:p-10"
        >
          <h3 className="mx-auto mt-1 max-w-3xl text-2xl font-semibold text-cyan-50 sm:text-4xl">
            Start with your free score, then unlock AI workflows using credits.
          </h3>
          <div className="mt-8 flex flex-wrap justify-center gap-3 sm:gap-4">
            <Link
              href="/upload"
              className="w-full rounded-2xl border border-cyan-100/40 bg-cyan-200/18 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50 transition hover:bg-cyan-200/28 sm:w-auto sm:px-7 sm:py-3.5"
            >
              Check My Score (Free)
            </Link>
            <Link
              href="/studio"
              className="w-full rounded-2xl border border-cyan-100/25 px-6 py-3 text-center text-sm font-semibold tracking-wide text-cyan-50/88 transition hover:bg-cyan-200/10 sm:w-auto sm:px-7 sm:py-3.5"
            >
              Open Resume Studio
            </Link>
          </div>
        </motion.div>
      </section>
    </main>
  );
}
