"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { MANUAL_JOURNALS, money, today } from "@/lib/format";
import { Card, ErrorBox, Field, PageHeader, useAction, useData } from "@/components/ui";
import { AccountingNav } from "@/components/AccountingNav";

interface Line { key: number; accountCode: string; debit: string; credit: string; description: string }
let k = 1;
const newLine = (): Line => ({ key: k++, accountCode: "", debit: "", credit: "", description: "" });

export default function NewEntryPage() {
  const router = useRouter();
  const accounts = useData(() => api().accounts());
  const [head, setHead] = useState({ journal: "OD", date: today(), concept: "" });
  const [lines, setLines] = useState<Line[]>([newLine(), newLine()]);
  const action = useAction();
  const postable = (accounts.data ?? []).filter((a) => a.postable);
  const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(debit - credit) < 0.005 && debit > 0;
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save() {
    const r = await action.run(() => api().createJournalEntry({
      journal: head.journal, date: head.date, concept: head.concept,
      lines: lines.filter((l) => l.accountCode).map((l) => ({ accountCode: l.accountCode, debit: l.debit || undefined, credit: l.credit || undefined, description: l.description || undefined })),
    }));
    if (r) router.push(`/accounting/entries/view/?id=${r.id}`);
  }

  return (
    <>
      <PageHeader title="Nueva póliza manual" />
      <AccountingNav />
      <ErrorBox error={accounts.error} />
      <Card>
        <div className="form-grid">
          <Field label="Diario">
            <select value={head.journal} onChange={(e) => setHead({ ...head, journal: e.target.value })}>
              {MANUAL_JOURNALS.map((j) => <option key={j.code} value={j.code}>{j.code} — {j.name}</option>)}
            </select>
          </Field>
          <Field label="Fecha"><input type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} /></Field>
          <Field label="Concepto" wide><input required value={head.concept} onChange={(e) => setHead({ ...head, concept: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Movimientos" actions={<button className="btn btn-sm" onClick={() => setLines((ls) => [...ls, newLine()])}>+ Agregar renglón</button>}>
        <datalist id="accounts-list">{postable.map((a) => <option key={a.id} value={a.code}>{a.name}</option>)}</datalist>
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ minWidth: 260 }}>Cuenta</th><th>Descripción</th><th className="num">Debe</th><th className="num">Haber</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => {
                const acc = postable.find((a) => a.code === l.accountCode);
                return (
                  <tr key={l.key}>
                    <td>
                      <input list="accounts-list" className="mono" value={l.accountCode} onChange={(e) => setLine(l.key, { accountCode: e.target.value })} placeholder="Código de cuenta" />
                      <div className="small muted">{acc ? acc.name : l.accountCode ? "Cuenta no afectable o inexistente" : ""}</div>
                    </td>
                    <td><input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} /></td>
                    <td><input type="number" step="0.01" min="0" value={l.debit} onChange={(e) => setLine(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} style={{ width: 130, textAlign: "right" }} /></td>
                    <td><input type="number" step="0.01" min="0" value={l.credit} onChange={(e) => setLine(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} style={{ width: 130, textAlign: "right" }} /></td>
                    <td><button className="btn btn-ghost btn-sm" aria-label="Quitar" onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((x) => x.key !== l.key) : ls))}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Sumas {balanced ? <span className="chip chip-success">Cuadrada</span> : <span className="chip chip-warning">Diferencia {money(debit - credit)}</span>}</td><td className="num">{money(debit)}</td><td className="num">{money(credit)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <ErrorBox error={action.error} />
      <div className="form-actions">
        <button className="btn" onClick={() => router.push("/accounting/entries/")}>Cancelar</button>
        <button className="btn btn-primary" disabled={!balanced || !head.concept || action.busy} onClick={save}>{action.busy ? "Guardando…" : "Guardar póliza"}</button>
      </div>
    </>
  );
}
