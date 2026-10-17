"use client";
import { useEffect, useState, type FormEvent } from "react";
import { canAccess } from "@erp/client";
import { api, loadSettings, satCatalogs } from "@/lib/api";
import { date, dateTime } from "@/lib/format";
import { useProfile } from "@/components/Shell";
import { Card, ErrorBox, Field, Loading, Notice, PageHeader, useAction, useData } from "@/components/ui";

type CompanyForm = { rfc: string; razonSocial: string; regimenFiscal: string; codigoPostal: string; invoiceSerie: string; allowNegativeStock: boolean };

export default function SettingsPage() {
  const profile = useProfile();
  const readCompany = canAccess(profile, "company");
  const writeCompany = canAccess(profile, "company", true);
  const readInventory = canAccess(profile, "inventory");
  const readBanks = canAccess(profile, "banks");
  const skip = Promise.resolve(undefined);

  const company = useData(() => (readCompany ? api().company() : skip), [readCompany]);
  const cats = useData(() => (readCompany ? satCatalogs() : skip), [readCompany]);
  const warehouses = useData(() => (readInventory ? api().warehouses() : skip), [readInventory]);
  const banks = useData(() => (readBanks ? api().bankAccounts() : skip), [readBanks]);
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
      <AccountCard />
      {readCompany ? <Card title="Datos fiscales de la empresa (emisor)">
        <form onSubmit={saveCompany}>
          <fieldset className="plain" disabled={!writeCompany}>
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
          </fieldset>
          <Notice>{companyNotice}</Notice>
          <ErrorBox error={companyAction.error ?? company.error} />
          {writeCompany
            ? <div className="form-actions"><button className="btn btn-primary" disabled={companyAction.busy}>Guardar datos fiscales</button></div>
            : <p className="muted small">Solo el administrador puede modificar los datos fiscales.</p>}
        </form>
      </Card> : null}
      {readCompany ? <CsdCard canUpload={writeCompany} /> : null}
      <Notice>{miscNotice}</Notice>
      <ErrorBox error={miscAction.error} />
      <div className="grid grid-2">
        {readInventory ? <Card title="Almacenes">
          <ErrorBox error={warehouses.error} />
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead><tr><th>Código</th><th>Nombre</th><th>Dirección</th></tr></thead>
              <tbody>{(warehouses.data ?? []).map((w) => <tr key={w.id}><td className="mono">{w.code}</td><td>{w.name}</td><td className="small">{w.address}</td></tr>)}</tbody>
            </table>
          </div>
          {canAccess(profile, "inventory", true) ? <form onSubmit={addWarehouse} className="form-grid">
            <Field label="Código"><input required value={wh.code} onChange={(e) => setWh({ ...wh, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Nombre"><input required value={wh.name} onChange={(e) => setWh({ ...wh, name: e.target.value })} /></Field>
            <Field label="Dirección" wide><input value={wh.address} onChange={(e) => setWh({ ...wh, address: e.target.value })} /></Field>
            <div className="field-wide form-actions" style={{ marginTop: 0 }}><button className="btn" disabled={miscAction.busy}>Agregar almacén</button></div>
          </form> : null}
        </Card> : null}
        {readBanks ? <Card title="Cuentas bancarias">
          <ErrorBox error={banks.error} />
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead><tr><th>Nombre</th><th>Banco</th><th>CLABE</th><th>Cuenta contable</th></tr></thead>
              <tbody>{(banks.data ?? []).map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.bank}</td><td className="mono small">{b.clabe}</td><td className="mono">{b.account_code}</td></tr>)}</tbody>
            </table>
          </div>
          {canAccess(profile, "banks", true) ? <form onSubmit={addBank} className="form-grid">
            <Field label="Nombre"><input required value={bank.name} onChange={(e) => setBank({ ...bank, name: e.target.value })} /></Field>
            <Field label="Banco"><input value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} /></Field>
            <Field label="CLABE"><input pattern="\d{18}" maxLength={18} className="mono" value={bank.clabe} onChange={(e) => setBank({ ...bank, clabe: e.target.value })} /></Field>
            <Field label="Cuenta contable" hint="Cuenta de detalle; vacío = 102.01"><input className="mono" value={bank.accountCode} onChange={(e) => setBank({ ...bank, accountCode: e.target.value })} /></Field>
            <div className="field-wide form-actions" style={{ marginTop: 0 }}><button className="btn" disabled={miscAction.busy}>Agregar cuenta</button></div>
          </form> : null}
        </Card> : null}
      </div>
    </>
  );
}

const MIN_PASSWORD = 10;

