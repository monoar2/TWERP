import { buildCfdiXml, computeLine, D, Decimal, IMPUESTOS, round2, validateCfdi, type CfdiConcepto, type CfdiInput, type TaxSpec } from "@erp/mx";
import type { Db } from "@erp/db";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import { accountFor, postEntry, reverseEntry, type EntryLineInput } from "./accounting.js";
import { moveStock } from "./inventory.js";
import { nextSequence } from "./sequences.js";
import type { PacProvider } from "./pac.js";

export interface SalesLineInput {
  productId?: number;
  description?: string;
  qty: string | number;
  unitPrice?: string | number;
  discount?: string | number;
  objetoImp?: string;
  ivaFactor?: "Tasa" | "Exento";
  ivaRate?: string | number;
  retIvaRate?: string | number;
  retIsrRate?: string | number;
  claveProdServ?: string;
  claveUnidad?: string;
  unitName?: string;
}

export interface SalesInvoiceInput {
  thirdPartyId: number;
  warehouseId?: number;
  usoCfdi?: string;
  metodoPago: "PUE" | "PPD";
  formaPago?: string;
  issueDate?: string;
  notes?: string;
  lines: SalesLineInput[];
}

type LineRow = {
  id: number; product_id: number | null; product_type: string | null; description: string; clave_prod_serv: string; clave_unidad: string;
  unit_name: string | null; qty: string; unit_price: string; discount: string; objeto_imp: string; iva_factor: "Tasa" | "Exento";
  iva_rate: string; ret_iva_rate: string; ret_isr_rate: string; sku: string | null;
};

function lineTaxes(l: Pick<LineRow, "objeto_imp" | "iva_factor" | "iva_rate" | "ret_iva_rate" | "ret_isr_rate">) {
  const traslados: TaxSpec[] = [{ impuesto: IMPUESTOS.IVA, tipoFactor: l.iva_factor, rate: l.iva_factor === "Exento" ? undefined : D(l.iva_rate).toFixed(6) }];
  const retenciones: Array<{ impuesto: "001" | "002"; rate: string }> = [];
  if (D(l.ret_iva_rate).gt(0)) retenciones.push({ impuesto: IMPUESTOS.IVA, rate: D(l.ret_iva_rate).toFixed(6) });
  if (D(l.ret_isr_rate).gt(0)) retenciones.push({ impuesto: IMPUESTOS.ISR, rate: D(l.ret_isr_rate).toFixed(6) });
  return l.objeto_imp === "02" ? { traslados, retenciones } : { traslados: [], retenciones: [] };
}

/** Create a draft invoice. Product defaults (SAT keys, price, IVA) fill missing line fields. */
export async function createSalesInvoice(tx: Db, input: SalesInvoiceInput): Promise<number> {
  if (!input.lines.length) throw badRequest("La factura requiere al menos un concepto");
  const [party] = await tx<{ id: number; uso_cfdi: string; is_customer: boolean }[]>`
    SELECT id, uso_cfdi, is_customer FROM third_parties WHERE id = ${input.thirdPartyId}`;
  if (!party) throw notFound("Cliente");
  if (!party.is_customer) throw badRequest("El tercero no está marcado como cliente");
  const [company] = await tx<{ invoice_serie: string }[]>`SELECT invoice_serie FROM company WHERE id = 1`;
  if (!company) throw badRequest("Configura los datos fiscales de la empresa antes de facturar");

  const formaPago = input.metodoPago === "PPD" ? "99" : input.formaPago ?? "03";
  const [inv] = await tx<{ id: number }[]>`
    INSERT INTO sales_invoices (serie, issue_date, third_party_id, warehouse_id, uso_cfdi, metodo_pago, forma_pago, notes)
    VALUES (${company.invoice_serie}, ${input.issueDate ?? tx`date_trunc('second', localtimestamp)`}, ${input.thirdPartyId},
            ${input.warehouseId ?? null}, ${input.usoCfdi ?? party.uso_cfdi}, ${input.metodoPago}, ${formaPago}, ${input.notes ?? null})
    RETURNING id`;

  let n = 1;
  for (const l of input.lines) {
    let p: { name: string; clave_prod_serv: string; clave_unidad: string; unit_name: string; sale_price: string; objeto_imp: string; iva_factor: string; iva_rate: string } | undefined;
    if (l.productId) {
      [p] = await tx`SELECT name, clave_prod_serv, clave_unidad, unit_name, sale_price, objeto_imp, iva_factor, iva_rate FROM products WHERE id = ${l.productId}`;
      if (!p) throw notFound(`Producto ${l.productId}`);
    }
    const row = {
      description: l.description ?? p?.name,
      clave_prod_serv: l.claveProdServ ?? p?.clave_prod_serv,
      clave_unidad: l.claveUnidad ?? p?.clave_unidad,
      unit_name: l.unitName ?? p?.unit_name ?? null,
      unit_price: String(l.unitPrice ?? p?.sale_price ?? ""),
      objeto_imp: l.objetoImp ?? p?.objeto_imp ?? "02",
      iva_factor: l.ivaFactor ?? p?.iva_factor ?? "Tasa",
      iva_rate: String(l.ivaRate ?? p?.iva_rate ?? "0.16"),
    };
    if (!row.description || !row.clave_prod_serv || !row.clave_unidad || row.unit_price === "")
      throw badRequest(`Concepto ${n}: falta descripción, clave SAT o precio`);
    await tx`
      INSERT INTO sales_invoice_lines (invoice_id, line_no, product_id, description, clave_prod_serv, clave_unidad, unit_name, qty, unit_price,
        discount, objeto_imp, iva_factor, iva_rate, ret_iva_rate, ret_isr_rate)
      VALUES (${inv!.id}, ${n++}, ${l.productId ?? null}, ${row.description}, ${row.clave_prod_serv}, ${row.clave_unidad}, ${row.unit_name},
        ${String(l.qty)}, ${row.unit_price}, ${String(l.discount ?? 0)}, ${row.objeto_imp}, ${row.iva_factor}, ${row.iva_rate},
        ${String(l.retIvaRate ?? 0)}, ${String(l.retIsrRate ?? 0)})`;
  }
  await recalcSalesInvoice(tx, inv!.id);
  return inv!.id;
}

