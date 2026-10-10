import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { answerQuestion } from "../ai/agent.js";
import type { AppContext } from "../context.js";
import { AppError } from "../errors.js";
import { parse } from "../validate.js";

export async function aiRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/ai/query", async (req) => {
    if (!ctx.messages || !ctx.readerSql) throw new AppError(503, "La consulta con IA no está configurada (ANTHROPIC_API_KEY y AI_DATABASE_URL)");
    const b = parse(z.object({
      question: z.string().min(3).max(2000),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(20).default([]),
    }), req.body);
    return answerQuestion({ db: ctx.sql, readerDb: ctx.readerSql, messages: ctx.messages, model: ctx.aiModel }, b.question, b.history);
  });

  app.get("/ai/history", async () => ctx.sql`SELECT id, question, answer, model, created_at FROM ai_query_log ORDER BY id DESC LIMIT 50`);
}
