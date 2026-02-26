"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

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
  otp_required?: boolean;
  message?: string;
  otp_expires_minutes?: number;
};

type PaymentPackage = {
  id: string;
  label: string;
  credits: number;
  amount_inr: number;
};

type PaymentPackagesPayload = {
  payment_gateway?: string;
  payment_enabled?: boolean;
  stripe_enabled: boolean;
  razorpay_enabled?: boolean;
  razorpay_key_id?: string;
  packages: PaymentPackage[];
};

type CheckoutPayload = {
  provider?: "stripe" | "razorpay";
  checkout_url?: string;
  session_id?: string;
  order_id?: string;
  razorpay_key_id?: string;
  currency?: string;
  amount_paise?: number;
  package_id?: string;
  package_label?: string;
  credits?: number;
  prefill_email?: string;
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
const AUTH_REQUEST_TIMEOUT_MS = 70000;

export default function PricingPage() {
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authUserEmail, setAuthUserEmail] = useState("");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [signupOtp, setSignupOtp] = useState("");
  const [signupOtpRequired, setSignupOtpRequired] = useState(false);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [forgotOtpRequested, setForgotOtpRequested] = useState(false);
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packagesError, setPackagesError] = useState("");
  const [paymentPackages, setPaymentPackages] = useState<PaymentPackage[]>([]);
  const [paymentGateway, setPaymentGateway] = useState("none");
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [razorpayEnabled, setRazorpayEnabled] = useState(false);
  const [razorpayKeyId, setRazorpayKeyId] = useState("");
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
    if (payload?.message) setAuthInfo(payload.message);
    if (payload?.otp_required) setSignupOtpRequired(true);
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
      const response = await fetch(apiUrl(mode === "signup" ? "/auth/signup/request-otp" : "/auth/login"), {
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
        throw new Error("Server wake-up is taking longer than expected. Please wait 10-20 seconds and try again.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const verifySignupOtp = async (email: string, otp: string) => {
    const response = await fetch(apiUrl("/auth/signup/verify-otp"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, otp }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return (await response.json()) as AuthPayload;
  };

  const requestForgotPasswordOtp = async (email: string) => {
    const response = await fetch(apiUrl("/auth/forgot-password/request-otp"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return (await response.json()) as AuthPayload;
  };

  const resetForgottenPassword = async (email: string, otp: string, newPassword: string) => {
    const response = await fetch(apiUrl("/auth/forgot-password/reset"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        otp,
        new_password: newPassword,
      }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return (await response.json()) as AuthPayload;
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
        setPaymentGateway((payload.payment_gateway || "none").toLowerCase());
        setPaymentEnabled(Boolean(payload.payment_enabled));
        setStripeEnabled(Boolean(payload.stripe_enabled));
        setRazorpayEnabled(Boolean(payload.razorpay_enabled));
        setRazorpayKeyId((payload.razorpay_key_id || "").trim());
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
    setAuthError("");
    setAuthInfo("");
    setAuthLoading(true);
    const loadingGuard = window.setTimeout(() => {
      setAuthLoading(false);
      setAuthError((prev) => prev || "Login request timed out. Please try again.");
    }, AUTH_REQUEST_TIMEOUT_MS + 2500);
    try {
      if (forgotPasswordMode) {
        if (!forgotOtpRequested) {
          if (!email) throw new Error("Enter your email first.");
          const payload = await requestForgotPasswordOtp(email);
          setForgotOtpRequested(true);
          setAuthInfo(payload.message || "Reset OTP sent. Enter OTP and new password.");
        } else {
          if (!email || !forgotOtp.trim() || !forgotNewPassword.trim()) {
            throw new Error("Enter email, OTP, and new password.");
          }
          const payload = await resetForgottenPassword(email, forgotOtp.trim(), forgotNewPassword.trim());
          applyAuthPayload(payload);
          setForgotPasswordMode(false);
          setForgotOtpRequested(false);
          setForgotOtp("");
          setForgotNewPassword("");
          setAuthPassword("");
          setAuthInfo("Password reset successful. You are now logged in.");
        }
      } else if (authMode === "signup" && signupOtpRequired) {
        if (!email || !signupOtp.trim()) throw new Error("Enter email and OTP.");
        const payload = await verifySignupOtp(email, signupOtp.trim());
        applyAuthPayload(payload);
        setSignupOtpRequired(false);
        setSignupOtp("");
        setAuthPassword("");
        setAuthInfo("Signup complete. Welcome to HireScore.");
      } else {
        if (!email || !password) throw new Error("Enter email and password.");
        const payload = await submitAuthRequest(authMode, email, password);
        if (authMode === "signup") {
          setSignupOtpRequired(Boolean(payload.otp_required));
          setAuthInfo(payload.message || "OTP sent to your email.");
        } else {
          applyAuthPayload(payload);
          setAuthPassword("");
        }
      }
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to authenticate.");
    } finally {
      window.clearTimeout(loadingGuard);
      setAuthLoading(false);
    }
  };

  const ensureRazorpayScript = async () => {
    if (typeof window === "undefined") return false;
    if (window.Razorpay) return true;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay-checkout='true']");
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Unable to load Razorpay SDK.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.dataset.razorpayCheckout = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Unable to load Razorpay SDK."));
      document.body.appendChild(script);
    });
    return Boolean(window.Razorpay);
  };

  const openRazorpayCheckout = async (payload: CheckoutPayload) => {
    const orderId = payload.order_id?.trim();
    const keyId = (payload.razorpay_key_id || razorpayKeyId || "").trim();
    const amountPaise = Number(payload.amount_paise || 0);
    const currency = (payload.currency || "INR").trim();
    if (!orderId || !keyId || !Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new Error("Invalid Razorpay checkout payload.");
    }
    const loaded = await ensureRazorpayScript();
    if (!loaded || !window.Razorpay) {
      throw new Error("Unable to initialize Razorpay checkout.");
    }

    await new Promise<void>((resolve, reject) => {
      const rz = new window.Razorpay({
        key: keyId,
        amount: Math.floor(amountPaise),
        currency,
        name: "HireScore",
        description: `${payload.package_label || "Credit Pack"} (${payload.credits || 0} credits)`,
        order_id: orderId,
        prefill: {
          email: payload.prefill_email || authUserEmail || authEmail.trim(),
        },
        theme: {
          color: "#67e8f9",
        },
        handler: async (response: Record<string, unknown>) => {
          try {
            const verifyResponse = await fetch(apiUrl("/payments/razorpay/verify"), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeader,
              },
              body: JSON.stringify({
                order_id: String(response.razorpay_order_id || orderId),
                razorpay_payment_id: String(response.razorpay_payment_id || ""),
                razorpay_signature: String(response.razorpay_signature || ""),
                auth_token: authToken,
              }),
            });
            if (!verifyResponse.ok) throw new Error(await parseApiError(verifyResponse));
            const verifyPayload = (await verifyResponse.json()) as { wallet?: CreditWallet; message?: string };
            if (verifyPayload.wallet) setWallet(verifyPayload.wallet);
            setAuthInfo(verifyPayload.message || "Payment successful. Credits added.");
            resolve();
          } catch (error) {
            reject(error instanceof Error ? error : new Error("Unable to verify payment."));
          }
        },
        modal: {
          ondismiss: () => reject(new Error("Payment cancelled.")),
        },
      });
      rz.open();
    });
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
      const payload = (await response.json()) as CheckoutPayload;
      if (payload.provider === "razorpay") {
        await openRazorpayCheckout(payload);
      } else {
        if (!payload.checkout_url) throw new Error("Payment link was not returned.");
        window.location.href = payload.checkout_url;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start payment.";
      if (message !== "Payment cancelled.") setAuthError(message);
    } finally {
      setCheckoutLoadingId(null);
    }
  };

  const handleSignOut = () => {
    setAuthToken("");
    setAuthUserEmail("");
    setWallet(null);
    setAuthError("");
    setAuthInfo("");
    setSignupOtpRequired(false);
    setSignupOtp("");
    setForgotPasswordMode(false);
    setForgotOtpRequested(false);
    setForgotOtp("");
    setForgotNewPassword("");
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
              <p className="mt-2 text-sm text-cyan-50/76">
                {forgotPasswordMode
                  ? "Reset password via email OTP."
                  : signupOtpRequired
                    ? "Enter the OTP sent to your email to complete signup."
                    : "Login or signup to buy credits and use paid features."}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="Email"
                  className="w-full rounded-2xl border border-cyan-200/35 bg-[#021327]/92 px-4 py-3 text-cyan-50 placeholder:text-cyan-100/45 outline-none transition focus:border-cyan-100"
                />
                {forgotPasswordMode ? (
                  forgotOtpRequested ? (
                    <input
                      type="text"
                      value={forgotOtp}
                      onChange={(event) => setForgotOtp(event.target.value)}
                      placeholder="Reset OTP"
                      className="w-full rounded-2xl border border-cyan-200/35 bg-[#021327]/92 px-4 py-3 text-cyan-50 placeholder:text-cyan-100/45 outline-none transition focus:border-cyan-100"
                    />
                  ) : (
                    <input
                      disabled
                      value=""
                      placeholder="OTP will be sent to this email"
                      className="w-full rounded-2xl border border-cyan-200/35 bg-[#021327]/92 px-4 py-3 text-cyan-50 placeholder:text-cyan-100/45 opacity-70"
                    />
                  )
                ) : signupOtpRequired ? (
                  <input
                    type="text"
                    value={signupOtp}
                    onChange={(event) => setSignupOtp(event.target.value)}
                    placeholder="Signup OTP"
                    className="w-full rounded-2xl border border-cyan-200/35 bg-[#021327]/92 px-4 py-3 text-cyan-50 placeholder:text-cyan-100/45 outline-none transition focus:border-cyan-100"
                  />
                ) : (
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    placeholder="Password"
                    className="w-full rounded-2xl border border-cyan-200/35 bg-[#021327]/92 px-4 py-3 text-cyan-50 placeholder:text-cyan-100/45 outline-none transition focus:border-cyan-100"
                  />
                )}
              </div>
              {forgotPasswordMode && forgotOtpRequested && (
                <div className="mt-3">
                  <input
                    type="password"
                    value={forgotNewPassword}
                    onChange={(event) => setForgotNewPassword(event.target.value)}
                    placeholder="New password"
                    className="w-full rounded-2xl border border-cyan-200/35 bg-[#021327]/92 px-4 py-3 text-cyan-50 placeholder:text-cyan-100/45 outline-none transition focus:border-cyan-100"
                  />
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleAuthSubmit()}
                  disabled={authLoading}
                  className="rounded-xl border border-cyan-100/35 bg-cyan-200/16 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/24 disabled:opacity-60"
                >
                  {authLoading
                    ? "Please wait..."
                    : forgotPasswordMode
                      ? forgotOtpRequested
                        ? "Reset Password"
                        : "Send Reset OTP"
                      : authMode === "signup"
                        ? signupOtpRequired
                          ? "Verify OTP"
                          : "Send Signup OTP"
                        : "Login"}
                </button>
                {!forgotPasswordMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode((prev) => (prev === "signup" ? "login" : "signup"));
                      setSignupOtpRequired(false);
                      setSignupOtp("");
                      setAuthError("");
                      setAuthInfo("");
                    }}
                    className="rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10"
                  >
                    {authMode === "signup" ? "Use Login" : "Use Signup"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setForgotPasswordMode((prev) => !prev);
                    setForgotOtpRequested(false);
                    setForgotOtp("");
                    setForgotNewPassword("");
                    setSignupOtpRequired(false);
                    setSignupOtp("");
                    setAuthError("");
                    setAuthInfo("");
                  }}
                  className="rounded-xl border border-cyan-100/24 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-50/82 transition hover:bg-cyan-100/10"
                >
                  {forgotPasswordMode ? "Back To Login" : "Forgot Password"}
                </button>
              </div>
            </>
          )}
          {authInfo && <p className="mt-3 text-xs text-emerald-100">{authInfo}</p>}
          {authError && <p className="mt-3 text-xs text-amber-100">{authError}</p>}
        </article>

        <article className="neon-panel rounded-3xl p-5 sm:p-6">
          <p className="text-xs uppercase tracking-[0.15em] text-cyan-100/70">Payments</p>
          <h3 className="mt-2 text-2xl font-semibold text-cyan-50">Credit Packs</h3>
          <p className="mt-2 text-sm text-cyan-50/72">
            Choose a pack and complete checkout. Credits are added automatically after payment confirmation.
          </p>
          <p className="mt-2 text-xs text-cyan-100/72">
            Active gateway:{" "}
            <span className="font-semibold uppercase text-cyan-50">{paymentGateway}</span>
            {paymentGateway === "razorpay" && razorpayEnabled ? " (UPI/cards/netbanking)" : ""}
            {paymentGateway === "stripe" && stripeEnabled ? " (card checkout)" : ""}
          </p>
          {packagesError && <p className="mt-3 text-xs text-amber-100">{packagesError}</p>}
          {!packagesLoading && !paymentEnabled && (
            <p className="mt-3 text-xs text-amber-100">
              Payment gateway is not enabled yet. Configure Razorpay or Stripe env vars on backend.
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
                    disabled={!paymentEnabled || checkoutLoadingId === item.id}
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