/** The signed-in user, the server in use and a form to change one's own password. */
function AccountCard() {
  const profile = useProfile();
  const [apiUrl, setApiUrl] = useState("");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [notice, setNotice] = useState("");
  const action = useAction();
  useEffect(() => { setApiUrl(loadSettings().apiUrl); }, []);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setNotice("");
    if (pw.next.length < MIN_PASSWORD) { action.setError(new Error(`La nueva contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)); return; }
    if (pw.next !== pw.confirm) { action.setError(new Error("La confirmación no coincide con la nueva contraseña.")); return; }
    const ok = await action.run(() => api().changePassword(pw.current, pw.next));
    if (ok) { setNotice("Contraseña actualizada."); setPw({ current: "", next: "", confirm: "" }); }
  }

  return (
    <div className="grid grid-2">
      <Card title="Mi cuenta">
        <dl className="dl">
          <dt>Nombre</dt><dd>{profile?.user.name}</dd>
          <dt>Correo</dt><dd>{profile?.user.email}</dd>
          <dt>Rol</dt><dd>{profile?.roleLabel}</dd>
          <dt>Servidor</dt><dd className="mono small">{apiUrl}</dd>
        </dl>
        <p className="muted small">Para cambiar de servidor, cierra sesión y ábrelo en «Servidor» en la pantalla de inicio de sesión.</p>
      </Card>
      <Card title="Mi contraseña">
        <form onSubmit={changePassword}>
          <div className="form-grid">
            <Field label="Contraseña actual" wide><input type="password" required autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="Nueva contraseña" hint={`Mínimo ${MIN_PASSWORD} caracteres`}><input type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Confirmar nueva contraseña"><input type="password" required autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          </div>
          <Notice>{notice}</Notice>
          <ErrorBox error={action.error} />
          <div className="form-actions"><button className="btn btn-primary" disabled={action.busy}>Cambiar contraseña</button></div>
        </form>
      </Card>
    </div>
  );
}

/** Reads a file as base64 (without the data: prefix). */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The company's Certificado de Sello Digital, needed to stamp real CFDI. */
function CsdCard({ canUpload }: { canUpload: boolean }) {
  const csd = useData(() => api().csd());
  const [cer, setCer] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState("");
  const action = useAction();

  async function upload(e: FormEvent) {
    e.preventDefault();
    setNotice("");
    if (!cer || !key) { action.setError(new Error("Selecciona el archivo .cer y el archivo .key.")); return; }
    const ok = await action.run(async () => api().uploadCsd({ cer: await fileToBase64(cer), key: await fileToBase64(key), password }));
    if (ok) {
      setNotice(`CSD ${ok.noCertificado} cargado.`);
      csd.setData(ok);
      setCer(null); setKey(null); setPassword(""); setFormKey((k) => k + 1);
    }
  }

  const info = csd.data;
  const expired = info ? new Date(info.validTo).getTime() < Date.now() : false;
  return (
    <Card title="Certificado de sello digital (CSD)">
      <p className="muted small" style={{ marginTop: 0 }}>
        El CSD (archivos .cer y .key que emite el SAT, con su contraseña) es necesario para timbrar facturas reales.
        La llave privada y su contraseña se guardan cifradas en el servidor.
      </p>
      <ErrorBox error={csd.error} />
      {csd.loading && info === undefined ? <Loading /> : info ? (
        <dl className="dl">
          <dt>RFC</dt><dd className="mono">{info.rfc}</dd>
          <dt>No. de certificado</dt><dd className="mono">{info.noCertificado}</dd>
          <dt>Vigencia</dt><dd>{date(info.validFrom)} – {date(info.validTo)} {expired ? <span className="chip chip-danger">Vencido</span> : <span className="chip chip-success">Vigente</span>}</dd>
          <dt>Cargado</dt><dd>{dateTime(info.uploadedAt)}</dd>
        </dl>
      ) : !csd.error ? <p><span className="chip chip-warning">Sin CSD</span></p> : null}
      {canUpload ? (
        <form onSubmit={upload} key={formKey} style={{ marginTop: 12 }}>
          <div className="form-grid">
            <Field label="Certificado (.cer)"><input type="file" accept=".cer" required onChange={(e) => setCer(e.target.files?.[0] ?? null)} /></Field>
            <Field label="Llave privada (.key)"><input type="file" accept=".key" required onChange={(e) => setKey(e.target.files?.[0] ?? null)} /></Field>
            <Field label="Contraseña de la llave"><input type="password" required autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          </div>
          <Notice>{notice}</Notice>
          <ErrorBox error={action.error} />
          <div className="form-actions"><button className="btn btn-primary" disabled={action.busy}>{info ? "Reemplazar CSD" : "Cargar CSD"}</button></div>
        </form>
      ) : <p className="muted small">Solo el administrador puede cargar el CSD.</p>}
    </Card>
  );
}
