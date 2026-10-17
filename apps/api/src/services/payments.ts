import { D, round2 } from "@erp/mx";
import type { Db } from "@erp/db";
import { badRequest, conflict, notFound } from "../errors.js";
import { accountFor, postEntry } from "./accounting.js";

export interface PaymentInput {
  invoiceId: number;
  bankAccountId: number;
  amount: string | number;
  paidOn?: string;
  formaPago?: string;
  reference?: string;
}

/**
 * Register a customer payment (cobro). Besides bank vs. receivable, it moves
 * the proportional IVA from "trasladado no cobrado" to "trasladado cobrado",
 * because IVA is due when collected (LIVA art. 1-B). PPD invoices also need a
 * CFDI de pagos (complemento 2.0); that document is not generated yet.
 */
export async function registerCustomerPayment(tx: Db, input: PaymentInput) {
  const [inv] = await tx<{ id: number; status: string; total: string; paid_amount: string; total_traslados: string; third_party_id: number; serie: string; folio: number; uuid: string; rfc: string }[]>`
    SELECT i.*, t.rfc FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id WHERE i.id = ${input.invoiceId} FOR UPDATE OF i`;
  if (!inv) throw notFound("Factura");
  if (inv.status !== "stamped") throw conflict("Sólo se cobran facturas timbradas");
  const amount = round2(input.amount);
  const pending = D(inv.total).minus(inv.paid_amount);
  if (!amount.gt(0) || amount.greaterThan(pending)) throw badRequest(`El monto debe estar entre 0.01 y ${pending.toFixed(2)}`);
  const [bank] = await tx<{ account_id: number }[]>`SELECT account_id FROM bank_accounts WHERE id = ${input.bankAccountId}`;
  if (!bank) throw notFound("Cuenta bancaria");

  const date = input.paidOn ?? new Date().toISOString().slice(0, 10);
  const ivaShare = D(inv.total).isZero() ? D(0) : round2(D(inv.total_traslados).times(amount).dividedBy(inv.total));
  const [pay] = await tx<{ id: number }[]>`
    INSERT INTO payments (direction, third_party_id, bank_account_id, paid_on, amount, forma_pago, sales_invoice_id, reference)
    VALUES ('in', ${inv.third_party_id}, ${input.bankAccountId}, ${date}, ${amount.toFixed(2)}, ${input.formaPago ?? "03"}, ${inv.id}, ${input.reference ?? null})
    RETURNING id`;
  const ref = { cfdiUuid: inv.uuid, rfc: inv.rfc, cfdiTotal: inv.total };
  const entryId = await postEntry(tx, {
    journal: "CO", date, concept: `Cobro factura ${inv.serie}-${inv.folio}`, sourceType: "payment", sourceId: pay!.id,
    lines: [
      { accountId: bank.account_id, debit: amount, ...ref },
      { accountId: await accountFor(tx, "customers"), credit: amount, ...ref },
      { accountId: await accountFor(tx, "iva_transferred_pending"), debit: ivaShare, ...ref },
      { accountId: await accountFor(tx, "iva_transferred_collected"), credit: ivaShare, ...ref },
    ],
  });
  await tx`UPDATE payments SET journal_entry_id = ${entryId} WHERE id = ${pay!.id}`;
  await tx`UPDATE sales_invoices SET paid_amount = paid_amount + ${amount.toFixed(2)} WHERE id = ${inv.id}`;
  return { id: pay!.id, journalEntryId: entryId, ivaCollected: ivaShare.toFixed(2) };
}

/** Pay a supplier invoice; the proportional IVA becomes creditable when paid (LIVA art. 5 fr. III). */
export async function registerSupplierPayment(tx: Db, input: PaymentInput) {
  const [inv] = await tx<{ id: number; status: string; total: string; paid_amount: string; iva: string; third_party_id: number; uuid: string | null; rfc: string; name: string }[]>`
    SELECT s.*, t.rfc, t.name FROM supplier_invoices s JOIN third_parties t ON t.id = s.third_party_id WHERE s.id = ${input.invoiceId} FOR UPDATE OF s`;
  if (!inv) throw notFound("Factura de proveedor");
  if (inv.status !== "validated") throw conflict("Sólo se pagan facturas validadas");
  const amount = round2(input.amount);
  const pending = D(inv.total).minus(inv.paid_amount);
  if (!amount.gt(0) || amount.greaterThan(pending)) throw badRequest(`El monto debe estar entre 0.01 y ${pending.toFixed(2)}`);
  const [bank] = await tx<{ account_id: number }[]>`SELECT account_id FROM bank_accounts WHERE id = ${input.bankAccountId}`;
  if (!bank) throw notFound("Cuenta bancaria");

  const date = input.paidOn ?? new Date().toISOString().slice(0, 10);
  const ivaShare = D(inv.total).isZero() ? D(0) : round2(D(inv.iva).times(amount).dividedBy(inv.total));
  const [pay] = await tx<{ id: number }[]>`
    INSERT INTO payments (direction, third_party_id, bank_account_id, paid_on, amount, forma_pago, supplier_invoice_id, reference)
    VALUES ('out', ${inv.third_party_id}, ${input.bankAccountId}, ${date}, ${amount.toFixed(2)}, ${input.formaPago ?? "03"}, ${inv.id}, ${input.reference ?? null})
    RETURNING id`;
  const ref = { cfdiUuid: inv.uuid, rfc: inv.rfc, cfdiTotal: inv.total };
  const entryId = await postEntry(tx, {
    journal: "PA", date, concept: `Pago a ${inv.name}`, sourceType: "payment", sourceId: pay!.id,
    lines: [
      { accountId: await accountFor(tx, "suppliers"), debit: amount, ...ref },
      { accountId: bank.account_id, credit: amount, ...ref },
      { accountId: await accountFor(tx, "iva_creditable_paid"), debit: ivaShare, ...ref },
      { accountId: await accountFor(tx, "iva_creditable_pending"), credit: ivaShare, ...ref },
    ],
  });
  await tx`UPDATE payments SET journal_entry_id = ${entryId} WHERE id = ${pay!.id}`;
  await tx`UPDATE supplier_invoices SET paid_amount = paid_amount + ${amount.toFixed(2)} WHERE id = ${inv.id}`;
  return { id: pay!.id, journalEntryId: entryId, ivaCreditable: ivaShare.toFixed(2) };
}
