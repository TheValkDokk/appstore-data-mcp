/**
 * Clean-room check: installs nothing locally, runs the PUBLISHED package through
 * `npx -y appstore-data-mcp` and exercises one tool over a real stdio handshake.
 *
 *   RAPIDAPI_KEY=xxx node test/registry.mjs
 *   APPSTORE_API_BASE_URL=... APPSTORE_PROXY_SECRET=... node test/registry.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "appstore-data-mcp"],
  env: { ...process.env },
  stderr: "pipe",
});
const client = new Client({ name: "registry-check", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const res = await client.callTool({ name: "get_app", arguments: { app_id: "389801252", store: "ios", country: "us" } });
const payload = JSON.parse(res.content?.[0]?.text ?? "{}");
const ok = !res.isError && /Instagram/i.test(payload?.app?.name ?? "");
console.log(ok ? `PASS published package serves live data: ${payload.app.name} (${payload.app.rating}★)` : `FAIL ${JSON.stringify(payload).slice(0, 300)}`);
await client.close();
process.exit(ok ? 0 : 1);
