import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { confirmIntake, createIntake, getIntake } from "../services/intake.js";
import { date, id, idParam, parse } from "../validate.js";
import { supplierLine } from "./documents.js";

/** Received CFDIs, PDFs and photos turned into supplier invoices. */
export async function intakeRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sql } = ctx;

  app.get("/intake", async () => sql`
    SELECT d.id, d.file_name, d.source, d.status, d.supplier_invoice_id, d.created_at,
           d.suggestion->>'supplierName' AS supplier_name, d.suggestion->>'computedTotal' AS total, u.name AS created_by_name
    FROM document_intakes d LEFT JOIN users u ON u.id = d.created_by ORDER BY d.id DESC LIMIT 100`);

  app.get("/intake/:id", async (req) => getIntake(sql, parse(idParam, req.params).id));

  // Files arrive base64-encoded in JSON, like the CSD upload; 10 MB raw is ~14 MB encoded.
  app.post("/intake", { bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
    const b = parse(z.object({ fileName: z.string().min(1).max(255), mediaType: z.string().max(100).default(""), contentBase64: z.string().min(1) }), req.body);
    const content = Buffer.from(b.contentBase64, "base64");
    const intake = await createIntake({ sql, messages: ctx.messages, model: ctx.aiModel }, req.user?.id, { fileName: b.fileName, mediaType: b.mediaType, content });
    return reply.code(201).send(intake);
  });

  app.post("/intake/:id/confirm", async (req) => {
    const { id: intakeId } = parse(idParam, req.params);
    const b = parse(z.object({
      thirdPartyId: id.optional(),
      newSupplier: z.object({ name: z.string().min(1), rfc: z.string().min(12).max(13), regimenFiscal: z.string().length(3), codigoPostal: z.string() }).optional(),
      warehouseId: id.optional(),
      supplierRef: z.string().optional(),
      issueDate: date.optional(),
      metodoPago: z.enum(["PUE", "PPD"]).optional(),
      lines: z.array(supplierLine).min(1).optional(),
      validate: z.boolean().default(false),
    }), req.body ?? {});
    return sql.begin((tx) => confirmIntake(tx, intakeId, b));
  });

  app.post("/intake/:id/discard", async (req) => {
    const { id: intakeId } = parse(idParam, req.params);
    const [row] = await sql`UPDATE document_intakes SET status = 'discarded' WHERE id = ${intakeId} AND status = 'extracted' RETURNING id, status`;
    return row ?? getIntake(sql, intakeId);
  });
}
