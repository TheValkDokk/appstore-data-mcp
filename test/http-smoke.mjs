/**
 * Remote (streamable HTTP) smoke test against a locally running server:
 *   PORT=8098 APPSTORE_API_BASE_URL=... APPSTORE_PROXY_SECRET=... node dist/http.js
 *
 * Checks: discovery without a key, the structured credential error, and a real
 * data call when the caller supplies the X-RapidAPI-Key header.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_BASE = process.env.HTTP_SMOKE_URL ?? "http://127.0.0.1:8098/mcp";
// A second instance started *without* APPSTORE_PROXY_SECRET, to prove the
// missing-credentials path (locally the proxy secret is the test bypass).
const URL_NOKEY = process.env.HTTP_SMOKE_URL_NOKEY ?? "http://127.0.0.1:8097/mcp";
const failures = [];
const check = (n, c, d = "") => { console.log(`${c ? "PASS" : "FAIL"} ${n}${c ? "" : `  <- ${d}`}`); if (!c) failures.push(n); };

async function connect(headers = {}, url = URL_BASE) {
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client({ name: "http-smoke", version: "0.0.0" });
  await client.connect(transport);
  return client;
}
const parse = (res) => { try { return JSON.parse(res.content?.[0]?.text ?? "{}"); } catch { return {}; } };

// health
{
  const r = await fetch(URL_BASE.replace(/\/mcp$/, "/health"));
  const body = await r.json().catch(() => ({}));
  check("health 200", r.status === 200 && body.status === "ok", `${r.status} ${JSON.stringify(body).slice(0, 80)}`);
}

// 1. no key: the server still lists tools (directory crawlers can index it)
{
  const client = await connect({}, URL_NOKEY);
  const { tools } = await client.listTools();
  check("tools listed without a key", tools.length === 5, tools.map((t) => t.name).join(","));
  const res = await client.callTool({ name: "get_app", arguments: { app_id: "389801252", store: "ios" } });
  const p = parse(res);
  check("call without key -> isError", res.isError === true, res);
  check("call without key -> MISSING_CREDENTIALS", p?.error?.code === "MISSING_CREDENTIALS", p?.error);
  check("hint mentions the header/env", /X-RapidAPI-Key|RAPIDAPI_KEY/.test(p?.error?.message ?? ""), p?.error?.message);
  await client.close();
}

// 2. with a key header: real data comes back
{
  const client = await connect({ "x-rapidapi-key": process.env.HTTP_SMOKE_KEY ?? "test-key" });
  const res = await client.callTool({ name: "get_app", arguments: { app_id: "389801252", store: "ios", country: "us" } });
  const p = parse(res);
  check("call with key -> no error", !res.isError, p?.error);
  check("call with key -> live app", /Instagram/i.test(p?.app?.name ?? ""), p?.app?.name);
  check("call with key -> rounded rating", /^\d+(\.\d{1,2})?$/.test(String(p?.app?.rating)), p?.app?.rating);
  await client.close();
}

// 3. bearer token path also works
{
  const client = await connect({ authorization: `Bearer ${process.env.HTTP_SMOKE_KEY ?? "test-key"}` });
  const res = await client.callTool({ name: "top_charts", arguments: { store: "ios", country: "us", limit: 3 } });
  const p = parse(res);
  check("bearer auth -> charts", !res.isError && p?.apps?.length === 3, p?.error ?? p?.count);
  await client.close();
}

console.log(`\nRESULT: ${failures.length ? `${failures.length} FAILED ${JSON.stringify(failures)}` : "ALL PASS"}`);
process.exit(failures.length ? 1 : 0);
