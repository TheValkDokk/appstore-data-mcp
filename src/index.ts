#!/usr/bin/env node
/**
 * appstore-data-mcp — MCP server for live App Store + Google Play data.
 *
 * Tools: search_apps, get_app, get_app_reviews, top_charts, list_categories.
 * Auth: RAPIDAPI_KEY (marketplace) or APPSTORE_PROXY_SECRET + APPSTORE_API_BASE_URL (self-hosted).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ApiError,
  call,
  normalizeApp,
  normalizeChartRow,
  normalizeReview,
  normalizeSearchHit,
  type Store,
} from "./api.js";

const VERSION = "0.1.0";

const server = new McpServer(
  { name: "appstore-data", version: VERSION },
  {
    instructions:
      "Live data from the Apple App Store and Google Play. Use search_apps to find an app when you only have a name; " +
      "use the numeric app id (iOS) or package name (Android) from those results for get_app and get_app_reviews. " +
      "Country codes are ISO-2 storefronts (us, gb, de, jp, cn) — data, pricing and availability differ per storefront. " +
      "Results are trimmed for readability; description is truncated.",
  },
);

const storeSchema = z.enum(["ios", "android"]).describe('Store to query: "ios" (Apple App Store) or "android" (Google Play).');
const countrySchema = z.string().length(2).default("us").describe("ISO-2 storefront code, e.g. us, gb, de, jp. Defaults to us.");
const langSchema = z.string().min(2).max(5).default("en").describe("Language code, e.g. en, es, fr, ja. Defaults to en.");

function json(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(err: unknown) {
  const isApi = err instanceof ApiError;
  const code = isApi ? err.code : "UNEXPECTED_ERROR";
  const message = isApi ? err.message : err instanceof Error ? err.message : String(err);
  const hint =
    code === "MISSING_CREDENTIALS"
      ? " Set RAPIDAPI_KEY in the MCP server environment."
      : code === "APP_NOT_FOUND"
        ? " The id is not available in that storefront — try another country."
        : "";
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message: message + hint } }, null, 2) }],
  };
}

server.registerTool(
  "search_apps",
  {
    title: "Search apps",
    description:
      "Search a store by keyword, using the store's own relevance ranking. Returns compact rows with the id you need for get_app.",
    inputSchema: {
      query: z.string().min(1).describe("Keyword(s) to search for, e.g. 'meditation', 'photo editor'."),
      store: storeSchema.default("ios"),
      country: countrySchema,
      lang: langSchema,
      limit: z.number().int().min(1).max(50).default(10).describe("Number of results, 1-50. Defaults to 10."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, store, country, lang, limit }) => {
    try {
      const path = store === "ios" ? "/ios/search" : "/android/search";
      const body = await call(path, { q: query, country, lang, limit });
      const rows = (body.data ?? []).map((r: any) => normalizeSearchHit(store as Store, r));
      return json({ store, country, count: rows.length, has_more: body?.pagination?.has_more ?? false, results: rows });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_app",
  {
    title: "App details",
    description:
      "Full metadata for one app: name, developer, ratings, price, version, size, screenshots, store URL. Use the numeric app id (iOS) or package name (Android).",
    inputSchema: {
      app_id: z
        .string()
        .min(1)
        .describe("iOS: numeric Apple id (e.g. '389801252' for Instagram). Android: package name (e.g. 'com.instagram.android')."),
      store: storeSchema.default("ios"),
      country: countrySchema,
      lang: langSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ app_id, store, country, lang }) => {
    try {
      const path = store === "ios" ? `/ios/apps/${encodeURIComponent(app_id)}` : `/android/apps/${encodeURIComponent(app_id)}`;
      const body = await call(path, { country, lang });
      return json({ store, country, app: normalizeApp(store as Store, body.data ?? {}) });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_app_reviews",
  {
    title: "App reviews",
    description:
      "Paginated user reviews. sort=recent is best for monitoring new feedback; sort=helpful surfaces the loudest complaints. Page with offset and stop when has_more is false.",
    inputSchema: {
      app_id: z.string().min(1).describe("iOS numeric id or Android package name."),
      store: storeSchema.default("ios"),
      country: countrySchema,
      sort: z.enum(["recent", "helpful", "rating"]).default("recent").describe("recent | helpful | rating (rating is Android-only)."),
      limit: z.number().int().min(1).max(50).default(20).describe("Reviews per page, 1-50. Defaults to 20."),
      offset: z.number().int().min(0).default(0).describe("How many reviews to skip, for pagination."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ app_id, store, country, sort, limit, offset }) => {
    try {
      const path =
        store === "ios"
          ? `/ios/apps/${encodeURIComponent(app_id)}/reviews`
          : `/android/apps/${encodeURIComponent(app_id)}/reviews`;
      const body = await call(path, { country, sort, limit, offset });
      const rows = (body.data ?? []).map(normalizeReview);
      return json({ store, app_id, offset, count: rows.length, has_more: body?.pagination?.has_more ?? false, reviews: rows });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "top_charts",
  {
    title: "Top charts",
    description:
      "Ranked top-chart lists per storefront. iOS collections: topfreeapplications, toppaidapplications, topgrossingapplications, newapplications (+ ipad variants). Android: topselling_free, topselling_paid, topgrossing, new_free, new_paid.",
    inputSchema: {
      store: storeSchema.default("ios"),
      collection: z.string().optional().describe("Chart name. Defaults to topfreeapplications (iOS) / topselling_free (Android)."),
      category: z.string().optional().describe("Optional category id, e.g. '6018' (iOS Books) or 'GAME' (Android)."),
      country: countrySchema,
      limit: z.number().int().min(1).max(50).default(25).describe("Rows to return, 1-50. Defaults to 25."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ store, collection, category, country, limit }) => {
    try {
      const chosen = collection ?? (store === "ios" ? "topfreeapplications" : "topselling_free");
      const path = store === "ios" ? `/ios/top/${encodeURIComponent(chosen)}` : `/android/top/${encodeURIComponent(chosen)}`;
      const body = await call(path, { country, category, limit });
      const rows = (body.data ?? []).map((r: any) => normalizeChartRow(store as Store, r));
      return json({ store, collection: chosen, country, count: rows.length, apps: rows });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_categories",
  {
    title: "Store categories",
    description: "The store's category taxonomy — id and name — for building filters or resolving a category id used by top_charts.",
    inputSchema: { store: storeSchema.default("ios"), country: countrySchema },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ store, country }) => {
    try {
      const path = store === "ios" ? "/ios/categories" : "/android/categories";
      const body = await call(path, { country });
      const rows = (body.data ?? []).map((c: any) => ({ id: c.id, name: c.name }));
      return json({ store, count: rows.length, categories: rows });
    } catch (err) {
      return fail(err);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout carries the MCP protocol.
  console.error(`appstore-data-mcp v${VERSION} ready (stdio)`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
