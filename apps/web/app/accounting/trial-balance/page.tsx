"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Card, Empty, ErrorBox, Loading, PageHeader, YearMonthPicker, useData } from "@/components/ui";
import { AccountingNav } from "@/components/AccountingNav";

export default function TrialBalancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [onlyMoves, setOnlyMoves] = useState(true);
  const tb = useData(() => api().trialBalance(year, month), [year, month]);
  const rows = (tb.data ?? []).filter((r) => !onlyMoves || Number(r.saldoIni) || Number(r.debe) || Number(r.haber) || Number(r.saldoFin));
  const top = (tb.data ?? []).filter((r) => r.level === 1);
  const sum = (k: "debe" | "haber") => top.reduce((s, r) => s + Number(r[k]), 0);

  return (
    <>
      <PageHeader title="Balanza de comprobación" />
      <AccountingNav />
      <Card>
        <div className="inline-fields" style={{ marginBottom: 12 }}>
          <YearMonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
          <label className="checkbox" style={{ paddingBottom: 8 }}><input type="checkbox" checked={onlyMoves} onChange={(e) => setOnlyMoves(e.target.checked)} /> Solo cuentas con saldo o movimientos</label>
        </div>
        <ErrorBox error={tb.error} />
        {tb.loading && !tb.data ? <Loading /> : null}
        {tb.data && rows.length === 0 ? <Empty>Sin saldos en el periodo.</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Cuenta</th><th>Nombre</th><th>Cód. SAT</th><th className="num">Saldo inicial</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo final</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.accountId} className={r.level === 1 ? "level-1" : ""}>
                    <td className="mono nowrap" style={{ paddingLeft: 10 + (r.level - 1) * 14 }}>{r.code}</td><td>{r.name}</td><td className="mono small">{r.satCode}</td>
                    <td className="num">{money(r.saldoIni)}</td><td className="num">{money(r.debe)}</td><td className="num">{money(r.haber)}</td><td className="num">{money(r.saldoFin)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>Totales (cuentas de mayor)</td><td className="num">{money(sum("debe"))}</td><td className="num">{money(sum("haber"))}</td><td /></tr></tfoot>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}
