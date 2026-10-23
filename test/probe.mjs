import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const t = new StreamableHTTPClientTransport(new URL(process.env.PROBE_URL),
  { requestInit: { headers: { "x-rapidapi-key": process.env.PROBE_KEY } } });
const c = new Client({ name: "probe", version: "0" });
await c.connect(t);
const res = await c.callTool({ name: "get_app", arguments: { app_id: "389801252", store: "ios", country: "us" } });
console.log(JSON.stringify(res).slice(0, 600));
await c.close();
