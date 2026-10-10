import { computeLine, D, Decimal, IMPUESTOS } from "@erp/mx";
import type { Db } from "@erp/db";
import { badRequest, conflict, notFound } from "../errors.js";
import { accountFor, postEntry, type EntryLineInput } from "./accounting.js";
import { moveStock } from "./inventory.js";

export interface SupplierLineInput {
  productId?: number;
  accountId?: number;
  description?: string;
  qty: string | number;
  unitPrice: string | number;
  discount?: string | number;
  ivaRate?: string | number;
  retIvaRate?: string | number;
  retIsrRate?: string | number;
}

export interface SupplierInvoiceInput {
  thirdPartyId: number;
  warehouseId?: number;
  supplierRef?: string;
  uuid?: string;
  issueDate?: string;
  metodoPago?: "PUE" | "PPD";
  lines: SupplierLineInput[];
}

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

export async function createSupplierInvoice(tx: Db, input: SupplierInvoiceInput): Promise<number> {
  if (!input.lines.length) throw badRequest("La factura requiere al menos un concepto");
  if (input.uuid && !UUID_RE.test(input.uuid)) throw badRequest("UUID de CFDI inválido");
  const [party] = await tx<{ is_supplier: boolean }[]>`SELECT is_supplier FROM third_parties WHERE id = ${input.thirdPartyId}`;
  if (!party) throw notFound("Proveedor");
  if (!party.is_supplier) throw badRequest("El tercero no está marcado como proveedor");
  const [inv] = await tx<{ id: number }[]>`
    INSERT INTO supplier_invoices (third_party_id, warehouse_id, supplier_ref, uuid, issue_date, metodo_pago)
    VALUES (${input.thirdPartyId}, ${input.warehouseId ?? null}, ${input.supplierRef ?? null}, ${input.uuid?.toUpperCase() ?? null},
            ${input.issueDate ?? new Date().toISOString().slice(0, 10)}, ${input.metodoPago ?? "PUE"})
    RETURNING id`;
  let n = 1;
  let subtotal = D(0), discount = D(0), iva = D(0), retIva = D(0), retIsr = D(0), total = D(0);
  for (const l of input.lines) {
    let description = l.description;
    if (l.productId) {
      const [p] = await tx<{ name: string; type: string }[]>`SELECT name, type FROM products WHERE id = ${l.productId}`;
      if (!p) throw notFound(`Producto ${l.productId}`);
      description ??= p.name;
    } else if (!l.accountId) {
      l.accountId = await accountFor(tx, "default_expense");
    }
    if (!description) throw badRequest(`Concepto ${n}: falta descripción`);
    const retenciones = [
      ...(D(l.retIvaRate ?? 0).gt(0) ? [{ impuesto: IMPUESTOS.IVA, rate: String(l.retIvaRate) }] : []),
      ...(D(l.retIsrRate ?? 0).gt(0) ? [{ impuesto: IMPUESTOS.ISR, rate: String(l.retIsrRate) }] : []),
    ];
    const t = computeLine({
      quantity: l.qty, unitPrice: l.unitPrice, discount: l.discount, objetoImp: "02",
      traslados: [{ impuesto: IMPUESTOS.IVA, tipoFactor: "Tasa", rate: String(l.ivaRate ?? "0.16") }],
      retenciones,
    });
    const lRetIva = t.retenciones.filter((r) => r.impuesto === IMPUESTOS.IVA).reduce((s, r) => s.plus(r.importe ?? 0), D(0));
    const lRetIsr = t.retenciones.filter((r) => r.impuesto === IMPUESTOS.ISR).reduce((s, r) => s.plus(r.importe ?? 0), D(0));
    await tx`
      INSERT INTO supplier_invoice_lines (invoice_id, line_no, product_id, account_id, description, qty, unit_price, discount, iva_rate,
        ret_iva_rate, ret_isr_rate, base, iva_amount, ret_iva_amount, ret_isr_amount, total)
      VALUES (${inv!.id}, ${n++}, ${l.productId ?? null}, ${l.accountId ?? null}, ${description}, ${String(l.qty)}, ${String(l.unitPrice)},
        ${t.discount.toFixed(2)}, ${String(l.ivaRate ?? "0.16")}, ${String(l.retIvaRate ?? 0)}, ${String(l.retIsrRate ?? 0)},
        ${t.base.toFixed(2)}, ${t.totalTraslados.toFixed(2)}, ${lRetIva.toFixed(2)}, ${lRetIsr.toFixed(2)}, ${t.total.toFixed(2)})`;
    subtotal = subtotal.plus(t.importe);
    discount = discount.plus(t.discount);
    iva = iva.plus(t.totalTraslados);
    retIva = retIva.plus(lRetIva);
    retIsr = retIsr.plus(lRetIsr);
    total = total.plus(t.total);
  }
  await tx`UPDATE supplier_invoices SET subtotal = ${subtotal.toFixed(2)}, discount = ${discount.toFixed(2)}, iva = ${iva.toFixed(2)},
           ret_iva = ${retIva.toFixed(2)}, ret_isr = ${retIsr.toFixed(2)}, total = ${total.toFixed(2)} WHERE id = ${inv!.id}`;
  return inv!.id;
}

