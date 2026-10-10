"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { date, folio, money } from "@/lib/format";
import { Card, Empty, ErrorBox, Field, Loading, PageHeader, StatusChip, useData } from "@/components/ui";

function InvoicesInner() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [customerId, setCustomerId] = useState<number | "">("");
  const customers = useData(() => api().thirdParties({ role: "customer" }));
  const list = useData(() => api().salesInvoices({ status: status || undefined, customerId: customerId || undefined }), [status, customerId]);
  const rows = list.data ?? [];
  const totals = rows.filter((r) => r.status === "stamped").reduce((a, r) => ({ total: a.total + Number(r.total), due: a.due + Number(r.total) - Number(r.paid_amount) }), { total: 0, due: 0 });

  return (
    <Card>
      <div className="inline-fields" style={{ marginBottom: 12 }}>
        <Field label="Estado">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option><option value="draft">Borrador</option><option value="stamped">Timbrada</option><option value="cancelled">Cancelada</option>
          </select>
        </Field>
        <Field label="Cliente">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Todos</option>
            {(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && rows.length === 0 ? <Empty>No hay facturas. <Link href="/invoices/new/">Crea la primera</Link>.</Empty> : null}
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>RFC</th><th>Método</th><th className="num">Total</th><th className="num">Pagado</th><th>Estado</th><th>Cobro</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const paid = Number(r.paid_amount);
                const pay = r.status !== "stamped" ? null : paid >= Number(r.total) - 0.005 ? "paid" : paid > 0 ? "partial" : "unpaid";
                return (
                  <tr key={r.id}>
                    <td><Link href={`/invoices/view/?id=${r.id}`} className="mono">{folio(r)}</Link></td>
                    <td className="nowrap">{date(r.issue_date)}</td><td>{r.customer_name}</td><td className="mono small">{r.customer_rfc}</td>
                    <td>{r.metodo_pago}</td><td className="num">{money(r.total)}</td><td className="num">{money(r.paid_amount)}</td>
                    <td><StatusChip status={r.status} /></td>
                    <td>{pay ? <StatusChip status={pay} label={pay === "paid" ? "Pagada" : pay === "partial" ? "Parcial" : "Pendiente"} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={5}>Timbradas: total / saldo pendiente</td><td className="num">{money(totals.total)}</td><td className="num">{money(totals.due)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

export default function InvoicesPage() {
  return (
    <>
      <PageHeader title="Facturas de cliente" subtitle="CFDI 4.0 de ingreso" actions={<Link className="btn btn-primary" href="/invoices/new/">Nueva factura</Link>} />
      <Suspense fallback={<Loading />}><InvoicesInner /></Suspense>
    </>
  );
}
