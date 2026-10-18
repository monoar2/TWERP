import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { handleMcp, type JsonRpcRequest } from "../mcp/server.js";

/**
 * MCP over Streamable HTTP (stateless, JSON responses). Clients authenticate
 * with the same bearer token as the apps, so the server hook already checked
 * the session and the user's access to the AI area.
 */
export async function mcpRoutes(app: FastifyInstance, ctx: AppContext) {
  const deps = () => ({ sql: ctx.sql, readerSql: ctx.readerSql, messages: ctx.messages, model: ctx.aiModel });

  app.post("/mcp", async (req, reply) => {
    const body = req.body as JsonRpcRequest | JsonRpcRequest[] | undefined;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleMcp(deps(), m)))).filter(Boolean);
      return out.length ? reply.send(out) : reply.code(202).send();
    }
    const res = await handleMcp(deps(), body ?? ({} as JsonRpcRequest));
    return res ? reply.send(res) : reply.code(202).send();
  });

  // No server-initiated stream and no sessions to end.
  app.get("/mcp", async (_req, reply) => reply.code(405).header("allow", "POST").send({ error: "Use POST" }));
  app.delete("/mcp", async (_req, reply) => reply.code(405).header("allow", "POST").send({ error: "Use POST" }));
}
