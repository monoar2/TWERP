"use client";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { Card, ErrorBox, Loading, PageHeader, StatusChip, useData } from "@/components/ui";
import { AccountingNav } from "@/components/AccountingNav";

function EntryInner() {
  const id = Number(useSearchParams().get("id"));
  const entry = useData(() => api().journalEntry(id), [id]);
  if (!id) return <ErrorBox error={new Error("Falta el parámetro id")} />;
  if (entry.loading && !entry.data) return <Loading />;
  if (!entry.data) return <ErrorBox error={entry.error} />;
  const e = entry.data;
  const debit = e.lines.reduce((s, l) => s + Number(l.debit), 0);
  const credit = e.lines.reduce((s, l) => s + Number(l.credit), 0);
  const sourceLink = e.source_type === "sales_invoice" && e.source_id ? `/invoices/view/?id=${e.source_id}` : e.source_type === "supplier_invoice" && e.source_id ? `/purchases/view/?id=${e.source_id}` : null;
  return (
    <>
      <PageHeader title={`Póliza ${e.journal_code} ${e.number ?? `#${e.id}`}`} subtitle={<>{date(e.entry_date)} · <StatusChip status={e.status} /> · {e.concept}</>}
        actions={sourceLink ? <Link className="btn" href={sourceLink}>Ver documento origen</Link> : null} />
      <Card>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Cuenta</th><th>Nombre</th><th>Descripción</th><th>UUID CFDI</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.line_no}</td><td className="mono">{l.code}</td><td>{l.name}</td><td>{l.description}</td>
                  <td className="mono small">{l.cfdi_uuid ?? ""}</td>
                  <td className="num">{Number(l.debit) ? money(l.debit) : ""}</td><td className="num">{Number(l.credit) ? money(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}>Sumas iguales</td><td className="num">{money(debit)}</td><td className="num">{money(credit)}</td></tr></tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}

export default function EntryViewPage() {
  return (
    <>
      <AccountingNav />
      <Suspense fallback={<Loading />}><EntryInner /></Suspense>
    </>
  );
}