/** Recompute line and header amounts from the lines (same math as the CFDI). */
export async function recalcSalesInvoice(tx: Db, id: number) {
  const lines = await tx<LineRow[]>`SELECT * FROM sales_invoice_lines WHERE invoice_id = ${id} ORDER BY line_no`;
  let subtotal = D(0), discount = D(0), traslados = D(0), retenciones = D(0), total = D(0);
  for (const l of lines) {
    const t = computeLine({ quantity: l.qty, unitPrice: l.unit_price, discount: l.discount, objetoImp: l.objeto_imp, ...lineTaxes(l) });
    const retIva = t.retenciones.filter((r) => r.impuesto === IMPUESTOS.IVA).reduce((s, r) => s.plus(r.importe ?? 0), D(0));
    const retIsr = t.retenciones.filter((r) => r.impuesto === IMPUESTOS.ISR).reduce((s, r) => s.plus(r.importe ?? 0), D(0));
    await tx`UPDATE sales_invoice_lines SET base = ${t.base.toFixed(2)}, iva_amount = ${t.totalTraslados.toFixed(2)},
             ret_iva_amount = ${retIva.toFixed(2)}, ret_isr_amount = ${retIsr.toFixed(2)}, total = ${t.total.toFixed(2)} WHERE id = ${l.id}`;
    subtotal = subtotal.plus(t.importe);
    discount = discount.plus(t.discount);
    traslados = traslados.plus(t.totalTraslados);
    retenciones = retenciones.plus(t.totalRetenciones);
    total = total.plus(t.total);
  }
  await tx`UPDATE sales_invoices SET subtotal = ${subtotal.toFixed(2)}, discount = ${discount.toFixed(2)},
           total_traslados = ${traslados.toFixed(2)}, total_retenciones = ${retenciones.toFixed(2)}, total = ${total.toFixed(2)} WHERE id = ${id}`;
}

export async function buildSalesCfdi(tx: Db, id: number, folio?: number): Promise<CfdiInput> {
  const [inv] = await tx<{ serie: string; folio: number | null; issue_date: string; metodo_pago: "PUE" | "PPD"; forma_pago: string; uso_cfdi: string; tipo_comprobante: "I" | "E"; moneda: string; rfc: string; name: string; regimen_fiscal: string; codigo_postal: string }[]>`
    SELECT i.serie, i.folio, i.issue_date, i.metodo_pago, i.forma_pago, i.uso_cfdi, i.tipo_comprobante, i.moneda,
           t.rfc, t.name, t.regimen_fiscal, t.codigo_postal
    FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id WHERE i.id = ${id}`;
  if (!inv) throw notFound("Factura");
  const [company] = await tx<{ rfc: string; razon_social: string; regimen_fiscal: string; codigo_postal: string }[]>`SELECT * FROM company WHERE id = 1`;
  const lines = await tx<LineRow[]>`
    SELECT l.*, p.sku, p.type AS product_type FROM sales_invoice_lines l LEFT JOIN products p ON p.id = l.product_id
    WHERE l.invoice_id = ${id} ORDER BY l.line_no`;
  const conceptos: CfdiConcepto[] = lines.map((l) => ({
    claveProdServ: l.clave_prod_serv,
    noIdentificacion: l.sku ?? undefined,
    claveUnidad: l.clave_unidad,
    unidad: l.unit_name ?? undefined,
    descripcion: l.description,
    quantity: l.qty,
    unitPrice: l.unit_price,
    discount: D(l.discount).isZero() ? undefined : l.discount,
    objetoImp: l.objeto_imp,
    ...lineTaxes(l),
  }));
  return {
    serie: inv.serie,
    folio: String(folio ?? inv.folio ?? ""),
    fecha: inv.issue_date.replace(" ", "T").slice(0, 19),
    tipoDeComprobante: inv.tipo_comprobante,
    formaPago: inv.forma_pago,
    metodoPago: inv.metodo_pago,
    moneda: inv.moneda,
    lugarExpedicion: company!.codigo_postal,
    emisor: { rfc: company!.rfc, nombre: company!.razon_social, regimenFiscal: company!.regimen_fiscal },
    receptor: { rfc: inv.rfc, nombre: inv.name, regimenFiscal: inv.regimen_fiscal, domicilioFiscal: inv.codigo_postal, usoCfdi: inv.uso_cfdi },
    conceptos,
  };
}

