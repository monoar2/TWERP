"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { JOURNALS, date, firstOfMonth, money, today } from "@/lib/format";
import { Card, Empty, ErrorBox, Field, Loading, PageHeader, StatusChip, useData } from "@/components/ui";
import { AccountingNav } from "@/components/AccountingNav";

const SOURCES: Record<string, string> = { manual: "Manual", sales_invoice: "Factura", supplier_invoice: "Compra", payment: "Pago", stock_movement: "Inventario" };

export default function EntriesPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [journal, setJournal] = useState("");
  const list = useData(() => api().journalEntries({ from, to, journal: journal || undefined, limit: 500 }), [from, to, journal]);
  const rows = list.data ?? [];
  return (
    <>
      <PageHeader title="Pólizas" subtitle="Diario general" actions={<Link className="btn btn-primary" href="/accounting/entries/new/">Nueva póliza manual</Link>} />
      <AccountingNav />
      <Card>
        <div className="inline-fields" style={{ marginBottom: 12 }}>
          <Field label="Desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Diario">
            <select value={journal} onChange={(e) => setJournal(e.target.value)}>
              <option value="">Todos</option>
              {JOURNALS.map((j) => <option key={j.code} value={j.code}>{j.code} — {j.name}</option>)}
            </select>
          </Field>
        </div>
        <ErrorBox error={list.error} />
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && rows.length === 0 ? <Empty>Sin pólizas en el periodo.</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Diario</th><th>Número</th><th>Concepto</th><th>Origen</th><th className="num">Importe</th><th>Estado</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{date(e.entry_date)}</td><td>{e.journal_code}</td>
                    <td><Link href={`/accounting/entries/view/?id=${e.id}`}>{e.number ?? `#${e.id}`}</Link></td>
                    <td><Link href={`/accounting/entries/view/?id=${e.id}`}>{e.concept}</Link></td>
                    <td className="small">{e.source_type ? SOURCES[e.source_type] ?? e.source_type : ""}</td>
                    <td className="num">{money(e.amount)}</td><td><StatusChip status={e.status} /></td>
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
