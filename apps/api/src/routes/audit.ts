import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { conflict, notFound } from "../errors.js";
import { CHECKS, runAudit } from "../services/auditor.js";
import { idParam, parse } from "../validate.js";

/** The automatic auditor: findings, runs and their AI summaries. */
export async function auditRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sql } = ctx;

  app.get("/audit/checks", async () => CHECKS.map((c) => ({ code: c.code, label: c.label })));

  app.get("/audit/findings", async (req) => {
    const q = parse(z.object({ status: z.enum(["open", "dismissed", "resolved", "all"]).default("open") }), req.query);
    return sql`
      SELECT f.id, f.check_code, f.severity, f.title, f.detail, f.evidence, f.status, f.first_seen, f.last_seen, f.note, u.name AS dismissed_by_name
      FROM audit_findings f LEFT JOIN users u ON u.id = f.dismissed_by
      WHERE ${q.status === "all"} OR f.status = ${q.status}
      ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, f.last_seen DESC LIMIT 500`;
  });

  app.get("/audit/runs", async () => sql`SELECT * FROM audit_runs ORDER BY id DESC LIMIT 20`);

  app.post("/audit/run", async () => {
    const r = await runAudit({ sql, messages: ctx.messages, model: ctx.aiModel }, "manual");
    if (!r) throw conflict("Ya hay una revisión en curso");
    return r;
  });

  app.post("/audit/findings/:id/dismiss", async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ note: z.string().max(500).optional() }), req.body ?? {});
    const [row] = await sql`UPDATE audit_findings SET status = 'dismissed', dismissed_by = ${req.user!.id}, note = ${b.note ?? null}
                            WHERE id = ${id} RETURNING id, status`;
    if (!row) throw notFound("Hallazgo");
    return row;
  });

  app.post("/audit/findings/:id/reopen", async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await sql`UPDATE audit_findings SET status = 'open', dismissed_by = NULL, note = NULL WHERE id = ${id} RETURNING id, status`;
    if (!row) throw notFound("Hallazgo");
    return row;
  });
}