/**
 * Issue (timbrar) a draft invoice in one transaction: validate the CFDI rules,
 * assign the folio, stamp with the PAC, take products out of stock at average
 * cost and post the sales and cost-of-sales entries with the CFDI UUID.
 */
export async function issueSalesInvoice(tx: Db, id: number, pac: PacProvider) {
  const [inv] = await tx<{ id: number; status: string; serie: string; warehouse_id: number | null; third_party_id: number; issue_date: string; total: string; total_traslados: string; rfc: string }[]>`
    SELECT i.*, t.rfc FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id WHERE i.id = ${id} FOR UPDATE OF i`;
  if (!inv) throw notFound("Factura");
  if (inv.status !== "draft") throw conflict("Sólo se pueden timbrar facturas en borrador");
  await recalcSalesInvoice(tx, id);

  const draft = await buildSalesCfdi(tx, id, 0);
  const issues = validateCfdi(draft);
  if (issues.length) throw new AppError(422, "La factura no cumple las reglas del CFDI 4.0", issues);

  const folio = await nextSequence(tx, `invoice:${inv.serie}`);
  const cfdi = await buildSalesCfdi(tx, id, folio);
  const { xml } = buildCfdiXml(cfdi);
  const stamped = await pac.stamp(xml);
  const date = inv.issue_date.slice(0, 10);

  // Stock out and cost of sales.
  const lines = await tx<(LineRow & { base: string; iva_amount: string; ret_iva_amount: string; ret_isr_amount: string })[]>`
    SELECT l.*, p.type AS product_type FROM sales_invoice_lines l LEFT JOIN products p ON p.id = l.product_id
    WHERE l.invoice_id = ${id} ORDER BY l.line_no`;
  let cost = D(0);
  for (const l of lines) {
    if (l.product_id && l.product_type === "product") {
      if (!inv.warehouse_id) throw badRequest("Selecciona el almacén del que salen los productos");
      const mov = await moveStock(tx, {
        productId: l.product_id, warehouseId: inv.warehouse_id, qty: D(l.qty).negated(), kind: "sale",
        label: `Factura ${inv.serie}-${folio}`, sourceType: "sales_invoice", sourceId: id, date,
      });
      await tx`UPDATE sales_invoice_lines SET unit_cost = ${mov.unitCost.toString()} WHERE id = ${l.id}`;
      cost = cost.plus(mov.value.abs());
    }
  }

  // Sales entry: receivable against income by IVA treatment, IVA not yet
  // collected (cash-basis IVA, LIVA art. 1-B) and withholdings by the customer.
  const [customers, salesTaxed, salesZero, salesExempt, ivaPending, retIvaAcc, retIsrAcc] = await Promise.all(
    ["customers", "sales_taxed", "sales_zero", "sales_exempt", "iva_transferred_pending", "iva_withheld_by_customers", "isr_withheld_by_customers"].map((k) => accountFor(tx, k)),
  );
  const incomeByAccount = new Map<number, Decimal>();
  let iva = D(0), retIva = D(0), retIsr = D(0), total = D(0);
  for (const l of lines) {
    const [override] = l.product_id ? await tx<{ income_account_id: number | null }[]>`SELECT income_account_id FROM products WHERE id = ${l.product_id}` : [];
    const acc = override?.income_account_id
      ?? (l.objeto_imp !== "02" || l.iva_factor === "Exento" ? salesExempt : D(l.iva_rate).isZero() ? salesZero : salesTaxed);
    incomeByAccount.set(acc!, (incomeByAccount.get(acc!) ?? D(0)).plus(l.base));
    iva = iva.plus(l.iva_amount);
    retIva = retIva.plus(l.ret_iva_amount);
    retIsr = retIsr.plus(l.ret_isr_amount);
  }
  total = [...incomeByAccount.values()].reduce((s, v) => s.plus(v), D(0)).plus(iva).minus(retIva).minus(retIsr);
  const ref = { cfdiUuid: stamped.uuid, rfc: inv.rfc, cfdiTotal: total };
  const entryLines: EntryLineInput[] = [
    { accountId: customers!, debit: total, ...ref },
    { accountId: retIvaAcc!, debit: retIva, ...ref },
    { accountId: retIsrAcc!, debit: retIsr, ...ref },
    ...[...incomeByAccount].map(([accountId, amount]) => ({ accountId, credit: amount, ...ref })),
    { accountId: ivaPending!, credit: iva, ...ref },
  ];
  const label = `Factura ${inv.serie}-${folio}`;
  const entryId = await postEntry(tx, { journal: "VT", date, concept: label, sourceType: "sales_invoice", sourceId: id, lines: entryLines });
  if (cost.gt(0)) {
    await postEntry(tx, {
      journal: "VT", date, concept: `Costo de venta ${label}`, sourceType: "sales_invoice", sourceId: id,
      lines: [
        { accountId: await accountFor(tx, "cost_of_sales"), debit: round2(cost), ...ref },
        { accountId: await accountFor(tx, "inventory"), credit: round2(cost), ...ref },
      ],
    });
  }

  await tx`UPDATE sales_invoices SET folio = ${folio}, status = 'stamped', uuid = ${stamped.uuid}, xml = ${stamped.xml},
           stamped_at = ${stamped.stampedAt}, pac = ${pac.name}, journal_entry_id = ${entryId} WHERE id = ${id}`;
  return { id, folio, uuid: stamped.uuid, journalEntryId: entryId };
}

