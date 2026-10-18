import type Anthropic from "@anthropic-ai/sdk";
import type { Db, Sql } from "@erp/db";
import { z } from "zod";
import { can, type Role } from "../auth/permissions.js";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import { date, id, num, parse } from "../validate.js";
import { postEntry } from "./accounting.js";
import { adjustStock, transferStock } from "./inventory.js";
import { createSalesInvoice } from "./sales.js";

/**
 * Writes the AI assistant can propose. A proposal is dry-run inside a
 * transaction that is always rolled back, so the model gets real validation
 * errors and the user sees exact totals, but nothing changes until a user
 * with the right role applies it. Each kind maps to the API path whose
 * permission it needs.
 */

interface ActionKind<T> {
  label: string;
  /** API path this action is equivalent to; the user's role must be allowed to POST it. */
  path: string;
  schema: z.ZodType<T>;
  tool: Anthropic.Beta.BetaTool;
  run(tx: Db, payload: T): Promise<Record<string, unknown>>;
}

const nullable = (schema: Record<string, unknown>) => ({ ...schema, type: [schema.type as string, "null"] });

const salesInvoiceSchema = z.object({
  thirdPartyId: id, warehouseId: id.optional(), metodoPago: z.enum(["PUE", "PPD"]), notes: z.string().optional(),
  lines: z.array(z.object({ productId: id.optional(), description: z.string().optional(), qty: num, unitPrice: num.optional() })).min(1),
});
const salesInvoice: ActionKind<z.infer<typeof salesInvoiceSchema>> = {
  label: "Factura de venta (borrador)",
  path: "/sales-invoices",
  schema: salesInvoiceSchema,
  tool: {
    name: "propose_sales_invoice",
    description:
      "Propone crear una factura de venta en BORRADOR para que el usuario la revise y confirme. No timbra ni envía nada al SAT. " +
      "Busca antes los ids reales con run_sql (ai.third_parties con is_customer, ai.products, ai.warehouses). Si unitPrice es null se usa el precio de lista del producto.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "thirdPartyId", "warehouseId", "metodoPago", "notes", "lines"],
      properties: {
        summary: { type: "string", description: "Qué hará esta acción, en una frase para el usuario" },
        thirdPartyId: { type: "integer", description: "id del cliente" },
        warehouseId: nullable({ type: "integer", description: "id del almacén del que salen los productos" }),
        metodoPago: { type: "string", enum: ["PUE", "PPD"], description: "PUE = pago en una exhibición; PPD = a crédito" },
        notes: nullable({ type: "string" }),
        lines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["productId", "description", "qty", "unitPrice"],
            properties: {
              productId: nullable({ type: "integer" }),
              description: nullable({ type: "string" }),
              qty: { type: "number" },
              unitPrice: nullable({ type: "number", description: "Precio unitario sin IVA" }),
            },
          },
        },
      },
    },
  },
  async run(tx, p) {
    const invoiceId = await createSalesInvoice(tx, p);
    const [inv] = await tx<{ serie: string; total: string; subtotal: string; total_traslados: string; customer: string }[]>`
      SELECT i.serie, i.total, i.subtotal, i.total_traslados, t.name AS customer FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id WHERE i.id = ${invoiceId}`;
    return { salesInvoiceId: invoiceId, customer: inv!.customer, subtotal: inv!.subtotal, iva: inv!.total_traslados, total: inv!.total };
  },
};
const journalEntrySchema = z.object({
  journal: z.enum(["OD", "CO", "PA", "IN"]), date, concept: z.string().min(1),
  lines: z.array(z.object({ accountCode: z.string(), debit: num.optional(), credit: num.optional(), description: z.string().optional() })).min(2),
});
const journalEntry: ActionKind<z.infer<typeof journalEntrySchema>> = {
  label: "Póliza manual",
  path: "/journal-entries",
  schema: journalEntrySchema,
  tool: {
    name: "propose_journal_entry",
    description:
      "Propone registrar una póliza contable manual para que el usuario la confirme. Usa cuentas afectables (postable) de ai.accounts por su código. " +
      "Cargos y abonos deben cuadrar. journal: OD diario, CO compras, PA pagos, IN inventario.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "journal", "date", "concept", "lines"],
      properties: {
        summary: { type: "string" },
        journal: { type: "string", enum: ["OD", "CO", "PA", "IN"] },
        date: { type: "string", description: "YYYY-MM-DD" },
        concept: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["accountCode", "debit", "credit", "description"],
            properties: {
              accountCode: { type: "string" },
              debit: nullable({ type: "number" }),
              credit: nullable({ type: "number" }),
              description: nullable({ type: "string" }),
            },
          },
        },
      },
    },
  },
  async run(tx, p) {
    const lines = [];
    for (const l of p.lines) {
      const [acc] = await tx<{ id: number }[]>`SELECT id FROM accounts WHERE code = ${l.accountCode}`;
      if (!acc) throw badRequest(`La cuenta ${l.accountCode} no existe`);
      lines.push({ ...l, accountId: acc.id });
    }
    const entryId = await postEntry(tx, { journal: p.journal, date: p.date, concept: p.concept, sourceType: "manual", lines });
    const [e] = await tx<{ amount: string }[]>`SELECT sum(debit)::text AS amount FROM journal_lines WHERE entry_id = ${entryId}`;
    return { journalEntryId: entryId, amount: e!.amount };
  },
};

