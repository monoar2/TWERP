"use client";
import Link from "next/link";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { Card, Empty, ErrorBox, Loading, PageHeader, StatusChip, useData } from "@/components/ui";

export default function PurchasesPage() {
  const list = useData(() => api().supplierInvoices());
  const rows = list.data ?? [];
  const due = rows.filter((r) => r.status === "validated").reduce((s, r) => s + Number(r.total) - Number(r.paid_amount), 0);
  return (
    <>
      <PageHeader title="Facturas de proveedor" subtitle={`Saldo por pagar: ${money(due)}`} actions={<><Link className="btn" href="/purchases/intake/">Subir factura (IA)</Link><Link className="btn btn-primary" href="/purchases/new/">Nueva compra</Link></>} />
      <Card>
        <ErrorBox error={list.error} />
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && rows.length === 0 ? <Empty>No hay facturas de proveedor.</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Fecha</th><th>Proveedor</th><th>Ref. proveedor</th><th>UUID</th><th className="num">Subtotal</th><th className="num">IVA</th><th className="num">Total</th><th className="num">Pagado</th><th>Estado</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/purchases/view/?id=${r.id}`}>{r.id}</Link></td><td className="nowrap">{date(r.issue_date)}</td>
                    <td><Link href={`/purchases/view/?id=${r.id}`}>{r.supplier_name}</Link></td><td>{r.supplier_ref}</td>
                    <td className="mono small">{r.uuid ? `${r.uuid.slice(0, 8)}…` : ""}</td>
                    <td className="num">{money(r.subtotal)}</td><td className="num">{money(r.iva)}</td><td className="num">{money(r.total)}</td><td className="num">{money(r.paid_amount)}</td>
                    <td><StatusChip status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}
