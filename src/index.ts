#!/usr/bin/env node
/**
 * stdio entry point — for local MCP clients (Claude Desktop, Cursor, VS Code, Codex).
 * Auth: RAPIDAPI_KEY from the environment.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, VERSION } from "./server.js";

async function main() {
  const server = buildServer(() => process.env.RAPIDAPI_KEY?.trim() || undefined);
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol — log to stderr only.
  console.error(`appstore-data-mcp v${VERSION} ready (stdio)`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