const stockTransferSchema = z.object({ productId: id, fromWarehouseId: id, toWarehouseId: id, qty: num, label: z.string().optional() });
const stockTransfer: ActionKind<z.infer<typeof stockTransferSchema>> = {
  label: "Traspaso entre almacenes",
  path: "/stock/transfers",
  schema: stockTransferSchema,
  tool: {
    name: "propose_stock_transfer",
    description: "Propone traspasar existencias de un producto entre dos almacenes (sin efecto contable). Revisa antes ai.stock_levels.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "productId", "fromWarehouseId", "toWarehouseId", "qty", "label"],
      properties: {
        summary: { type: "string" },
        productId: { type: "integer" },
        fromWarehouseId: { type: "integer" },
        toWarehouseId: { type: "integer" },
        qty: { type: "number" },
        label: nullable({ type: "string" }),
      },
    },
  },
  async run(tx, p) {
    const r = await transferStock(tx, p);
    const [s] = await tx<{ from_qty: string; to_qty: string }[]>`
      SELECT (SELECT qty FROM stock WHERE product_id = ${p.productId} AND warehouse_id = ${p.fromWarehouseId}) AS from_qty,
             (SELECT qty FROM stock WHERE product_id = ${p.productId} AND warehouse_id = ${p.toWarehouseId}) AS to_qty`;
    return { movementOut: r.out, movementIn: r.in, fromQtyAfter: s!.from_qty, toQtyAfter: s!.to_qty };
  },
};

const stockAdjustmentSchema = z.object({ productId: id, warehouseId: id, qty: num, reason: z.string().min(1) });
const stockAdjustment: ActionKind<z.infer<typeof stockAdjustmentSchema>> = {
  label: "Ajuste de inventario",
  path: "/stock/adjustments",
  schema: stockAdjustmentSchema,
  tool: {
    name: "propose_stock_adjustment",
    description: "Propone un ajuste de inventario (merma con qty negativa o sobrante con qty positiva) valuado a costo promedio, con su póliza.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "productId", "warehouseId", "qty", "reason"],
      properties: {
        summary: { type: "string" },
        productId: { type: "integer" },
        warehouseId: { type: "integer" },
        qty: { type: "number", description: "Positiva = entrada, negativa = salida" },
        reason: { type: "string" },
      },
    },
  },
  async run(tx, p) {
    const r = await adjustStock(tx, p);
    return { movementId: r.movementId, value: r.value.toFixed(2), journalEntryId: r.journalEntryId };
  },
};

export const ACTIONS = {
  sales_invoice: salesInvoice,
  journal_entry: journalEntry,
  stock_transfer: stockTransfer,
  stock_adjustment: stockAdjustment,
} as Record<string, ActionKind<any>>;

export type ActionKindCode = keyof typeof ACTIONS;

