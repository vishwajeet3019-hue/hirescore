import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isProductionHost, isStagingHost, normalizeHost } from "./src/lib/runtime-hosts";

const ACTIVE_BRANCH = (process.env.VERCEL_GIT_COMMIT_REF || "").trim().toLowerCase();
const PRODUCTION_BRANCH = (process.env.DEPLOY_PROD_BRANCH || "main").trim().toLowerCase();
const STAGING_BRANCH = (process.env.DEPLOY_STAGING_BRANCH || "staging").trim().toLowerCase();
const DEPLOY_GUARD_BYPASS = (process.env.DEPLOY_GUARD_BYPASS || "").trim().toLowerCase() === "true";

const guardResponse = (target: "production" | "staging", host: string) =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deployment Guard Active</title><style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#020617;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}main{max-width:640px;border:1px solid #1e293b;background:#0b1220;border-radius:16px;padding:20px 22px}h1{margin:0 0 10px;font-size:20px}p{margin:0 0 8px;line-height:1.45;color:#cbd5e1}code{background:#111827;border:1px solid #1f2937;border-radius:6px;padding:2px 6px}</style></head><body><main><h1>Deployment Guard Active</h1><p>This deployment is blocked for <code>${target}</code> traffic.</p><p>Host: <code>${host}</code></p><p>Branch: <code>${ACTIVE_BRANCH || "unknown"}</code></p><p>Only branch <code>${target === "production" ? PRODUCTION_BRANCH : STAGING_BRANCH}</code> is allowed on this domain.</p></main></body></html>`,
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    },
  );

export function middleware(request: NextRequest) {
  if (DEPLOY_GUARD_BYPASS) return NextResponse.next();

  const host = normalizeHost(request.headers.get("host"));
  if (!host) return NextResponse.next();
  // Vercel CLI/manual deploys may not provide git branch metadata.
  // In that case, skip branch guard to avoid blocking production traffic.
  if (!ACTIVE_BRANCH) return NextResponse.next();

  if (isProductionHost(host) && ACTIVE_BRANCH !== PRODUCTION_BRANCH) {
    return guardResponse("production", host);
  }

  if (isStagingHost(host) && ACTIVE_BRANCH !== STAGING_BRANCH) {
    return guardResponse("staging", host);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-icon.png|robots.txt|sitemap.xml).*)"],
};
