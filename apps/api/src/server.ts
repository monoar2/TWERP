import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";
import { AppError } from "./errors.js";
import { accountingRoutes } from "./routes/accounting.js";
import { aiRoutes } from "./routes/ai.js";
import { catalogRoutes } from "./routes/catalog.js";
import { documentRoutes } from "./routes/documents.js";
import { inventoryRoutes } from "./routes/inventory.js";

export async function buildServer(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  // Single shared bearer token for v1; per-user auth and roles come next.
  app.addHook("onRequest", async (req, reply) => {
    if (!ctx.apiToken || req.method === "OPTIONS" || req.url === "/health") return;
    if (req.headers.authorization !== `Bearer ${ctx.apiToken}`) {
      return reply.code(401).send({ error: "No autorizado" });
    }
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

  await catalogRoutes(app, ctx);
  await inventoryRoutes(app, ctx);
  await documentRoutes(app, ctx);
  await accountingRoutes(app, ctx);
  await aiRoutes(app, ctx);
  return app;
}
