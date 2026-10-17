"use client";
import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { api, downloadFile, satCatalogs } from "@/lib/api";
import { CANCEL_MOTIVOS, date, folio, money, qty, today } from "@/lib/format";
import { Card, ErrorBox, Field, Loading, Modal, Notice, PageHeader, StatusChip, useAction, useData } from "@/components/ui";

function InvoiceInner() {
  const id = Number(useSearchParams().get("id"));
  const inv = useData(() => api().salesInvoice(id), [id]);
  const banks = useData(() => api().bankAccounts());
  const cats = useData(() => satCatalogs());
  const action = useAction();
  const [notice, setNotice] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pay, setPay] = useState({ bankAccountId: "", amount: "", paidOn: today(), formaPago: "03", reference: "" });
  const [cancel, setCancel] = useState({ motivo: "02", folioSustitucion: "" });

  if (!id) return <ErrorBox error={new Error("Falta el parámetro id")} />;
  if (inv.loading && !inv.data) return <Loading />;
  if (!inv.data) return <ErrorBox error={inv.error} />;
  const i = inv.data;
  const due = Number(i.total) - Number(i.paid_amount);

  async function stamp() {
    const r = await action.run(() => api().issueSalesInvoice(id));
    if (r) { setNotice(`Factura timbrada. Folio ${r.folio}, UUID ${r.uuid}`); void inv.reload(); }
  }
  async function submitPay(e: FormEvent) {
    e.preventDefault();
    const r = await action.run(() => api().collectPayment(id, {
      bankAccountId: Number(pay.bankAccountId), amount: pay.amount, paidOn: pay.paidOn, formaPago: pay.formaPago, reference: pay.reference || undefined,
    }));
    if (r !== undefined) { setPayOpen(false); setNotice("Cobro registrado."); void inv.reload(); }
  }
  async function submitCancel(e: FormEvent) {
    e.preventDefault();
    const r = await action.run(() => api().cancelSalesInvoice(id, cancel.motivo, cancel.motivo === "01" ? cancel.folioSustitucion : undefined));
    if (r !== undefined) { setCancelOpen(false); setNotice("Solicitud de cancelación procesada."); void inv.reload(); }
  }
  async function downloadXml() {
    await action.run(() => downloadFile(api().salesInvoiceXmlPath(id), `${i.uuid ?? `factura-${id}`}.xml`));
  }

  return (
    <>
      <PageHeader
        title={`Factura ${folio(i)}`}
        subtitle={<><StatusChip status={i.status} /> · {i.customer_name} · {date(i.issue_date)}</>}
        actions={<>
          {i.status === "draft" ? <button className="btn btn-primary" onClick={stamp} disabled={action.busy}>{action.busy ? "Timbrando…" : "Timbrar"}</button> : null}
          {i.hasXml ? <button className="btn" onClick={downloadXml} disabled={action.busy}>Descargar XML</button> : null}
          {i.status === "stamped" && due > 0.005 ? <button className="btn btn-success" onClick={() => { setPay((p) => ({ ...p, amount: due.toFixed(2), formaPago: i.forma_pago !== "99" ? i.forma_pago : "03" })); setPayOpen(true); }}>Registrar cobro</button> : null}
          {i.status === "stamped" ? <button className="btn btn-danger" onClick={() => setCancelOpen(true)}>Cancelar CFDI</button> : null}
        </>}
      />
      <Notice>{notice}</Notice>
      <ErrorBox error={action.error} />
      <div className="grid grid-2">
        <Card title="Comprobante">
          <dl className="dl">
            <dt>Cliente</dt><dd>{i.customer_name}</dd>
            <dt>RFC</dt><dd className="mono">{i.customer_rfc}</dd>
            <dt>Uso CFDI</dt><dd>{i.uso_cfdi}</dd>
            <dt>Método de pago</dt><dd>{i.metodo_pago}</dd>
            <dt>Forma de pago</dt><dd>{i.forma_pago} {cats.data?.formasPago.find((f) => f.code === i.forma_pago)?.description}</dd>
            <dt>UUID (folio fiscal)</dt><dd className="mono">{i.uuid ?? <span className="muted">Sin timbrar</span>}</dd>
          </dl>
        </Card>
        <Card title="Totales">
          <div className="totals" style={{ marginLeft: 0, maxWidth: "none" }}>
            <div><span>Subtotal</span><span>{money(i.subtotal)}</span></div>
            <div><span>Impuestos trasladados</span><span>{money(i.total_traslados)}</span></div>
            {Number(i.total_retenciones) ? <div><span>Retenciones</span><span>-{money(i.total_retenciones)}</span></div> : null}
            <div className="grand"><span>Total</span><span>{money(i.total)}</span></div>
            <div><span>Cobrado</span><span>{money(i.paid_amount)}</span></div>
            <div><span>Saldo</span><span className={due > 0.005 ? "tone-warning" : "tone-success"}>{money(due)}</span></div>
          </div>
        </Card>
      </div>
      <Card title="Conceptos">
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>ClaveProdServ</th><th>Descripción</th><th>Unidad</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Descuento</th><th className="num">Base</th><th className="num">IVA</th><th className="num">Total</th></tr></thead>
            <tbody>
              {i.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.line_no}</td><td className="mono">{l.clave_prod_serv}</td><td>{l.description}</td><td>{l.clave_unidad}</td>
                  <td className="num">{qty(l.qty, 4)}</td><td className="num">{money(l.unit_price)}</td><td className="num">{money(l.discount)}</td>
                  <td className="num">{money(l.base)}</td><td className="num">{money(l.iva_amount)} <span className="muted small">{qty(Number(l.iva_rate) * 100)}%</span></td><td className="num">{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Cobros">
        {i.payments.length === 0 ? <p className="muted">Sin cobros registrados.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Forma de pago</th><th>Referencia</th><th className="num">Importe</th></tr></thead>
              <tbody>{i.payments.map((p) => <tr key={p.id}><td>{date(p.paid_on)}</td><td>{p.forma_pago}</td><td>{p.reference}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {i.metodo_pago === "PPD" && i.payments.length > 0 ? <p className="muted small">Factura PPD: cada cobro requiere su complemento de pago (REP).</p> : null}
      </Card>

      <Modal title="Registrar cobro" open={payOpen} onClose={() => setPayOpen(false)}>
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
      <Modal title="Cancelar CFDI" open={cancelOpen} onClose={() => setCancelOpen(false)}>
        <form onSubmit={submitCancel}>
          <div className="form-grid">
            <Field label="Motivo de cancelación" wide>
              <select value={cancel.motivo} onChange={(e) => setCancel({ ...cancel, motivo: e.target.value })}>
                {CANCEL_MOTIVOS.map((m) => <option key={m.code} value={m.code}>{m.code} — {m.description}</option>)}
              </select>
            </Field>
            {cancel.motivo === "01" ? (
              <Field label="UUID que sustituye" wide><input required className="mono" value={cancel.folioSustitucion} onChange={(e) => setCancel({ ...cancel, folioSustitucion: e.target.value })} /></Field>
            ) : null}
          </div>
          <p className="muted small">La cancelación revierte la póliza y, si aplica, la salida de inventario.</p>
          <ErrorBox error={action.error} />
          <div className="form-actions"><button type="button" className="btn" onClick={() => setCancelOpen(false)}>Cerrar</button><button className="btn btn-danger" disabled={action.busy}>Cancelar factura</button></div>
        </form>
      </Modal>
    </>
  );
}

export default function InvoiceViewPage() {
  return (
    <>
      <p className="small"><Link href="/invoices/">← Facturas</Link></p>
      <Suspense fallback={<Loading />}><InvoiceInner /></Suspense>
    </>
  );
}
