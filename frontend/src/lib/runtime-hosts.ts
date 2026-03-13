export const PRODUCTION_HOSTS = ["hirescore.in", "www.hirescore.in"] as const;
export const STAGING_HOSTS = ["staging.hirescore.in"] as const;
export const PREVIEW_HOST_SUFFIX = ".vercel.app";

export const normalizeHost = (value: string | null | undefined): string => {
  const host = (value || "").trim().toLowerCase();
  if (!host) return "";
  const [withoutPort] = host.split(":");
  return withoutPort || "";
};

export const isProductionHost = (value: string | null | undefined): boolean => {
  const host = normalizeHost(value);
  return PRODUCTION_HOSTS.includes(host as (typeof PRODUCTION_HOSTS)[number]);
};

export const isStagingHost = (value: string | null | undefined): boolean => {
  const host = normalizeHost(value);
  return STAGING_HOSTS.includes(host as (typeof STAGING_HOSTS)[number]);
};

export const isPreviewHost = (value: string | null | undefined): boolean => {
  const host = normalizeHost(value);
  return Boolean(host && host.endsWith(PREVIEW_HOST_SUFFIX));
};

export const classifyHost = (
  value: string | null | undefined,
): "production" | "staging" | "preview" | "other" => {
  if (isProductionHost(value)) return "production";
  if (isStagingHost(value)) return "staging";
  if (isPreviewHost(value)) return "preview";
  return "other";
};
