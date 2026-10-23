/**
 * HTTP entry point — the remote MCP endpoint (streamable HTTP, stateless).
 *
 * Auth: the caller's own RapidAPI key, per request:
 *   X-RapidAPI-Key: <key>            (preferred)
 *   Authorization: Bearer <key>
 *   ?key=<key>                       (for clients that can't send headers)
 *
 * Tools still list without a key, so directory crawlers can index the server;
 * a tool *call* without a key returns a structured MISSING_CREDENTIALS error
 * pointing at the signup page. Nothing is shared between users.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer, VERSION } from "./server.js";

const PORT = Number(process.env.PORT ?? 8080);

function keyFrom(req: IncomingMessage, url: URL): string | undefined {
  const headerKey = req.headers["x-rapidapi-key"] ?? req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) return headerKey.trim();
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  const q = url.searchParams.get("key");
  return q?.trim() || undefined;
}

function cors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-RapidAPI-Key, X-Api-Key, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "appstore-mcp", version: VERSION, endpoint: "/mcp" }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", hint: "the MCP endpoint is POST /mcp" }));
    return;
  }

  // One server + transport per request: stateless, and the caller's key never
  // outlives their own request.
  const key = keyFrom(req, url);
  const server = buildServer(() => key);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

  res.on("close", () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    const body = req.method === "POST" ? await readBody(req) : undefined;
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("request failed:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    }
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.error(`appstore-data-mcp v${VERSION} listening on :${PORT} (POST /mcp)`);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.error(`${sig} received, shutting down`);
    httpServer.close(() => process.exit(0));
  });
}