/**
 * Cancel a stamped invoice (motivos SAT: 01 con relación, 02 sin relación,
 * 03 no se llevó a cabo, 04 nominativa en factura global). Reverses stock and
 * every posted entry of the invoice. Invoices with payments must have them
 * reversed first (or use a credit note).
 */
export async function cancelSalesInvoice(tx: Db, id: number, pac: PacProvider, motivo: string, folioSustitucion?: string) {
  const [inv] = await tx<{ status: string; uuid: string | null; paid_amount: string; serie: string; folio: number; warehouse_id: number | null }[]>`
    SELECT status, uuid, paid_amount, serie, folio, warehouse_id FROM sales_invoices WHERE id = ${id} FOR UPDATE`;
  if (!inv) throw notFound("Factura");
  if (inv.status === "draft") {
    await tx`UPDATE sales_invoices SET status = 'cancelled' WHERE id = ${id}`;
    return { id, status: "cancelled" };
  }
  if (inv.status !== "stamped") throw conflict("La factura no está timbrada");
  if (D(inv.paid_amount).gt(0)) throw conflict("La factura tiene cobros; cancélalos o emite una nota de crédito");
  if (!["01", "02", "03", "04"].includes(motivo)) throw badRequest("Motivo de cancelación inválido");
  if (motivo === "01" && !folioSustitucion) throw badRequest("El motivo 01 requiere el UUID que sustituye a esta factura");
  const result = await pac.cancel(inv.uuid!, motivo, folioSustitucion);
  if (result.status !== "cancelled") throw conflict("El receptor debe aceptar la cancelación; vuelve a intentarlo más tarde");

  const date = new Date().toISOString().slice(0, 10);
  const movs = await tx<{ product_id: number; warehouse_id: number; qty: string; unit_cost: string }[]>`
    SELECT product_id, warehouse_id, qty, unit_cost FROM stock_movements WHERE source_type = 'sales_invoice' AND source_id = ${id} AND kind = 'sale'`;
  for (const m of movs) {
    await moveStock(tx, { productId: m.product_id, warehouseId: m.warehouse_id, qty: D(m.qty).negated(), unitCost: m.unit_cost, kind: "return",
      label: `Cancelación factura ${inv.serie}-${inv.folio}`, sourceType: "sales_invoice", sourceId: id, date });
  }
  const entries = await tx<{ id: number }[]>`
    SELECT id FROM journal_entries WHERE source_type = 'sales_invoice' AND source_id = ${id} AND status = 'posted' ORDER BY id`;
  for (const e of entries) await reverseEntry(tx, e.id, date, `Cancelación factura ${inv.serie}-${inv.folio}`);
  await tx`UPDATE sales_invoices SET status = 'cancelled' WHERE id = ${id}`;
  return { id, status: "cancelled" };
}
