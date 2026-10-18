import Anthropic from "@anthropic-ai/sdk";
import { createDb } from "@erp/db";
import { createInterface } from "node:readline";
import { handleMcp, type JsonRpcRequest } from "../mcp/server.js";

/**
 * MCP server over stdio for local clients (Claude Desktop, Claude Code).
 * Connects straight to Postgres with DATABASE_URL and AI_DATABASE_URL, so it
 * is meant for the operator's own machine; remote clients use POST /mcp with
 * a user token instead. stdout carries only JSON-RPC; logs go to stderr.
 */
const sql = createDb(process.env.DATABASE_URL, { max: 2 });
const readerSql = process.env.AI_DATABASE_URL ? createDb(process.env.AI_DATABASE_URL, { max: 2 }) : undefined;
const messages = process.env.ANTHROPIC_API_KEY ? new Anthropic().beta.messages : undefined;
const deps = { sql, readerSql, messages, model: process.env.AI_MODEL ?? "claude-opus-5-5" };
if (!readerSql) console.error("AI_DATABASE_URL is not set: run_sql and ask_erp are disabled");

const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);

const rl = createInterface({ input: process.stdin });
const pending = new Set<Promise<void>>();
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg: JsonRpcRequest;
  try {
    msg = JSON.parse(line) as JsonRpcRequest;
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const p = handleMcp(deps, msg)
    .then((res) => { if (res) send(res); })
    .catch((err) => { console.error(err); send({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: "Internal error" } }); })
    .finally(() => pending.delete(p));
  pending.add(p);
});
rl.on("close", async () => {
  await Promise.all(pending);
  await readerSql?.end();
  await sql.end();
});
