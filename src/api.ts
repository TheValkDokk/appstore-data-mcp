/**
 * Thin client for the App Store Google Play Data API.
 *
 * Auth, in order of precedence:
 *   RAPIDAPI_KEY            -> marketplace traffic (X-RapidAPI-Key + X-RapidAPI-Host)
 *   APPSTORE_PROXY_SECRET   -> self-hosted origin (X-RapidAPI-Proxy-Secret), used for tests
 *   APPSTORE_API_BASE_URL   -> override the base URL (self-hosted deployments)
 */

export type Store = "ios" | "android";

const DEFAULT_HOST = "app-store-google-play-data-api.p.rapidapi.com";
const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function config() {
  const key = process.env.RAPIDAPI_KEY?.trim();
  const host = process.env.APPSTORE_API_HOST?.trim() || DEFAULT_HOST;
  const base = (process.env.APPSTORE_API_BASE_URL?.trim() || `https://${host}`).replace(/\/+$/, "");
  const proxySecret = process.env.APPSTORE_PROXY_SECRET?.trim();
  return { key, host, base, proxySecret };
}

export async function call(path: string, params: Record<string, unknown> = {}, opts: { key?: string } = {}): Promise<any> {
  const cfg = config();
  const key = opts.key?.trim() || cfg.key;
  const { host, base, proxySecret } = cfg;
  if (!key && !proxySecret) {
    throw new ApiError(
      0,
      "MISSING_CREDENTIALS",
      "RAPIDAPI_KEY is not set. Create a free key at https://rapidapi.com/TheValkDokk/api/app-store-google-play-data-api and set RAPIDAPI_KEY in the server environment.",
    );
  }

  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (key) {
    headers["X-RapidAPI-Key"] = key;
    headers["X-RapidAPI-Host"] = host;
  }
  if (proxySecret) headers["X-RapidAPI-Proxy-Secret"] = proxySecret;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
  } catch (err: any) {
    const aborted = err?.name === "AbortError";
    throw new ApiError(0, aborted ? "TIMEOUT" : "NETWORK_ERROR", aborted ? `Request timed out after ${REQUEST_TIMEOUT_MS} ms` : `Network error: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }

  if (!res.ok || body?.success === false) {
    const err = body?.error ?? body?.detail ?? body;
    const code = typeof err === "object" && err?.code ? String(err.code) : `HTTP_${res.status}`;
    const message = typeof err === "object" && err?.message ? String(err.message) : typeof err === "string" ? err : JSON.stringify(err).slice(0, 300);
    throw new ApiError(res.status, code, message, typeof err === "object" ? err?.details : undefined);
  }
  return body;
}

const round2 = (n: unknown): number | undefined =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;

const clip = (s: unknown, n: number): string | undefined => {
  if (typeof s !== "string" || !s) return undefined;
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
};

/** Same field names for both stores, so an agent doesn't have to learn two schemas. */
export function normalizeApp(store: Store, raw: any) {
  const ios = store === "ios";
  return {
    store,
    id: ios ? raw.track_id : raw.app_id,
    name: ios ? raw.track_name : raw.title,
    developer: ios ? raw.artist_name : raw.developer,
    rating: round2(ios ? raw.rating : raw.score),
    rating_count: ios ? raw.rating_count : raw.reviews,
    price: raw.price ?? null,
    currency: raw.currency ?? null,
    is_free: raw.is_free ?? (raw.price === 0),
    genres: ios ? raw.genres : raw.genre ? [raw.genre] : undefined,
    version: raw.version,
    installs: ios ? undefined : raw.installs,
    size: ios ? raw.file_size_bytes : raw.size,
    content_rating: raw.content_rating,
    icon_url: ios ? raw.icon_url : raw.icon,
    screenshots: (ios ? raw.screenshot_urls : raw.screenshot_urls)?.slice?.(0, 2),
    url: ios ? raw.track_view_url : raw.url,
    description: clip(raw.description, 400),
  };
}

export function normalizeSearchHit(store: Store, raw: any) {
  const ios = store === "ios";
  return {
    id: ios ? raw.track_id : raw.app_id,
    name: ios ? raw.track_name : raw.title,
    developer: ios ? raw.artist_name : raw.developer,
    rating: round2(ios ? raw.rating : raw.score),
    price: raw.price ?? null,
    is_free: raw.is_free,
    icon_url: ios ? raw.icon_url : raw.icon,
    url: ios ? raw.track_view_url : raw.url,
  };
}

export function normalizeReview(raw: any) {
  return {
    id: raw.id,
    author: raw.author ?? raw.username,
    rating: round2(raw.rating ?? raw.score),
    title: raw.title,
    text: clip(raw.content, 300),
    date: raw.date ?? raw.at,
    version: raw.version ?? raw.app_version,
    helpful_votes: raw.helpful_votes ?? raw.thumbs_up,
    developer_reply: clip(raw.reply_content, 200),
  };
}

export function normalizeChartRow(store: Store, raw: any) {
  const ios = store === "ios";
  return {
    rank: raw.rank,
    id: ios ? raw.track_id : raw.app_id,
    name: ios ? raw.track_name : raw.title,
    developer: ios ? raw.artist_name : raw.developer,
    rating: round2(ios ? raw.rating : raw.score),
    price: raw.price ?? null,
    icon_url: ios ? raw.icon_url : raw.icon,
  };
}
