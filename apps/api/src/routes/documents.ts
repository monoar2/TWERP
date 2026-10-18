import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { notFound } from "../errors.js";
import { registerCustomerPayment, registerSupplierPayment } from "../services/payments.js";
import { createSupplierInvoice, validateSupplierInvoice } from "../services/purchases.js";
import { cancelSalesInvoice, createSalesInvoice, issueSalesInvoice } from "../services/sales.js";
import { date, id, idParam, num, parse } from "../validate.js";

export const salesLine = z.object({
  productId: id.optional(),
  description: z.string().optional(),
  qty: num,
  unitPrice: num.optional(),
  discount: num.optional(),
  objetoImp: z.string().optional(),
  ivaFactor: z.enum(["Tasa", "Exento"]).optional(),
  ivaRate: num.optional(),
  retIvaRate: num.optional(),
  retIsrRate: num.optional(),
  claveProdServ: z.string().optional(),
  claveUnidad: z.string().optional(),
  unitName: z.string().optional(),
});

export const supplierLine = z.object({
  productId: id.optional(),
  accountId: id.optional(),
  description: z.string().optional(),
  qty: num,
  unitPrice: num,
  discount: num.optional(),
  ivaRate: num.optional(),
  retIvaRate: num.optional(),
  retIsrRate: num.optional(),
});

const paymentSchema = z.object({ bankAccountId: id, amount: num, paidOn: date.optional(), formaPago: z.string().optional(), reference: z.string().optional() });

/** Customer invoices (CFDI), supplier invoices and payments. */
export async function documentRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sql } = ctx;
  app.get("/sales-invoices", async (req) => {
    const q = parse(z.object({ status: z.string().optional(), customerId: id.optional(), limit: z.coerce.number().int().max(500).default(100) }), req.query);
    return sql`
      SELECT i.id, i.serie, i.folio, i.issue_date, i.status, i.metodo_pago, i.subtotal, i.total_traslados, i.total_retenciones, i.total,
             i.paid_amount, i.uuid, t.name AS customer_name, t.rfc AS customer_rfc
      FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id
      WHERE true ${q.status ? sql`AND i.status = ${q.status}` : sql``} ${q.customerId ? sql`AND i.third_party_id = ${q.customerId}` : sql``}
      ORDER BY i.id DESC LIMIT ${q.limit}`;
  });
  app.get("/sales-invoices/:id", async (req) => {
    const { id: invId } = parse(idParam, req.params);
    const [inv] = await sql`SELECT i.*, t.name AS customer_name, t.rfc AS customer_rfc FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id WHERE i.id = ${invId}`;
    if (!inv) throw notFound("Factura");
    const lines = await sql`SELECT * FROM sales_invoice_lines WHERE invoice_id = ${invId} ORDER BY line_no`;
    const payments = await sql`SELECT * FROM payments WHERE sales_invoice_id = ${invId} ORDER BY paid_on`;
    const { xml: _xml, ...rest } = inv;
    return { ...rest, hasXml: !!inv.xml, lines, payments };
  });
  app.get("/sales-invoices/:id/xml", async (req, reply) => {
    const { id: invId } = parse(idParam, req.params);
    const [inv] = await sql<{ xml: string | null; serie: string; folio: number }[]>`SELECT xml, serie, folio FROM sales_invoices WHERE id = ${invId}`;
    if (!inv?.xml) throw notFound("XML de la factura");
    return reply.header("content-type", "application/xml; charset=utf-8")
      .header("content-disposition", `attachment; filename="${inv.serie}-${inv.folio}.xml"`).send(inv.xml);
  });
  app.post("/sales-invoices", async (req, reply) => {
    const b = parse(z.object({
      thirdPartyId: id, warehouseId: id.optional(), usoCfdi: z.string().optional(), metodoPago: z.enum(["PUE", "PPD"]).default("PUE"),
      formaPago: z.string().optional(), issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/).optional(), notes: z.string().optional(),
      lines: z.array(salesLine).min(1),
    }), req.body);
    const invId = await sql.begin((tx) => createSalesInvoice(tx, { ...b, issueDate: b.issueDate?.replace("T", " ") }));
    return reply.code(201).send({ id: invId });
  });
  app.post("/sales-invoices/:id/issue", async (req) => {
    const { id: invId } = parse(idParam, req.params);
    return sql.begin((tx) => issueSalesInvoice(tx, invId, ctx));
  });
  app.post("/sales-invoices/:id/cancel", async (req) => {
    const { id: invId } = parse(idParam, req.params);
    const b = parse(z.object({ motivo: z.enum(["01", "02", "03", "04"]).default("02"), folioSustitucion: z.string().optional() }), req.body ?? {});
    return sql.begin((tx) => cancelSalesInvoice(tx, invId, ctx, b.motivo, b.folioSustitucion));
  });
  app.post("/sales-invoices/:id/payments", async (req, reply) => {
    const { id: invId } = parse(idParam, req.params);
    const b = parse(paymentSchema, req.body);
    return reply.code(201).send(await sql.begin((tx) => registerCustomerPayment(tx, { ...b, invoiceId: invId })));
  });

  app.get("/supplier-invoices", async () => sql`
    SELECT s.*, t.name AS supplier_name, t.rfc AS supplier_rfc FROM supplier_invoices s JOIN third_parties t ON t.id = s.third_party_id ORDER BY s.id DESC LIMIT 200`);
  app.get("/supplier-invoices/:id", async (req) => {
    const { id: invId } = parse(idParam, req.params);
    const [inv] = await sql`SELECT s.*, t.name AS supplier_name FROM supplier_invoices s JOIN third_parties t ON t.id = s.third_party_id WHERE s.id = ${invId}`;
    if (!inv) throw notFound("Factura de proveedor");
    const lines = await sql`SELECT * FROM supplier_invoice_lines WHERE invoice_id = ${invId} ORDER BY line_no`;
    return { ...inv, lines };
  });
  app.post("/supplier-invoices", async (req, reply) => {
    const b = parse(z.object({
      thirdPartyId: id, warehouseId: id.optional(), supplierRef: z.string().optional(), uuid: z.string().optional(), issueDate: date.optional(),
      metodoPago: z.enum(["PUE", "PPD"]).optional(), lines: z.array(supplierLine).min(1),
    }), req.body);
    return reply.code(201).send({ id: await sql.begin((tx) => createSupplierInvoice(tx, b)) });
  });
  app.post("/supplier-invoices/:id/validate", async (req) => {
    const { id: invId } = parse(idParam, req.params);
    return sql.begin((tx) => validateSupplierInvoice(tx, invId));
  });
  app.post("/supplier-invoices/:id/payments", async (req, reply) => {
    const { id: invId } = parse(idParam, req.params);
    const b = parse(paymentSchema, req.body);
    return reply.code(201).send(await sql.begin((tx) => registerSupplierPayment(tx, { ...b, invoiceId: invId })));
  });
}
