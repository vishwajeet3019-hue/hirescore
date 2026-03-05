import { NextRequest } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";

type RouteContext = {
  params: Promise<{ path: string[] }> | { path: string[] };
};

const toTargetUrl = async (request: NextRequest, context: RouteContext) => {
  const resolved = await Promise.resolve(context.params);
  const pathSegments = Array.isArray(resolved?.path) ? resolved.path : [];
  if (!pathSegments.length || pathSegments[0] !== "admin") {
    return null;
  }

  const target = new URL(`${API_BASE_URL.replace(/\/+$/, "")}/${pathSegments.join("/")}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value);
  });
  return target;
};

const proxyRequest = async (request: NextRequest, context: RouteContext) => {
  const targetUrl = await toTargetUrl(request, context);
  if (!targetUrl) {
    return new Response(JSON.stringify({ detail: "Invalid admin proxy path." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const outboundHeaders = new Headers();
  const contentType = request.headers.get("content-type");
  const authHeader = request.headers.get("authorization");
  const adminKeyHeader = request.headers.get("x-admin-key");
  if (contentType) outboundHeaders.set("content-type", contentType);
  if (authHeader) outboundHeaders.set("authorization", authHeader);
  if (adminKeyHeader) outboundHeaders.set("x-admin-key", adminKeyHeader);

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method,
      headers: outboundHeaders,
      body,
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    const upstreamContentType = upstream.headers.get("content-type");
    const upstreamDisposition = upstream.headers.get("content-disposition");
    const upstreamCacheControl = upstream.headers.get("cache-control");
    if (upstreamContentType) responseHeaders.set("content-type", upstreamContentType);
    if (upstreamDisposition) responseHeaders.set("content-disposition", upstreamDisposition);
    if (upstreamCacheControl) responseHeaders.set("cache-control", upstreamCacheControl);

    const buffer = await upstream.arrayBuffer();
    return new Response(buffer, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ detail: "Admin proxy could not reach backend." }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const OPTIONS = proxyRequest;
export const HEAD = proxyRequest;

