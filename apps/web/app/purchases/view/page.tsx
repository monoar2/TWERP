"use client";
import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import type { SupplierInvoice } from "@erp/client";
import { api, satCatalogs } from "@/lib/api";
import { date, money, qty, today } from "@/lib/format";
import { Card, ErrorBox, Field, Loading, Modal, Notice, PageHeader, StatusChip, useAction, useData } from "@/components/ui";

interface SupplierLine { id: number; line_no: number; description: string; qty: string; unit_price: string; iva_rate: string; base: string; iva_amount: string; ret_iva_amount: string; ret_isr_amount: string; total: string }

function PurchaseInner() {
  const id = Number(useSearchParams().get("id"));
  const inv = useData(() => api().request<SupplierInvoice & { lines: SupplierLine[] }>("GET", `/supplier-invoices/${id}`), [id]);
  const banks = useData(() => api().bankAccounts());
  const cats = useData(() => satCatalogs());
  const action = useAction();
  const [notice, setNotice] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ bankAccountId: "", amount: "", paidOn: today(), formaPago: "03", reference: "" });

  if (!id) return <ErrorBox error={new Error("Falta el parámetro id")} />;
  if (inv.loading && !inv.data) return <Loading />;
  if (!inv.data) return <ErrorBox error={inv.error} />;
  const i = inv.data;
  const due = Number(i.total) - Number(i.paid_amount);

  async function validate() {
    const r = await action.run(() => api().validateSupplierInvoice(id));
    if (r !== undefined) { setNotice("Factura validada: se registró la entrada de inventario y la póliza."); void inv.reload(); }
  }
  async function submitPay(e: FormEvent) {
    e.preventDefault();
    const r = await action.run(() => api().paySupplier(id, { bankAccountId: Number(pay.bankAccountId), amount: pay.amount, paidOn: pay.paidOn, formaPago: pay.formaPago, reference: pay.reference || undefined }));
    if (r !== undefined) { setPayOpen(false); setNotice("Pago registrado."); void inv.reload(); }
  }

  return (
    <>
      <PageHeader title={`Compra #${i.id}`} subtitle={<><StatusChip status={i.status} /> · {i.supplier_name} · {date(i.issue_date)}</>}
        actions={<>
          {i.status === "draft" ? <button className="btn btn-primary" onClick={validate} disabled={action.busy}>Validar</button> : null}
          {i.status === "validated" && due > 0.005 ? <button className="btn btn-success" onClick={() => { setPay((p) => ({ ...p, amount: due.toFixed(2) })); setPayOpen(true); }}>Registrar pago</button> : null}
        </>} />
      <Notice>{notice}</Notice>
      <ErrorBox error={action.error} />
      <div className="grid grid-2">
        <Card title="Datos">
          <dl className="dl">
            <dt>Proveedor</dt><dd>{i.supplier_name}</dd>
            {i.supplier_rfc ? <><dt>RFC</dt><dd className="mono">{i.supplier_rfc}</dd></> : null}
            <dt>Folio proveedor</dt><dd>{i.supplier_ref ?? "—"}</dd>
            <dt>UUID</dt><dd className="mono">{i.uuid ?? "—"}</dd>
            <dt>Método de pago</dt><dd>{i.metodo_pago}</dd>
          </dl>
        </Card>
        <Card title="Totales">
          <div className="totals" style={{ marginLeft: 0, maxWidth: "none" }}>
            <div><span>Subtotal</span><span>{money(i.subtotal)}</span></div>
            <div><span>IVA</span><span>{money(i.iva)}</span></div>
            {Number(i.ret_iva) ? <div><span>Retención IVA</span><span>-{money(i.ret_iva)}</span></div> : null}
            {Number(i.ret_isr) ? <div><span>Retención ISR</span><span>-{money(i.ret_isr)}</span></div> : null}
            <div className="grand"><span>Total</span><span>{money(i.total)}</span></div>
            <div><span>Pagado</span><span>{money(i.paid_amount)}</span></div>
            <div><span>Saldo</span><span className={due > 0.005 ? "tone-warning" : "tone-success"}>{money(due)}</span></div>
          </div>
        </Card>
      </div>
      <Card title="Conceptos">
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Descripción</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Base</th><th className="num">IVA</th><th className="num">Retenciones</th><th className="num">Total</th></tr></thead>
            <tbody>
              {(i.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{l.line_no}</td><td>{l.description}</td><td className="num">{qty(l.qty, 4)}</td><td className="num">{money(l.unit_price)}</td>
                  <td className="num">{money(l.base)}</td><td className="num">{money(l.iva_amount)}</td>
                  <td className="num">{money(Number(l.ret_iva_amount) + Number(l.ret_isr_amount))}</td><td className="num">{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal title="Registrar pago a proveedor" open={payOpen} onClose={() => setPayOpen(false)}>
        <form onSubmit={submitPay}>
          <div className="form-grid">
            <Field label="Cuenta bancaria" wide>
              <select required value={pay.bankAccountId} onChange={(e) => setPay({ ...pay, bankAccountId: e.target.value })}>
                <option value="">Selecciona…</option>
                {(banks.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}{b.bank ? ` — ${b.bank}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Importe"><input required type="number" step="0.01" min="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label="Fecha"><input type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /></Field>
            <Field label="Forma de pago" wide>
              <select value={pay.formaPago} onChange={(e) => setPay({ ...pay, formaPago: e.target.value })}>
                {(cats.data?.formasPago ?? []).filter((f) => f.code !== "99").map((f) => <option key={f.code} value={f.code}>{f.code} — {f.description}</option>)}
              </select>
            </Field>
            <Field label="Referencia" wide><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          </div>
          <ErrorBox error={action.error ?? banks.error} />
          <div className="form-actions"><button type="button" className="btn" onClick={() => setPayOpen(false)}>Cerrar</button><button className="btn btn-primary" disabled={action.busy}>Registrar</button></div>
        </form>
      </Modal>
    </>
  );
}

export default function PurchaseViewPage() {
  return (
    <>
      <p className="small"><Link href="/purchases/">← Compras</Link></p>
      <Suspense fallback={<Loading />}><PurchaseInner /></Suspense>
    </>
  );
}
