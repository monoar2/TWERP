"use client";
import { useState, type FormEvent } from "react";
import { api, satCatalogs } from "@/lib/api";
import { Card, Empty, ErrorBox, Field, Loading, Notice, PageHeader, useAction, useData } from "@/components/ui";

const emptyForm = { name: "", rfc: "", regimenFiscal: "601", codigoPostal: "", usoCfdi: "G03", isCustomer: true, isSupplier: false, email: "", phone: "" };

export default function ThirdPartiesPage() {
  const [role, setRole] = useState<"" | "customer" | "supplier">("");
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [notice, setNotice] = useState("");
  const list = useData(() => api().thirdParties({ role: role || undefined, q: q || undefined }), [role, q]);
  const cats = useData(() => satCatalogs());
  const action = useAction();

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const rfcLen = form.rfc.trim().length;
  const persona = rfcLen === 12 ? "moral" : rfcLen === 13 ? "fisica" : null;
  const regimenes = (cats.data?.regimenesFiscales ?? []).filter((r) => !persona || (persona === "moral" ? r.moral : r.fisica));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const created = await action.run(() => api().createThirdParty({
      ...form,
      rfc: form.rfc.trim().toUpperCase(),
      email: form.email || undefined,
      phone: form.phone || undefined,
    }));
    if (created) {
      setNotice(`Tercero «${created.name}» creado.`);
      setForm(emptyForm);
      setShowForm(false);
      void list.reload();
    }
  }

  return (
    <>
      <PageHeader title="Terceros" subtitle="Clientes y proveedores"
        actions={<button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cerrar" : "Nuevo tercero"}</button>} />
      <Notice>{notice}</Notice>
      {showForm ? (
        <Card title="Nuevo tercero">
          <form onSubmit={submit}>
            <div className="form-grid">
              <Field label="Nombre / Razón social" wide><input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Sin régimen societario (p. ej. sin «S.A. de C.V.»)" /></Field>
              <Field label="RFC" hint={persona ? `Persona ${persona === "moral" ? "moral" : "física"}` : "12 (moral) o 13 (física) caracteres"}>
                <input required value={form.rfc} maxLength={13} onChange={(e) => set("rfc", e.target.value.toUpperCase())} className="mono" />
              </Field>
              <Field label="Régimen fiscal">
                <select value={form.regimenFiscal} onChange={(e) => set("regimenFiscal", e.target.value)}>
                  {regimenes.map((r) => <option key={r.code} value={r.code}>{r.code} — {r.description}</option>)}
                </select>
              </Field>
              <Field label="Código postal (domicilio fiscal)"><input required pattern="\d{5}" maxLength={5} value={form.codigoPostal} onChange={(e) => set("codigoPostal", e.target.value)} /></Field>
              <Field label="Uso CFDI">
                <select value={form.usoCfdi} onChange={(e) => set("usoCfdi", e.target.value)}>
                  {(cats.data?.usosCfdi ?? []).map((u) => <option key={u.code} value={u.code}>{u.code} — {u.description}</option>)}
                </select>
              </Field>
              <Field label="Correo"><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Teléfono"><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
              <Field label="Tipo">
                <div className="inline-fields">
                  <label className="checkbox"><input type="checkbox" checked={form.isCustomer} onChange={(e) => set("isCustomer", e.target.checked)} /> Cliente</label>
                  <label className="checkbox"><input type="checkbox" checked={form.isSupplier} onChange={(e) => set("isSupplier", e.target.checked)} /> Proveedor</label>
                </div>
              </Field>
            </div>
            <ErrorBox error={action.error ?? cats.error} />
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="btn btn-primary" disabled={action.busy}>{action.busy ? "Guardando…" : "Guardar"}</button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card>
        <div className="inline-fields" style={{ marginBottom: 12 }}>
          <Field label="Buscar"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o RFC" /></Field>
          <Field label="Tipo">
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="">Todos</option><option value="customer">Clientes</option><option value="supplier">Proveedores</option>
            </select>
          </Field>
        </div>
        <ErrorBox error={list.error} />
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && list.data.length === 0 ? <Empty>No hay terceros.</Empty> : null}
        {list.data && list.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nombre</th><th>RFC</th><th>Régimen</th><th>C.P.</th><th>Uso CFDI</th><th>Tipo</th><th>Contacto</th></tr></thead>
              <tbody>
                {list.data.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td><td className="mono">{t.rfc}</td><td>{t.regimen_fiscal}</td><td>{t.codigo_postal}</td><td>{t.uso_cfdi}</td>
                    <td>
                      {t.is_customer ? <span className="chip chip-info">Cliente</span> : null}{" "}
                      {t.is_supplier ? <span className="chip chip-neutral">Proveedor</span> : null}
                    </td>
                    <td className="small">{[t.email, t.phone].filter(Boolean).join(" · ")}</td>
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
