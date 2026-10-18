import type Anthropic from "@anthropic-ai/sdk";
import type { Db, Sql } from "@erp/db";
import type { MessagesApi } from "../ai/agent.js";

/**
 * The auditor: deterministic SQL checks over the books, run on a schedule or
 * on demand. Each problem becomes a finding with a stable fingerprint so
 * re-runs update it instead of duplicating it; findings that stop showing up
 * are marked resolved. Claude then writes a short prioritized summary.
 */

export type Severity = "high" | "medium" | "low";

export interface Finding {
  fingerprint: string;
  check: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
}

const money = (v: string | number) => `$${Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Check {
  code: string;
  label: string;
  run(db: Db): Promise<Finding[]>;
}

export const CHECKS: Check[] = [
  {
    code: "duplicate_supplier_invoice",
    label: "Facturas de proveedor duplicadas",
    async run(db) {
      const rows = await db<{ a: number; b: number; supplier: string; total: string; a_date: string; b_date: string; same_ref: boolean }[]>`
        SELECT a.id AS a, b.id AS b, t.name AS supplier, a.total, a.issue_date::text AS a_date, b.issue_date::text AS b_date,
               coalesce(a.supplier_ref = b.supplier_ref, false) AS same_ref
        FROM supplier_invoices a
        JOIN supplier_invoices b ON b.third_party_id = a.third_party_id AND b.id > a.id AND b.status <> 'cancelled'
        JOIN third_parties t ON t.id = a.third_party_id
        WHERE a.status <> 'cancelled'
          AND ((a.total = b.total AND abs(a.issue_date - b.issue_date) <= 10) OR (a.supplier_ref IS NOT NULL AND a.supplier_ref = b.supplier_ref))`;
      return rows.map((r) => ({
        fingerprint: `duplicate_supplier_invoice:${r.a}:${r.b}`, check: "duplicate_supplier_invoice", severity: "high",
        title: `Posible factura duplicada de ${r.supplier}`,
        detail: r.same_ref
          ? `Las facturas de proveedor #${r.a} y #${r.b} tienen la misma referencia del proveedor.`
          : `Las facturas #${r.a} (${r.a_date}) y #${r.b} (${r.b_date}) son por el mismo total, ${money(r.total)}, con pocos días de diferencia.`,
        evidence: { supplierInvoiceIds: [r.a, r.b], total: r.total },
      }));
    },
  },
  {
    code: "supplier_69b",
    label: "Proveedores en la lista 69-B del SAT",
    async run(db) {
      const rows = await db<{ id: number; name: string; rfc: string; situacion: string; invoices: number; total: string }[]>`
        SELECT t.id, t.name, t.rfc, l.situacion, count(s.id)::int AS invoices, coalesce(sum(s.total), 0)::text AS total
        FROM third_parties t JOIN sat_69b l ON l.rfc = upper(t.rfc)
        LEFT JOIN supplier_invoices s ON s.third_party_id = t.id AND s.status <> 'cancelled'
        WHERE t.is_supplier AND l.situacion !~* '(desvirtuado|favorable)'
        GROUP BY t.id, t.name, t.rfc, l.situacion`;
      return rows.map((r) => ({
        fingerprint: `supplier_69b:${r.id}`, check: "supplier_69b", severity: /definitivo/i.test(r.situacion) ? "high" : "medium",
        title: `${r.name} está en la lista 69-B (${r.situacion})`,
        detail: `El SAT presume que ${r.rfc} factura operaciones simuladas. Hay ${r.invoices} factura(s) suya(s) por ${money(r.total)}; sus deducciones e IVA acreditable están en riesgo.`,
        evidence: { thirdPartyId: r.id, rfc: r.rfc, situacion: r.situacion, invoices: r.invoices, total: r.total },
      }));
    },
  },
  {
    code: "sale_below_cost",
    label: "Ventas por debajo del costo",
    async run(db) {
      const rows = await db<{ invoice_id: number; number: string; sku: string; description: string; base: string; cost: string }[]>`
        SELECT i.id AS invoice_id, i.serie || '-' || i.folio AS number, p.sku, l.description, l.base::text, round(l.qty * l.unit_cost, 2)::text AS cost
        FROM sales_invoice_lines l JOIN sales_invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
        WHERE i.status = 'stamped' AND l.unit_cost IS NOT NULL AND l.base < round(l.qty * l.unit_cost, 2)
          AND i.issue_date >= current_date - 90`;
      return rows.map((r) => ({
        fingerprint: `sale_below_cost:${r.invoice_id}:${r.sku}`, check: "sale_below_cost", severity: "medium",
        title: `Venta bajo costo: ${r.sku} en la factura ${r.number}`,
        detail: `Se vendió "${r.description}" en ${money(r.base)} sin IVA y su costo fue ${money(r.cost)}.`,
        evidence: { salesInvoiceId: r.invoice_id, sku: r.sku, base: r.base, cost: r.cost },
      }));
    },
  },
  {
    code: "purchase_price_spike",
    label: "Compras muy por encima del precio habitual",
    async run(db) {
      const rows = await db<{ invoice_id: number; supplier: string; sku: string; unit_price: string; avg_price: string }[]>`
        WITH lines AS (
          SELECT l.invoice_id, l.product_id, l.unit_price, s.issue_date, s.id, t.name AS supplier
          FROM supplier_invoice_lines l JOIN supplier_invoices s ON s.id = l.invoice_id JOIN third_parties t ON t.id = s.third_party_id
          WHERE s.status = 'validated' AND l.product_id IS NOT NULL)
        SELECT x.invoice_id, x.supplier, p.sku, x.unit_price::text, round(avg(h.unit_price), 2)::text AS avg_price
        FROM lines x JOIN products p ON p.id = x.product_id
        JOIN lines h ON h.product_id = x.product_id AND (h.issue_date, h.id) < (x.issue_date, x.id)
        WHERE x.issue_date >= current_date - 90
        GROUP BY x.invoice_id, x.supplier, p.sku, x.unit_price
        HAVING count(*) >= 2 AND x.unit_price > 1.3 * avg(h.unit_price)`;
      return rows.map((r) => ({
        fingerprint: `purchase_price_spike:${r.invoice_id}:${r.sku}`, check: "purchase_price_spike", severity: "medium",
        title: `${r.sku} comprado ${Math.round((Number(r.unit_price) / Number(r.avg_price) - 1) * 100)}% más caro`,
        detail: `La factura de proveedor #${r.invoice_id} de ${r.supplier} pagó ${money(r.unit_price)} por unidad; el promedio de compras anteriores es ${money(r.avg_price)}.`,
        evidence: { supplierInvoiceId: r.invoice_id, sku: r.sku, unitPrice: r.unit_price, averagePrice: r.avg_price },
      }));
    },
  },
  {
    code: "negative_stock",
    label: "Existencias negativas",
    async run(db) {
      const rows = await db<{ product_id: number; warehouse_id: number; sku: string; warehouse: string; qty: string }[]>`
        SELECT s.product_id, s.warehouse_id, p.sku, w.code AS warehouse, s.qty::text
        FROM stock s JOIN products p ON p.id = s.product_id JOIN warehouses w ON w.id = s.warehouse_id WHERE s.qty < 0`;
      return rows.map((r) => ({
        fingerprint: `negative_stock:${r.product_id}:${r.warehouse_id}`, check: "negative_stock", severity: "high",
        title: `Existencia negativa de ${r.sku} en ${r.warehouse}`,
        detail: `El kárdex muestra ${Number(r.qty)} unidades; falta registrar una entrada o hubo una salida de más.`,
        evidence: { productId: r.product_id, warehouseId: r.warehouse_id, qty: r.qty },
      }));
    },
  },
  {
    code: "overdue_receivable",
    label: "Cobranza vencida",
    async run(db) {
      const rows = await db<{ id: number; name: string; invoices: number; balance: string; oldest: string; days: number }[]>`
        SELECT t.id, t.name, count(*)::int AS invoices, sum(i.total - i.paid_amount)::text AS balance, min(i.issue_date)::date::text AS oldest,
               max(current_date - (i.issue_date::date + t.credit_days))::int AS days
        FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id
        WHERE i.status = 'stamped' AND i.total - i.paid_amount > 0.005 AND current_date - (i.issue_date::date + t.credit_days) > 30
        GROUP BY t.id, t.name`;
      return rows.map((r) => ({
        fingerprint: `overdue_receivable:${r.id}`, check: "overdue_receivable", severity: r.days > 90 ? "high" : "medium",
        title: `${r.name} debe ${money(r.balance)} vencidos`,
        detail: `${r.invoices} factura(s) con más de 30 días de vencidas; la más antigua es del ${r.oldest} (${r.days} días después del plazo).`,
        evidence: { thirdPartyId: r.id, invoices: r.invoices, balance: r.balance, oldest: r.oldest, daysOverdue: r.days },
      }));
    },
  },
  {
    code: "missing_cfdi_uuid",
    label: "Compras sin folio fiscal",
    async run(db) {
      const rows = await db<{ n: number; total: string; iva: string }[]>`
        SELECT count(*)::int AS n, coalesce(sum(total), 0)::text AS total, coalesce(sum(iva), 0)::text AS iva
        FROM supplier_invoices WHERE status = 'validated' AND uuid IS NULL AND iva > 0 AND issue_date >= current_date - 90`;
      const r = rows[0]!;
      return r.n === 0 ? [] : [{
        fingerprint: "missing_cfdi_uuid", check: "missing_cfdi_uuid", severity: "medium",
        title: `${r.n} compra(s) con IVA sin UUID de CFDI`,
        detail: `Suman ${money(r.total)} con ${money(r.iva)} de IVA que no es acreditable sin el CFDI del proveedor.`,
        evidence: { count: r.n, total: r.total, iva: r.iva },
      }];
    },
  },
  {
    code: "stale_drafts",
    label: "Facturas en borrador olvidadas",
    async run(db) {
      const rows = await db<{ ids: number[]; total: string }[]>`
        SELECT array_agg(id ORDER BY id) AS ids, coalesce(sum(total), 0)::text AS total
        FROM sales_invoices WHERE status = 'draft' AND issue_date < now() - interval '15 days'`;
      const r = rows[0]!;
      return !r.ids?.length ? [] : [{
        fingerprint: "stale_drafts", check: "stale_drafts", severity: "low",
        title: `${r.ids.length} factura(s) de venta en borrador desde hace más de 15 días`,
        detail: `Suman ${money(r.total)}. Timbra o elimina los borradores para que no se queden ventas sin facturar.`,
        evidence: { salesInvoiceIds: r.ids, total: r.total },
      }];
    },
  },
  {
    code: "below_min_stock",
    label: "Productos bajo el mínimo",
    async run(db) {
      const rows = await db<{ id: number; sku: string; name: string; qty: string; min_stock: string }[]>`
        SELECT p.id, p.sku, p.name, coalesce(sum(s.qty), 0)::text AS qty, p.min_stock::text
        FROM products p LEFT JOIN stock s ON s.product_id = p.id
        WHERE p.active AND p.type = 'product' AND p.min_stock > 0
        GROUP BY p.id HAVING coalesce(sum(s.qty), 0) < p.min_stock`;
      return rows.map((r) => ({
        fingerprint: `below_min_stock:${r.id}`, check: "below_min_stock", severity: "low",
        title: `${r.sku} está bajo su mínimo`,
        detail: `${r.name}: hay ${Number(r.qty)} y el mínimo es ${Number(r.min_stock)}.`,
        evidence: { productId: r.id, qty: r.qty, minStock: r.min_stock },
      }));
    },
  },
];

