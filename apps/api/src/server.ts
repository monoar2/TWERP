import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";
import { can } from "./auth/permissions.js";
import { userForToken, type SessionUser } from "./auth/sessions.js";
import { AppError } from "./errors.js";
import { accountingRoutes } from "./routes/accounting.js";
import { aiRoutes } from "./routes/ai.js";
import { auditRoutes } from "./routes/audit.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { documentRoutes } from "./routes/documents.js";
import { intakeRoutes } from "./routes/intake.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { mcpRoutes } from "./routes/mcp.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export async function buildServer(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  // Expose content-disposition so browsers can read download file names.
  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    exposedHeaders: ["content-disposition"],
  });

  app.get("/health", async () => ({ ok: true }));

  // Every route needs a signed-in user whose role allows it, except health and login.
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0]!;
    if (req.method === "OPTIONS" || path === "/health" || path === "/auth/login") return;
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    req.user = token ? await userForToken(ctx.sql, token) : undefined;
    if (!req.user) return reply.code(401).send({ error: "Inicia sesión para continuar" });
    if (!path.startsWith("/auth/") && !can(req.user.role, req.method, path))
      return reply.code(403).send({ error: "Tu rol no tiene permiso para esta acción" });
  });

  // Audit trail of every write, successful or not.
  app.addHook("onResponse", async (req, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.user) return;
    await ctx.sql`INSERT INTO audit_log (user_id, method, path, status, ip)
                  VALUES (${req.user.id}, ${req.method}, ${req.url.slice(0, 500)}, ${reply.statusCode}, ${req.ip})`
      .catch((err) => app.log.error(err, "audit log write failed"));
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: err.message, details: err.details });
    const pg = err as { code?: string; message: string };
    // Postgres raise_exception (triggers) and constraint violations are user errors.
    if (pg.code === "P0001") return reply.code(422).send({ error: pg.message });
    if (pg.code === "23505") return reply.code(409).send({ error: "Ya existe un registro con esos datos" });
    if (pg.code?.startsWith("23")) return reply.code(400).send({ error: pg.message });
    if ((err as { validation?: unknown }).validation) return reply.code(400).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.code(500).send({ error: "Error interno" });
  });

  await authRoutes(app, ctx);
  await catalogRoutes(app, ctx);
  await inventoryRoutes(app, ctx);
  await documentRoutes(app, ctx);
  await accountingRoutes(app, ctx);
  await aiRoutes(app, ctx);
  await intakeRoutes(app, ctx);
  await auditRoutes(app, ctx);
  await mcpRoutes(app, ctx);
  return app;
}
