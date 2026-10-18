import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { answerQuestion, chartError, runReadOnly } from "../ai/agent.js";
import { UnsafeSqlError } from "../ai/sql-guard.js";
import type { AppContext } from "../context.js";
import { AppError, badRequest, notFound } from "../errors.js";
import { ACTIONS, applyProposal, rejectProposal } from "../services/actions.js";
import { idParam, parse } from "../validate.js";

const chartSpec = z.object({ type: z.enum(["bar", "line", "pie"]), x: z.string().min(1), y: z.array(z.string().min(1)).min(1).max(6) });

export async function aiRoutes(app: FastifyInstance, ctx: AppContext) {
  const reader = () => {
    if (!ctx.readerSql) throw new AppError(503, "La consulta con IA no está configurada (AI_DATABASE_URL)");
    return ctx.readerSql;
  };

  app.post("/ai/query", async (req) => {
    if (!ctx.messages || !ctx.readerSql) throw new AppError(503, "La consulta con IA no está configurada (ANTHROPIC_API_KEY y AI_DATABASE_URL)");
    const b = parse(z.object({
      question: z.string().min(3).max(2000),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(20).default([]),
    }), req.body);
    return answerQuestion(
      { db: ctx.sql, readerDb: ctx.readerSql, messages: ctx.messages, model: ctx.aiModel, user: req.user && { id: req.user.id, role: req.user.role } },
      b.question, b.history,
    );
  });

  app.get("/ai/history", async () => ctx.sql`SELECT id, question, answer, model, created_at FROM ai_query_log ORDER BY id DESC LIMIT 50`);

  // ---- Proposals: writes the assistant drafted, applied only by a user. ----
  app.get("/ai/proposals", async (req) => {
    const q = parse(z.object({ status: z.enum(["pending", "applied", "rejected", "failed"]).optional() }), req.query);
    const rows = await ctx.sql<{ kind: string }[]>`
      SELECT p.id, p.kind, p.summary, p.payload, p.status, p.result, p.created_at, p.decided_at, u.name AS user_name
      FROM ai_proposals p LEFT JOIN users u ON u.id = p.user_id
      WHERE (p.user_id = ${req.user!.id} OR ${req.user!.role === "admin"}) ${q.status ? ctx.sql`AND p.status = ${q.status}` : ctx.sql``}
      ORDER BY p.id DESC LIMIT 100`;
    return rows.map((r) => ({ ...r, label: ACTIONS[r.kind]?.label ?? r.kind }));
  });
  app.post("/ai/proposals/:id/apply", async (req) => applyProposal(ctx.sql, parse(idParam, req.params).id, req.user!));
  app.post("/ai/proposals/:id/reject", async (req) => rejectProposal(ctx.sql, parse(idParam, req.params).id, req.user!));

  // ---- Dashboard widgets: pinned AI charts whose SQL re-runs on every view. ----
  app.get("/ai/widgets", async (req) => {
    const widgets = await ctx.sql<{ id: number; title: string; question: string | null; sql: string; chart: z.infer<typeof chartSpec>; position: number }[]>`
      SELECT id, title, question, sql, chart, position FROM ai_widgets WHERE user_id = ${req.user!.id} ORDER BY position, id`;
    const db = reader();
    return Promise.all(widgets.map(async (w) => {
      try {
        const r = await runReadOnly(db, w.sql);
        return { ...w, columns: r.columns, rows: r.rows, error: chartError(r.columns, w.chart.x, w.chart.y) };
      } catch (err) {
        return { ...w, columns: [], rows: [], error: (err as Error).message };
      }
    }));
  });
  app.post("/ai/widgets", async (req, reply) => {
    const b = parse(z.object({ title: z.string().min(1).max(200), question: z.string().max(2000).optional(), sql: z.string().min(1).max(20000), chart: chartSpec }), req.body);
    let columns: string[];
    try {
      columns = (await runReadOnly(reader(), b.sql)).columns;
    } catch (err) {
      throw badRequest(err instanceof UnsafeSqlError ? err.message : `La consulta no se pudo ejecutar: ${(err as Error).message}`);
    }
    const error = chartError(columns, b.chart.x, b.chart.y);
    if (error) throw badRequest(error);
    const [row] = await ctx.sql`
      INSERT INTO ai_widgets (user_id, title, question, sql, chart, position)
      VALUES (${req.user!.id}, ${b.title}, ${b.question ?? null}, ${b.sql}, ${ctx.sql.json(b.chart)},
              (SELECT coalesce(max(position), 0) + 1 FROM ai_widgets WHERE user_id = ${req.user!.id}))
      RETURNING id, title, question, sql, chart, position`;
    return reply.code(201).send(row);
  });
  app.patch("/ai/widgets/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ title: z.string().min(1).max(200).optional(), position: z.number().int().min(0).optional() }), req.body);
    const [row] = await ctx.sql`
      UPDATE ai_widgets SET title = coalesce(${b.title ?? null}, title), position = coalesce(${b.position ?? null}, position)
      WHERE id = ${id} AND user_id = ${req.user!.id} RETURNING id, title, position`;
    if (!row) throw notFound("Widget");
    return row;
  });
  app.delete("/ai/widgets/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await ctx.sql`DELETE FROM ai_widgets WHERE id = ${id} AND user_id = ${req.user!.id} RETURNING id`;
    if (!row) throw notFound("Widget");
    return { ok: true };
  });
}
