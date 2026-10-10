"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { date, money, today } from "@/lib/format";
import { Card, Empty, ErrorBox, Field, Loading, PageHeader, useData } from "@/components/ui";
import { AccountingNav } from "@/components/AccountingNav";

export default function LedgerPage() {
  const accounts = useData(() => api().accounts());
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const ledger = useData(() => (account ? api().ledger(account, from, to) : Promise.resolve(null)), [account, from, to]);
  const l = ledger.data;

  return (
    <>
      <PageHeader title="Auxiliar de cuenta" />
      <AccountingNav />
      <Card>
        <div className="inline-fields" style={{ marginBottom: 12 }}>
          <Field label="Cuenta">
            <select value={account} onChange={(e) => setAccount(e.target.value)} style={{ minWidth: 300 }}>
              <option value="">Selecciona…</option>
              {(accounts.data ?? []).map((a) => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </Field>
          <Field label="Desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <ErrorBox error={ledger.error ?? accounts.error} />
        {!account ? <Empty>Selecciona una cuenta.</Empty> : null}
        {account && ledger.loading && !l ? <Loading /> : null}
        {l ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Diario</th><th>Concepto</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                <tr><td colSpan={5}><em>Saldo inicial</em></td><td className="num">{money(l.openingBalance)}</td></tr>
                {l.lines.map((x, i) => (
                  <tr key={i}>
                    <td className="nowrap">{date(x.date)}</td><td>{x.journal}</td>
                    <td><Link href={`/accounting/entries/view/?id=${x.entryId}`}>{x.concept}</Link></td>
                    <td className="num">{Number(x.debit) ? money(x.debit) : ""}</td><td className="num">{Number(x.credit) ? money(x.credit) : ""}</td><td className="num">{money(x.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>Saldo final — {l.account.code} {l.account.name}</td><td className="num">{money(l.closingBalance)}</td></tr></tfoot>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}