/**
 * Validate a supplier invoice: receive products into stock (updating the
 * average cost) and post inventory/expense, IVA pending payment, withholdings
 * payable and the amount owed to the supplier.
 */
export async function validateSupplierInvoice(tx: Db, id: number) {
  const [inv] = await tx<{ status: string; warehouse_id: number | null; issue_date: string; uuid: string | null; total: string; supplier_ref: string | null; rfc: string; name: string }[]>`
    SELECT s.*, t.rfc, t.name FROM supplier_invoices s JOIN third_parties t ON t.id = s.third_party_id WHERE s.id = ${id} FOR UPDATE OF s`;
  if (!inv) throw notFound("Factura de proveedor");
  if (inv.status !== "draft") throw conflict("Sólo se validan facturas en borrador");
  const lines = await tx<{ product_id: number | null; account_id: number | null; qty: string; base: string; iva_amount: string; ret_iva_amount: string; ret_isr_amount: string; product_type: string | null; expense_account_id: number | null }[]>`
    SELECT l.*, p.type AS product_type, p.expense_account_id FROM supplier_invoice_lines l LEFT JOIN products p ON p.id = l.product_id
    WHERE l.invoice_id = ${id} ORDER BY l.line_no`;
  const date = inv.issue_date.slice(0, 10);
  const label = `Compra ${inv.name}${inv.supplier_ref ? ` ${inv.supplier_ref}` : ""}`;

  const [inventory, suppliers, ivaPending, retIvaPayable, retIsrPayable, defaultExpense] = await Promise.all(
    ["inventory", "suppliers", "iva_creditable_pending", "iva_withheld_payable", "isr_withheld_payable", "default_expense"].map((k) => accountFor(tx, k)),
  );
  const debits = new Map<number, Decimal>();
  let iva = D(0), retIva = D(0), retIsr = D(0);
  for (const l of lines) {
    let account: number;
    if (l.product_id && l.product_type === "product") {
      if (!inv.warehouse_id) throw badRequest("Selecciona el almacén que recibe la mercancía");
      // Unit cost excludes IVA (it is creditable) and includes line discounts.
      await moveStock(tx, {
        productId: l.product_id, warehouseId: inv.warehouse_id, qty: l.qty, unitCost: D(l.base).dividedBy(l.qty).toDecimalPlaces(6),
        kind: "purchase", label, sourceType: "supplier_invoice", sourceId: id, date,
      });
      account = inventory!;
    } else {
      account = l.account_id ?? l.expense_account_id ?? defaultExpense!;
    }
    debits.set(account, (debits.get(account) ?? D(0)).plus(l.base));
    iva = iva.plus(l.iva_amount);
    retIva = retIva.plus(l.ret_iva_amount);
    retIsr = retIsr.plus(l.ret_isr_amount);
  }
  const ref = { cfdiUuid: inv.uuid, rfc: inv.rfc, cfdiTotal: inv.total };
  const entryLines: EntryLineInput[] = [
    ...[...debits].map(([accountId, amount]) => ({ accountId, debit: amount, ...ref })),
    { accountId: ivaPending!, debit: iva, ...ref },
    { accountId: retIvaPayable!, credit: retIva, ...ref },
    { accountId: retIsrPayable!, credit: retIsr, ...ref },
    { accountId: suppliers!, credit: inv.total, ...ref },
  ];
  const entryId = await postEntry(tx, { journal: "AC", date, concept: label, sourceType: "supplier_invoice", sourceId: id, lines: entryLines });
  await tx`UPDATE supplier_invoices SET status = 'validated', journal_entry_id = ${entryId} WHERE id = ${id}`;
  return { id, journalEntryId: entryId };
}
