import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { badRequest } from "../errors.js";
import { incomeStatement, ledger, postEntry, trialBalance } from "../services/accounting.js";
import { balanzaXml, catalogoXml, polizasXml } from "../services/sat.js";
import { isrProvisionalReport, ivaReport } from "../services/tax.js";
import { date, idParam, num, parse, period } from "../validate.js";

export async function accountingRoutes(app: FastifyInstance, { sql }: AppContext) {
  app.get("/accounts", async () => sql`
    SELECT a.*, p.code AS parent_code, s.description AS sat_description
    FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id JOIN sat_codigo_agrupador s ON s.code = a.sat_code ORDER BY a.code`);

  app.post("/accounts", async (req, reply) => {
    const b = parse(z.object({ code: z.string().min(1), name: z.string().min(1), parentCode: z.string(), satCode: z.string().optional() }), req.body);
    const [parent] = await sql<{ id: number; level: number; nature: string; kind: string; sat_code: string }[]>`SELECT * FROM accounts WHERE code = ${b.parentCode}`;
    if (!parent) throw badRequest("La cuenta padre no existe");
    const row = await sql.begin(async (tx) => {
      // A parent that gets subaccounts stops receiving postings, unless it already has movements.
      const [used] = await tx`SELECT 1 FROM journal_lines WHERE account_id = ${parent.id} LIMIT 1`;
      if (used) throw badRequest("La cuenta padre ya tiene movimientos; no puede tener subcuentas");
      await tx`UPDATE accounts SET postable = false WHERE id = ${parent.id}`;
      const [r] = await tx`
        INSERT INTO accounts (code, name, parent_id, level, nature, kind, sat_code, postable)
        VALUES (${b.code}, ${b.name}, ${parent.id}, ${parent.level + 1}, ${parent.nature}, ${parent.kind}, ${b.satCode ?? parent.sat_code}, true)
        RETURNING *`;
      return r;
    });
    return reply.code(201).send(row);
  });

  app.get("/account-settings", async () => sql`SELECT s.key, s.description, a.code, a.name FROM account_settings s JOIN accounts a ON a.id = s.account_id ORDER BY s.key`);
  app.put("/account-settings/:key", async (req) => {
    const { key } = parse(z.object({ key: z.string() }), req.params);
    const { code } = parse(z.object({ code: z.string() }), req.body);
    const [r] = await sql`UPDATE account_settings SET account_id = (SELECT id FROM accounts WHERE code = ${code} AND postable) WHERE key = ${key} RETURNING key`;
    if (!r) throw badRequest("Clave o cuenta inválida");
    return { ok: true };
  });

  app.get("/journal-entries", async (req) => {
    const q = parse(z.object({ from: date.optional(), to: date.optional(), journal: z.string().optional(), limit: z.coerce.number().int().max(1000).default(100) }), req.query);
    const entries = await sql`
      SELECT e.*, (SELECT sum(debit) FROM journal_lines WHERE entry_id = e.id) AS amount
      FROM journal_entries e
      WHERE true ${q.from ? sql`AND e.entry_date >= ${q.from}` : sql``} ${q.to ? sql`AND e.entry_date <= ${q.to}` : sql``}
      ${q.journal ? sql`AND e.journal_code = ${q.journal}` : sql``}
      ORDER BY e.entry_date DESC, e.id DESC LIMIT ${q.limit}`;
    return entries;
  });
  app.get("/journal-entries/:id", async (req) => {
    const { id: entryId } = parse(idParam, req.params);
    const [entry] = await sql`SELECT * FROM journal_entries WHERE id = ${entryId}`;
    const lines = await sql`SELECT l.*, a.code, a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ${entryId} ORDER BY l.line_no`;
    return { ...entry, lines };
  });
  app.post("/journal-entries", async (req, reply) => {
    const b = parse(z.object({
      journal: z.enum(["OD", "CO", "PA", "IN"]).default("OD"), date, concept: z.string().min(1),
      lines: z.array(z.object({ accountCode: z.string(), debit: num.optional(), credit: num.optional(), description: z.string().optional(), cfdiUuid: z.string().optional(), rfc: z.string().optional() })).min(2),
    }), req.body);
    const entryId = await sql.begin(async (tx) => {
      const lines = [];
      for (const l of b.lines) {
        const [acc] = await tx<{ id: number }[]>`SELECT id FROM accounts WHERE code = ${l.accountCode}`;
        if (!acc) throw badRequest(`La cuenta ${l.accountCode} no existe`);
        lines.push({ ...l, accountId: acc.id });
      }
      return postEntry(tx, { journal: b.journal, date: b.date, concept: b.concept, sourceType: "manual", lines });
    });
    return reply.code(201).send({ id: entryId });
  });

  app.get("/reports/trial-balance", async (req) => {
    const { year, month } = parse(period, req.query);
    const rows = await trialBalance(sql, year, month);
    return rows.map((r) => ({ ...r, saldoIni: r.saldoIni.toFixed(2), debe: r.debe.toFixed(2), haber: r.haber.toFixed(2), saldoFin: r.saldoFin.toFixed(2) }));
  });
  app.get("/reports/ledger", async (req) => {
    const q = parse(z.object({ account: z.string(), from: date, to: date }), req.query);
    return ledger(sql, q.account, q.from, q.to);
  });
  app.get("/reports/income-statement", async (req) => {
    const q = parse(z.object({ from: date, to: date }), req.query);
    return incomeStatement(sql, q.from, q.to);
  });
  app.get("/reports/iva", async (req) => {
    const q = parse(period.extend({ saldoAFavorAnterior: num.optional() }), req.query);
    return ivaReport(sql, q.year, q.month, q.saldoAFavorAnterior === undefined ? "0" : String(q.saldoAFavorAnterior));
  });
  app.get("/reports/isr-provisional", async (req) => {
    const q = parse(period.extend({ coeficienteUtilidad: num, pagosProvisionalesAnteriores: num.optional(), perdidasFiscales: num.optional(), ptuPagada: num.optional() }), req.query);
    const s = (v: unknown) => (v === undefined ? undefined : String(v));
    return isrProvisionalReport(sql, q.year, q.month, {
      coeficienteUtilidad: String(q.coeficienteUtilidad), pagosProvisionalesAnteriores: s(q.pagosProvisionalesAnteriores),
      perdidasFiscales: s(q.perdidasFiscales), ptuPagada: s(q.ptuPagada),
    });
  });

  app.get("/periods", async () => sql`SELECT * FROM fiscal_periods ORDER BY year DESC, month DESC`);
  app.post("/periods/:year/:month/close", async (req) => {
    const { year, month } = parse(period, req.params);
    await sql`INSERT INTO fiscal_periods (year, month, status, closed_at) VALUES (${year}, ${month}, 'closed', now())
              ON CONFLICT (year, month) DO UPDATE SET status = 'closed', closed_at = now()`;
    return { year, month, status: "closed" };
  });
  app.post("/periods/:year/:month/reopen", async (req) => {
    const { year, month } = parse(period, req.params);
    await sql`UPDATE fiscal_periods SET status = 'open', closed_at = null WHERE year = ${year} AND month = ${month}`;
    return { year, month, status: "open" };
  });

  // Contabilidad electrónica (Anexo 24) downloads.
  const sendXml = (reply: { header: (k: string, v: string) => unknown; send: (b: string) => unknown }, name: string, xml: string) => {
    reply.header("content-type", "application/xml; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${name}"`);
    return reply.send(xml);
  };
  const fileName = async (year: number, month: number, suffix: string) => {
    const [c] = await sql<{ rfc: string }[]>`SELECT rfc FROM company WHERE id = 1`;
    return `${c?.rfc ?? "RFC"}${year}${String(month).padStart(2, "0")}${suffix}.xml`;
  };
  app.get("/sat/electronic-accounting/catalogo", async (req, reply) => {
    const { year, month } = parse(period, req.query);
    return sendXml(reply, await fileName(year, month, "CT"), await catalogoXml(sql, year, month));
  });
  app.get("/sat/electronic-accounting/balanza", async (req, reply) => {
    const q = parse(period.extend({ tipoEnvio: z.enum(["N", "C"]).default("N"), fechaModBal: date.optional() }), req.query);
    return sendXml(reply, await fileName(q.year, q.month, `B${q.tipoEnvio}`), await balanzaXml(sql, q.year, q.month, q.tipoEnvio, q.fechaModBal));
  });
  app.get("/sat/electronic-accounting/polizas", async (req, reply) => {
    const q = parse(period.extend({ tipoSolicitud: z.enum(["AF", "FC", "DE", "CO"]), numOrden: z.string().optional(), numTramite: z.string().optional() }), req.query);
    return sendXml(reply, await fileName(q.year, q.month, "PL"), await polizasXml(sql, q.year, q.month, q));
  });

  app.get("/dashboard", async () => {
    const [row] = await sql`
      SELECT
        (SELECT coalesce(sum(subtotal - discount), 0) FROM sales_invoices WHERE status = 'stamped' AND issue_date >= date_trunc('month', localtimestamp)) AS sales_this_month,
        (SELECT coalesce(sum(total - paid_amount), 0) FROM sales_invoices WHERE status = 'stamped') AS receivables,
        (SELECT coalesce(sum(total - paid_amount), 0) FROM supplier_invoices WHERE status = 'validated') AS payables,
        (SELECT coalesce(sum(s.qty * p.avg_cost), 0)::numeric(18,2) FROM stock s JOIN products p ON p.id = s.product_id) AS inventory_value,
        (SELECT count(*)::int FROM stock s JOIN products p ON p.id = s.product_id WHERE s.qty < p.min_stock) AS low_stock_items,
        (SELECT count(*)::int FROM sales_invoices WHERE status = 'draft') AS draft_invoices`;
    const topProducts = await sql`
      SELECT p.sku, p.name, sum(l.qty) AS qty, sum(l.base) AS sales
      FROM sales_invoice_lines l JOIN sales_invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
      WHERE i.status = 'stamped' AND i.issue_date >= localtimestamp - interval '90 days'
      GROUP BY p.sku, p.name ORDER BY sales DESC LIMIT 5`;
    return { ...row, topProducts };
  });

}
