"use client";
import { useState } from "react";
import { api, downloadFile } from "@/lib/api";
import { today } from "@/lib/format";
import { Card, ErrorBox, Field, Notice, PageHeader, YearMonthPicker, useAction, useData } from "@/components/ui";
import { TaxesNav } from "@/components/TaxesNav";

const TIPOS = [
  { code: "AF", label: "AF — Acto de fiscalización" },
  { code: "FC", label: "FC — Fiscalización compulsa" },
  { code: "DE", label: "DE — Devolución" },
  { code: "CO", label: "CO — Compensación" },
];

export default function SatExportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tipoEnvio, setTipoEnvio] = useState<"N" | "C">("N");
  const [fechaModBal, setFechaModBal] = useState(today());
  const [tipoSolicitud, setTipoSolicitud] = useState("AF");
  const [numOrden, setNumOrden] = useState("");
  const [numTramite, setNumTramite] = useState("");
  const [notice, setNotice] = useState("");
  const action = useAction();
  const company = useData(() => api().company());
  const rfc = company.data ? String(company.data.rfc ?? "") : "";
  const ym = `${year}${String(month).padStart(2, "0")}`;
  const needsOrden = tipoSolicitud === "AF" || tipoSolicitud === "FC";

  async function download(kind: "catalogo" | "balanza" | "polizas") {
    setNotice("");
    const extra: Record<string, string> =
      kind === "balanza" ? { tipoEnvio, ...(tipoEnvio === "C" ? { fechaModBal } : {}) }
      : kind === "polizas" ? { tipoSolicitud, ...(needsOrden ? { numOrden } : { numTramite }) }
      : {};
    const suffix = kind === "catalogo" ? "CT" : kind === "balanza" ? `B${tipoEnvio}` : "PL";
    const ok = await action.run(async () => { await downloadFile(api().satExportPath(kind, year, month, extra), `${rfc}${ym}${suffix}.xml`); return true; });
    if (ok) setNotice(`Archivo ${kind} descargado.`);
  }

  return (
    <>
      <PageHeader title="Contabilidad electrónica" subtitle="Archivos XML del Anexo 24 para el SAT (versión 1.3)" />
      <TaxesNav />
      <div style={{ marginBottom: 16 }}><YearMonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} /></div>
      <Notice>{notice}</Notice>
      <ErrorBox error={action.error} />
      <div className="grid grid-3">
        <Card title="Catálogo de cuentas">
          <p className="muted">Cuentas con su código agrupador SAT. Se envía al inicio y cuando cambia el catálogo.</p>
          <div className="form-actions"><button className="btn btn-primary" disabled={action.busy} onClick={() => download("catalogo")}>Descargar catálogo</button></div>
        </Card>
        <Card title="Balanza de comprobación">
          <div className="form-grid">
            <Field label="Tipo de envío">
              <select value={tipoEnvio} onChange={(e) => setTipoEnvio(e.target.value as "N" | "C")}><option value="N">N — Normal</option><option value="C">C — Complementaria</option></select>
            </Field>
            {tipoEnvio === "C" ? <Field label="Fecha de modificación"><input type="date" value={fechaModBal} onChange={(e) => setFechaModBal(e.target.value)} /></Field> : null}
          </div>
          <div className="form-actions"><button className="btn btn-primary" disabled={action.busy} onClick={() => download("balanza")}>Descargar balanza</button></div>
        </Card>
        <Card title="Pólizas del periodo">
          <div className="form-grid">
            <Field label="Tipo de solicitud">
              <select value={tipoSolicitud} onChange={(e) => setTipoSolicitud(e.target.value)}>{TIPOS.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select>
            </Field>
            {needsOrden ? (
              <Field label="Número de orden" hint="Formato SAT: ABC1234567/12"><input className="mono" value={numOrden} onChange={(e) => setNumOrden(e.target.value.toUpperCase())} /></Field>
            ) : (
              <Field label="Número de trámite" hint="Formato SAT: AB123456789012"><input className="mono" value={numTramite} onChange={(e) => setNumTramite(e.target.value.toUpperCase())} /></Field>
            )}
          </div>
          <div className="form-actions"><button className="btn btn-primary" disabled={action.busy || (needsOrden ? !numOrden : !numTramite)} onClick={() => download("polizas")}>Descargar pólizas</button></div>
        </Card>
      </div>
    </>
  );
}
