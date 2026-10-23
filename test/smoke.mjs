/**
 * End-to-end smoke test: spawns the built server over stdio, lists tools and
 * calls each one against the live API.
 *
 *   RAPIDAPI_KEY=xxx npm run smoke
 * or, against a self-hosted origin:
 *   APPSTORE_API_BASE_URL=https://... APPSTORE_PROXY_SECRET=... npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: {
    ...process.env,
    APPSTORE_API_BASE_URL: process.env.APPSTORE_API_BASE_URL ?? "",
    APPSTORE_PROXY_SECRET: process.env.APPSTORE_PROXY_SECRET ?? "",
    RAPIDAPI_KEY: process.env.RAPIDAPI_KEY ?? "",
  },
  stderr: "pipe",
});

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : `  <- ${detail}`}`);
  if (!cond) failures.push(name);
};

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check("5 tools registered", names.length === 5, names);
check("tool names", JSON.stringify(names) === JSON.stringify(["get_app", "get_app_reviews", "list_categories", "search_apps", "top_charts"]), names);
check("every tool has an input schema", tools.every((t) => t.inputSchema?.type === "object"), names);

const callJson = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { res, parsed };
};

// 1. get_app (iOS, numeric id)
{
  const { res, parsed } = await callJson("get_app", { app_id: "389801252", store: "ios", country: "us" });
  check("get_app ios -> no error", !res.isError, parsed?.error);
  check("get_app ios -> name", /Instagram/i.test(parsed?.app?.name ?? ""), parsed?.app?.name);
  check("get_app ios -> id", String(parsed?.app?.id) === "389801252", parsed?.app?.id);
  check("get_app ios -> rating present", typeof parsed?.app?.rating === "number", parsed?.app?.rating);
  check("get_app ios -> url", /apps\.apple\.com/.test(parsed?.app?.url ?? ""), parsed?.app?.url);
}

// 2. get_app (Android, package name) — same normalized shape
{
  const { res, parsed } = await callJson("get_app", { app_id: "com.instagram.android", store: "android", country: "us" });
  check("get_app android -> no error", !res.isError, parsed?.error);
  check("get_app android -> title", /Instagram/i.test(parsed?.app?.name ?? ""), parsed?.app?.name);
  check("get_app android -> has installs", typeof parsed?.app?.installs === "string", parsed?.app?.installs);
}

// 3. search_apps
{
  const { res, parsed } = await callJson("search_apps", { query: "meditation", store: "ios", country: "us", limit: 5 });
  check("search_apps -> no error", !res.isError, parsed?.error);
  check("search_apps -> returns rows", Array.isArray(parsed?.results) && parsed.results.length > 0, parsed?.count);
  check("search_apps -> rows carry ids", parsed?.results?.every((r) => r.id != null), parsed?.results?.[0]);
}

// 4. get_app_reviews
{
  const { res, parsed } = await callJson("get_app_reviews", { app_id: "389801252", store: "ios", limit: 3, sort: "recent" });
  check("get_app_reviews -> no error", !res.isError, parsed?.error);
  check("get_app_reviews -> rows", Array.isArray(parsed?.reviews) && parsed.reviews.length > 0, parsed?.count);
  check("get_app_reviews -> has_more flag", typeof parsed?.has_more === "boolean", parsed?.has_more);
  check("get_app_reviews -> normalized rating", parsed?.reviews?.[0]?.rating != null, parsed?.reviews?.[0]);
}

// 5. top_charts
{
  const { res, parsed } = await callJson("top_charts", { store: "ios", country: "us", limit: 5 });
  check("top_charts -> no error", !res.isError, parsed?.error);
  check("top_charts -> 5 rows", parsed?.apps?.length === 5, parsed?.count);
  check("top_charts -> ranks present", parsed?.apps?.[0]?.rank != null, parsed?.apps?.[0]);
}

// 6. list_categories
{
  const { res, parsed } = await callJson("list_categories", { store: "android" });
  check("list_categories -> no error", !res.isError, parsed?.error);
  check("list_categories -> rows", Array.isArray(parsed?.categories) && parsed.categories.length > 3, parsed?.count);
}

// 7. error surface: a storefront that does not have the app
{
  const { res, parsed } = await callJson("get_app", { app_id: "1107421413", store: "ios", country: "us" });
  check("unknown app -> isError", res.isError === true, parsed);
  check("unknown app -> APP_NOT_FOUND code", parsed?.error?.code?.includes("NOT_FOUND") || /not found/i.test(parsed?.error?.message ?? ""), parsed?.error);
}

// 8. validation: bad store rejected by schema
{
  let threw = false;
  try { await client.callTool({ name: "get_app", arguments: { app_id: "1", store: "windows" } }); }
  catch { threw = true; }
  const res = threw ? null : await client.callTool({ name: "get_app", arguments: { app_id: "1", store: "windows" } });
  check("invalid store rejected", threw || res?.isError === true, res);
}

await client.close();
console.log(`\nRESULT: ${failures.length ? `${failures.length} FAILED ${JSON.stringify(failures)}` : "ALL PASS"}`);
process.exit(failures.length ? 1 : 0);
