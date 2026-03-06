const addParam = (searchParams: URLSearchParams, key: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return;
  searchParams.set(key, trimmed);
};

type UtmInput = {
  source: string;
  medium?: string;
  campaign: string;
  content?: string;
};

export const addUtmParams = (basePath: string, utm: UtmInput) => {
  if (!basePath) return basePath;
  const [pathname, existingQuery] = basePath.split("?");
  const params = new URLSearchParams(existingQuery || "");
  addParam(params, "utm_source", utm.source);
  addParam(params, "utm_medium", utm.medium || "organic");
  addParam(params, "utm_campaign", utm.campaign);
  if (utm.content) addParam(params, "utm_content", utm.content);
  const query = params.toString();
  return query ? `${pathname}?${query}` : basePath;
};
