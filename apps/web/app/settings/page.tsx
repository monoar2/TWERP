"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api, DEFAULT_API_TOKEN, DEFAULT_API_URL, loadSettings, satCatalogs, saveSettings } from "@/lib/api";
import { Card, ErrorBox, Field, Notice, PageHeader, useAction, useData } from "@/components/ui";

type CompanyForm = { rfc: string; razonSocial: string; regimenFiscal: string; codigoPostal: string; invoiceSerie: string; allowNegativeStock: boolean };

export default function SettingsPage() {
  const [conn, setConn] = useState({ apiUrl: "", token: "" });
  const [connNotice, setConnNotice] = useState("");
  const connAction = useAction();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { setConn(loadSettings()); }, []);

  const company = useData(() => api().company(), [reloadKey]);
  const cats = useData(() => satCatalogs(), [reloadKey]);
  const warehouses = useData(() => api().warehouses(), [reloadKey]);
  const banks = useData(() => api().bankAccounts(), [reloadKey]);
  const [form, setForm] = useState<CompanyForm>({ rfc: "", razonSocial: "", regimenFiscal: "601", codigoPostal: "", invoiceSerie: "A", allowNegativeStock: false });
  const [companyNotice, setCompanyNotice] = useState("");
  const companyAction = useAction();
  const [wh, setWh] = useState({ code: "", name: "", address: "" });
  const [bank, setBank] = useState({ name: "", bank: "", clabe: "", accountCode: "" });
  const [miscNotice, setMiscNotice] = useState("");
  const miscAction = useAction();

  useEffect(() => {
    const c = company.data;
    if (c) setForm({
      rfc: String(c.rfc ?? ""), razonSocial: String(c.razon_social ?? ""), regimenFiscal: String(c.regimen_fiscal ?? "601"),
      codigoPostal: String(c.codigo_postal ?? ""), invoiceSerie: String(c.invoice_serie ?? "A"), allowNegativeStock: Boolean(c.allow_negative_stock),
    });
  }, [company.data]);

  async function saveConn(e: FormEvent) {
    e.preventDefault();
    saveSettings({ apiUrl: conn.apiUrl.trim(), token: conn.token.trim() });
    setConnNotice("");
    const ok = await connAction.run(async () => { await api().satCatalogs(); return true; });
    if (ok) setConnNotice("Conexión guardada y verificada.");
    setReloadKey((k) => k + 1);
  }
  function resetConn() {
    saveSettings({});
    setConn({ apiUrl: DEFAULT_API_URL, token: DEFAULT_API_TOKEN });
    setConnNotice("Se restauraron los valores predeterminados.");
    setReloadKey((k) => k + 1);
  }
  async function saveCompany(e: FormEvent) {
    e.preventDefault();
    const body: Parameters<ReturnType<typeof api>["saveCompany"]>[0] & { allowNegativeStock: boolean } = { ...form, rfc: form.rfc.trim().toUpperCase() };
    const ok = await companyAction.run(() => api().saveCompany(body));
    if (ok !== undefined) { setCompanyNotice("Datos fiscales guardados."); void company.reload(); }
  }
  async function addWarehouse(e: FormEvent) {
    e.preventDefault();
    const ok = await miscAction.run(() => api().createWarehouse({ code: wh.code, name: wh.name, address: wh.address || undefined }));
    if (ok) { setMiscNotice(`Almacén ${ok.code} creado.`); setWh({ code: "", name: "", address: "" }); void warehouses.reload(); }
  }
  async function addBank(e: FormEvent) {
    e.preventDefault();
    const ok = await miscAction.run(() => api().createBankAccount({ name: bank.name, bank: bank.bank || undefined, clabe: bank.clabe || undefined, accountCode: bank.accountCode || undefined }));
    if (ok) { setMiscNotice(`Cuenta bancaria «${ok.name}» creada.`); setBank({ name: "", bank: "", clabe: "", accountCode: "" }); void banks.reload(); }
  }

  const persona = form.rfc.trim().length === 12 ? "moral" : form.rfc.trim().length === 13 ? "fisica" : null;
  const regimenes = (cats.data?.regimenesFiscales ?? []).filter((r) => !persona || (persona === "moral" ? r.moral : r.fisica));

  return (
    <>
      <PageHeader title="Configuración" />
      <Card title="Conexión con la API">
        <form onSubmit={saveConn}>
          <div className="form-grid">
            <Field label="URL de la API" hint={`Predeterminada: ${DEFAULT_API_URL}`}><input required value={conn.apiUrl} onChange={(e) => setConn({ ...conn, apiUrl: e.target.value })} className="mono" /></Field>
            <Field label="Token (Bearer)" hint="Opcional; se guarda solo en este navegador"><input type="password" value={conn.token} onChange={(e) => setConn({ ...conn, token: e.target.value })} autoComplete="off" /></Field>
          </div>
          <Notice>{connNotice}</Notice>
          <ErrorBox error={connAction.error} />
          <div className="form-actions">
            <button type="button" className="btn" onClick={resetConn}>Restaurar</button>
            <button className="btn btn-primary" disabled={connAction.busy}>Guardar y probar</button>
          </div>
        </form>
      </Card>
      <Card title="Datos fiscales de la empresa (emisor)">
        <form onSubmit={saveCompany}>
          <div className="form-grid">
            <Field label="RFC"><input required maxLength={13} className="mono" value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value.toUpperCase() })} /></Field>
            <Field label="Razón social" hint="Tal como aparece en la Constancia de Situación Fiscal, sin régimen societario"><input required value={form.razonSocial} onChange={(e) => setForm({ ...form, razonSocial: e.target.value })} /></Field>
            <Field label="Régimen fiscal">
              <select value={form.regimenFiscal} onChange={(e) => setForm({ ...form, regimenFiscal: e.target.value })}>
                {regimenes.map((r) => <option key={r.code} value={r.code}>{r.code} — {r.description}</option>)}
              </select>
            </Field>
            <Field label="Código postal (lugar de expedición)"><input required pattern="\d{5}" maxLength={5} value={form.codigoPostal} onChange={(e) => setForm({ ...form, codigoPostal: e.target.value })} /></Field>
            <Field label="Serie de facturas"><input value={form.invoiceSerie} onChange={(e) => setForm({ ...form, invoiceSerie: e.target.value.toUpperCase() })} /></Field>
            <Field label="Inventario">
              <label className="checkbox"><input type="checkbox" checked={form.allowNegativeStock} onChange={(e) => setForm({ ...form, allowNegativeStock: e.target.checked })} /> Permitir existencias negativas</label>
            </Field>
          </div>
          <Notice>{companyNotice}</Notice>
          <ErrorBox error={companyAction.error ?? company.error} />
          <div className="form-actions"><button className="btn btn-primary" disabled={companyAction.busy}>Guardar datos fiscales</button></div>
        </form>
      </Card>
      <Notice>{miscNotice}</Notice>
      <ErrorBox error={miscAction.error} />
      <div className="grid grid-2">
        <Card title="Almacenes">
          <ErrorBox error={warehouses.error} />
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead><tr><th>Código</th><th>Nombre</th><th>Dirección</th></tr></thead>
              <tbody>{(warehouses.data ?? []).map((w) => <tr key={w.id}><td className="mono">{w.code}</td><td>{w.name}</td><td className="small">{w.address}</td></tr>)}</tbody>
            </table>
          </div>
          <form onSubmit={addWarehouse} className="form-grid">
            <Field label="Código"><input required value={wh.code} onChange={(e) => setWh({ ...wh, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Nombre"><input required value={wh.name} onChange={(e) => setWh({ ...wh, name: e.target.value })} /></Field>
            <Field label="Dirección" wide><input value={wh.address} onChange={(e) => setWh({ ...wh, address: e.target.value })} /></Field>
            <div className="field-wide form-actions" style={{ marginTop: 0 }}><button className="btn" disabled={miscAction.busy}>Agregar almacén</button></div>
          </form>
        </Card>
        <Card title="Cuentas bancarias">
          <ErrorBox error={banks.error} />
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead><tr><th>Nombre</th><th>Banco</th><th>CLABE</th><th>Cuenta contable</th></tr></thead>
              <tbody>{(banks.data ?? []).map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.bank}</td><td className="mono small">{b.clabe}</td><td className="mono">{b.account_code}</td></tr>)}</tbody>
            </table>
          </div>
          <form onSubmit={addBank} className="form-grid">
            <Field label="Nombre"><input required value={bank.name} onChange={(e) => setBank({ ...bank, name: e.target.value })} /></Field>
            <Field label="Banco"><input value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} /></Field>
            <Field label="CLABE"><input pattern="\d{18}" maxLength={18} className="mono" value={bank.clabe} onChange={(e) => setBank({ ...bank, clabe: e.target.value })} /></Field>
            <Field label="Cuenta contable" hint="Cuenta de detalle; vacío = 102.01"><input className="mono" value={bank.accountCode} onChange={(e) => setBank({ ...bank, accountCode: e.target.value })} /></Field>
            <div className="field-wide form-actions" style={{ marginTop: 0 }}><button className="btn" disabled={miscAction.busy}>Agregar cuenta</button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