/** Action kinds the role may apply, for building the assistant's tool list. */
export function allowedActions(role: Role): string[] {
  return Object.entries(ACTIONS).filter(([, a]) => can(role, "POST", a.path)).map(([k]) => k);
}

export function actionForTool(toolName: string): string | undefined {
  return Object.entries(ACTIONS).find(([, a]) => a.tool.name === toolName)?.[0];
}

/** Strict tool schemas use null for "not given"; zod schemas use undefined. */
function dropNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)]));
  return v;
}

class DryRun extends Error {
  constructor(public result: Record<string, unknown>) { super("dry run"); }
}

/** Validate a payload and run it in a transaction that is rolled back; returns the would-be result. */
export async function dryRun(sql: Sql, kind: string, raw: unknown): Promise<{ payload: unknown; preview: Record<string, unknown> }> {
  const action = ACTIONS[kind];
  if (!action) throw badRequest(`Acción desconocida: ${kind}`);
  const { summary: _s, ...rest } = (dropNulls(raw) ?? {}) as Record<string, unknown>;
  const payload = parse(action.schema, rest);
  try {
    await sql.begin(async (tx) => { throw new DryRun(await action.run(tx, payload)); });
  } catch (err) {
    if (err instanceof DryRun) return { payload, preview: err.result };
    throw err;
  }
  throw new Error("unreachable");
}

/** Record a pending proposal after a successful dry run. */
export async function createProposal(sql: Sql, userId: number | undefined, kind: string, raw: { summary?: unknown }) {
  const { payload, preview } = await dryRun(sql, kind, raw);
  const summary = typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : ACTIONS[kind]!.label;
  const [row] = await sql<{ id: number; created_at: string }[]>`
    INSERT INTO ai_proposals (user_id, kind, summary, payload, result)
    VALUES (${userId ?? null}, ${kind}, ${summary}, ${sql.json(payload as never)}, ${sql.json({ preview } as never)})
    RETURNING id, created_at`;
  return { id: row!.id, kind, label: ACTIONS[kind]!.label, summary, payload, preview, status: "pending" as const, createdAt: row!.created_at };
}

/** Apply a pending proposal as the deciding user, re-checking their permission. */
export async function applyProposal(sql: Sql, proposalId: number, user: { id: number; role: Role }) {
  return sql.begin(async (tx) => {
    const [p] = await tx<{ id: number; user_id: number | null; kind: string; payload: unknown; status: string }[]>`
      SELECT * FROM ai_proposals WHERE id = ${proposalId} FOR UPDATE`;
    if (!p) throw notFound("Propuesta");
    if (p.user_id !== user.id && user.role !== "admin") throw new AppError(403, "Sólo quien hizo la pregunta puede aplicar esta propuesta");
    if (p.status !== "pending") throw conflict("Esta propuesta ya se resolvió");
    const action = ACTIONS[p.kind];
    if (!action) throw badRequest(`Acción desconocida: ${p.kind}`);
    if (!can(user.role, "POST", action.path)) throw new AppError(403, "Tu rol no tiene permiso para esta acción");
    const result = await action.run(tx, parse(action.schema, p.payload));
    await tx`UPDATE ai_proposals SET status = 'applied', result = ${tx.json(result as never)}, decided_at = now(), decided_by = ${user.id} WHERE id = ${p.id}`;
    return { id: p.id, status: "applied" as const, result };
  });
}

export async function rejectProposal(sql: Sql, proposalId: number, user: { id: number; role: Role }) {
  const [p] = await sql<{ user_id: number | null; status: string }[]>`SELECT user_id, status FROM ai_proposals WHERE id = ${proposalId}`;
  if (!p) throw notFound("Propuesta");
  if (p.user_id !== user.id && user.role !== "admin") throw new AppError(403, "Sólo quien hizo la pregunta puede descartar esta propuesta");
  if (p.status !== "pending") throw conflict("Esta propuesta ya se resolvió");
  await sql`UPDATE ai_proposals SET status = 'rejected', decided_at = now(), decided_by = ${user.id} WHERE id = ${proposalId}`;
  return { id: proposalId, status: "rejected" as const };
}