export async function collectFindings(db: Db): Promise<Finding[]> {
  return (await Promise.all(CHECKS.map((c) => c.run(db)))).flat();
}

const SUMMARY_SYSTEM = `Eres el auditor interno de una empresa mexicana. Recibes los hallazgos abiertos de las revisiones automáticas del ERP en JSON.
Escribe un resumen ejecutivo en español, en Markdown, de no más de 150 palabras: primero lo que hay que atender hoy y por qué (riesgo fiscal, dinero en juego), luego lo demás agrupado. Usa sólo los datos recibidos; no inventes cifras.`;

async function summarize(messages: MessagesApi, model: string, findings: Finding[]): Promise<string | null> {
  if (!findings.length) return "Sin hallazgos abiertos. Los libros pasaron todas las revisiones.";
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  const top = [...findings].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 40)
    .map(({ check, severity, title, detail }) => ({ check, severity, title, detail }));
  const response = await messages.create({
    model,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: JSON.stringify({ total: findings.length, hallazgos: top }) }],
  });
  if (response.stop_reason === "refusal") return null;
  return response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || null;
}

/** Arbitrary key for pg_try_advisory_lock so two API instances don't audit at once. */
const AUDIT_LOCK = 72_011_069;

export async function runAudit(
  deps: { sql: Sql; messages?: MessagesApi; model: string },
  trigger: "manual" | "schedule" = "manual",
): Promise<{ runId: number; findings: number; newFindings: number; resolved: number; summary: string | null } | null> {
  const { sql } = deps;
  const reserved = await sql.reserve();
  try {
    const [{ locked }] = (await reserved`SELECT pg_try_advisory_lock(${AUDIT_LOCK}) AS locked`) as unknown as [{ locked: boolean }];
    if (!locked) return null;
    const [run] = await sql<{ id: number }[]>`INSERT INTO audit_runs (trigger) VALUES (${trigger}) RETURNING id`;
    const runId = run!.id;
    try {
      const findings = await collectFindings(sql);
      const { newFindings, resolved } = await sql.begin(async (tx) => {
        let fresh = 0;
        for (const f of findings) {
          const [row] = await tx<{ inserted: boolean }[]>`
            INSERT INTO audit_findings (fingerprint, check_code, severity, title, detail, evidence, first_run_id, last_run_id)
            VALUES (${f.fingerprint}, ${f.check}, ${f.severity}, ${f.title}, ${f.detail}, ${tx.json(f.evidence as never)}, ${runId}, ${runId})
            ON CONFLICT (fingerprint) DO UPDATE SET
              severity = excluded.severity, title = excluded.title, detail = excluded.detail, evidence = excluded.evidence,
              last_run_id = excluded.last_run_id, last_seen = now(),
              status = CASE WHEN audit_findings.status = 'resolved' THEN 'open' ELSE audit_findings.status END
            RETURNING (xmax = 0) AS inserted`;
          if (row!.inserted) fresh++;
        }
        const gone = await tx`UPDATE audit_findings SET status = 'resolved' WHERE status = 'open' AND last_run_id IS DISTINCT FROM ${runId} RETURNING id`;
        return { newFindings: fresh, resolved: gone.length };
      });
      const open = await sql<Finding[]>`
        SELECT fingerprint, check_code AS check, severity, title, detail, evidence FROM audit_findings WHERE status = 'open'`;
      let summary: string | null = null;
      if (deps.messages) {
        summary = await summarize(deps.messages, deps.model, open).catch((err) => `No se pudo generar el resumen: ${(err as Error).message}`);
      }
      await sql`UPDATE audit_runs SET finished_at = now(), findings = ${open.length}, new_findings = ${newFindings}, summary = ${summary},
                model = ${deps.messages ? deps.model : null} WHERE id = ${runId}`;
      return { runId, findings: open.length, newFindings, resolved, summary };
    } catch (err) {
      await sql`UPDATE audit_runs SET finished_at = now(), error = ${(err as Error).message} WHERE id = ${runId}`;
      throw err;
    }
  } finally {
    await reserved`SELECT pg_advisory_unlock(${AUDIT_LOCK})`.catch(() => undefined);
    reserved.release();
  }
}

/** Run the auditor every `hours` (first run shortly after start). Returns a stop function. */
export function scheduleAudits(deps: { sql: Sql; messages?: MessagesApi; model: string }, hours: number, log: (msg: string, err?: unknown) => void) {
  if (!(hours > 0)) return () => undefined;
  const tick = () => runAudit(deps, "schedule")
    .then((r) => r && log(`audit run ${r.runId}: ${r.findings} open finding(s), ${r.newFindings} new`))
    .catch((err) => log("audit run failed", err));
  const first = setTimeout(tick, 60_000);
  const every = setInterval(tick, hours * 3_600_000);
  first.unref();
  every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
