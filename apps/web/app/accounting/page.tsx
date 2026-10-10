"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Card, Empty, ErrorBox, Field, Loading, Notice, PageHeader, useAction, useData } from "@/components/ui";
import { AccountingNav } from "@/components/AccountingNav";

const KINDS: Record<string, string> = { asset: "Activo", liability: "Pasivo", equity: "Capital", income: "Ingresos", cost: "Costos", expense: "Gastos", memo: "Orden" };

export default function AccountsPage() {
  const accounts = useData(() => api().accounts());
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", parentCode: "", satCode: "" });
  const [notice, setNotice] = useState("");
  const action = useAction();
  const filtered = (accounts.data ?? []).filter((a) => !q || a.code.startsWith(q) || a.name.toLowerCase().includes(q.toLowerCase()) || a.sat_code.startsWith(q));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await action.run(() => api().createAccount({ code: form.code, name: form.name, parentCode: form.parentCode, satCode: form.satCode || undefined }));
    if (r) { setNotice(`Cuenta ${r.code} creada.`); setForm({ code: "", name: "", parentCode: "", satCode: "" }); setShowForm(false); void accounts.reload(); }
  }

  return (
    <>
      <PageHeader title="Contabilidad" subtitle="Catálogo de cuentas con código agrupador del SAT"
        actions={<button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cerrar" : "Nueva subcuenta"}</button>} />
      <AccountingNav />
      <Notice>{notice}</Notice>
      {showForm ? (
        <Card title="Nueva subcuenta">
          <form onSubmit={submit}>
            <div className="form-grid">
              <Field label="Cuenta padre">
                <select required value={form.parentCode} onChange={(e) => setForm({ ...form, parentCode: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {(accounts.data ?? []).map((a) => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </Field>
              <Field label="Código"><input required className="mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={form.parentCode ? `${form.parentCode}.01` : ""} /></Field>
              <Field label="Nombre"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Código agrupador SAT" hint="Vacío = el de la cuenta padre"><input className="mono" value={form.satCode} onChange={(e) => setForm({ ...form, satCode: e.target.value })} /></Field>
            </div>
            <ErrorBox error={action.error} />
            <div className="form-actions"><button className="btn btn-primary" disabled={action.busy}>Crear cuenta</button></div>
          </form>
        </Card>
      ) : null}
      <Card>
        <div className="inline-fields" style={{ marginBottom: 12 }}>
          <Field label="Buscar"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre o código SAT" /></Field>
        </div>
        <ErrorBox error={accounts.error} />
        {accounts.loading && !accounts.data ? <Loading /> : null}
        {accounts.data && filtered.length === 0 ? <Empty>Sin cuentas.</Empty> : null}
        {filtered.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Naturaleza</th><th>Cód. agrupador SAT</th><th>Descripción SAT</th><th>Afectable</th></tr></thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className={a.level === 1 ? "level-1" : ""}>
                    <td className="mono nowrap" style={{ paddingLeft: 10 + (a.level - 1) * 14 }}>{a.code}</td>
                    <td style={{ paddingLeft: 10 + (a.level - 1) * 14 }}>{a.name}</td>
                    <td>{KINDS[a.kind] ?? a.kind}</td><td>{a.nature === "D" ? "Deudora" : "Acreedora"}</td>
                    <td className="mono">{a.sat_code}</td><td className="small muted">{a.sat_description}</td>
                    <td>{a.postable ? "Sí" : ""}</td>
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
