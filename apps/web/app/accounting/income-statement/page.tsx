"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { date, money, today } from "@/lib/format";
import { Card, ErrorBox, Field, Kpi, Loading, PageHeader, useData } from "@/components/ui";
import { AccountingNav } from "@/components/AccountingNav";

const SECTIONS: Array<{ kind: string; label: string }> = [
  { kind: "income", label: "Ingresos" },
  { kind: "cost", label: "Costos" },
  { kind: "expense", label: "Gastos" },
];

export default function IncomeStatementPage() {
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const is = useData(() => api().incomeStatement(from, to), [from, to]);
  const d = is.data;
  return (
    <>
      <PageHeader title="Estado de resultados" subtitle={d ? `Del ${date(d.from)} al ${date(d.to)}` : undefined} />
      <AccountingNav />
      <div className="inline-fields" style={{ marginBottom: 16 }}>
        <Field label="Desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Hasta"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <ErrorBox error={is.error} />
      {is.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <div className="kpis">
            <Kpi label="Ingresos" value={money(d.income)} />
            <Kpi label="Costos" value={money(d.costs)} />
            <Kpi label="Utilidad bruta" value={money(d.grossProfit)} />
            <Kpi label="Gastos" value={money(d.expenses)} />
            <Kpi label="Utilidad neta" value={money(d.netProfit)} tone={Number(d.netProfit) < 0 ? "danger" : undefined} />
          </div>
          <Card>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Cuenta</th><th>Nombre</th><th className="num">Importe</th></tr></thead>
                {SECTIONS.map((s) => {
                  const rows = d.accounts.filter((a) => a.kind === s.kind);
                  return (
                    <tbody key={s.kind}>
                      <tr className="level-1"><td colSpan={3}>{s.label}</td></tr>
                      {rows.length === 0 ? <tr><td colSpan={3} className="muted">Sin movimientos</td></tr> : rows.map((a) => (
                        <tr key={a.code}><td className="mono">{a.code}</td><td>{a.name}</td><td className="num">{money(a.amount)}</td></tr>
                      ))}
                    </tbody>
                  );
                })}
                <tfoot><tr><td colSpan={2}>Utilidad (pérdida) neta</td><td className="num">{money(d.netProfit)}</td></tr></tfoot>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </>
  );
}
