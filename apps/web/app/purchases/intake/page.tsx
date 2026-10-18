"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import type { Intake, IntakeLine } from "@erp/client";
import { api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { Card, Empty, ErrorBox, Field, PageHeader, StatusChip, useAction, useData } from "@/components/ui";

const ACCEPT = ".xml,application/xml,text/xml,application/pdf,image/jpeg,image/png,image/webp";
const SOURCE_LABEL: Record<Intake["source"], string> = { cfdi_xml: "XML del CFDI", pdf: "PDF leído por IA", image: "Foto leída por IA" };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** A supplier CFDI addressed to the company, for trying the intake without a real file. */
function sampleCfdi(companyRfc: string, companyName: string): string {
  const uuid = crypto.randomUUID().toUpperCase();
  const now = new Date().toISOString().slice(0, 19);
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="F" Folio="${Math.floor(Math.random() * 9000) + 1000}" Fecha="${now}" FormaPago="99" SubTotal="5850.00" Moneda="MXN" Total="6786.00" TipoDeComprobante="I" Exportacion="01" MetodoPago="PPD" LugarExpedicion="03100">
  <cfdi:Emisor Rfc="DTE0101011A1" Nombre="DISTRIBUIDORA TECNOLOGICA" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${companyRfc}" Nombre="${companyName.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" DomicilioFiscalReceptor="42501" RegimenFiscalReceptor="601" UsoCFDI="G01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="43211708" Cantidad="10" ClaveUnidad="H87" Unidad="Pieza" Descripcion="MOUSE INALAMBRICO USB 2.4GHZ" ValorUnitario="180.00" Importe="1800.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="1800.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="288.00"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
    <cfdi:Concepto ClaveProdServ="43211706" NoIdentificacion="TEC-01" Cantidad="5" ClaveUnidad="H87" Unidad="Pieza" Descripcion="TECLADO MECANICO RGB" ValorUnitario="760.00" Importe="3800.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="3800.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="608.00"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
    <cfdi:Concepto ClaveProdServ="78102203" Cantidad="1" ClaveUnidad="E48" Unidad="Servicio" Descripcion="FLETE Y MANIOBRAS" ValorUnitario="250.00" Importe="250.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="250.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="40.00"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="936.00"><cfdi:Traslados><cfdi:Traslado Base="5850.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="936.00"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${uuid}" FechaTimbrado="${now}" RfcProvCertif="SPR190613I52" SelloCFD="DEMO" NoCertificadoSAT="00000000000000000000" SelloSAT="DEMO"/></cfdi:Complemento>
</cfdi:Comprobante>`;
}

interface EditLine extends IntakeLine { key: number }

function Review({ intake, onDone }: { intake: Intake; onDone: () => void }) {
  const router = useRouter();
  const s = intake.suggestion;
  const suppliers = useData(() => api().thirdParties());
  const products = useData(() => api().products());
  const warehouses = useData(() => api().warehouses());
  const [thirdPartyId, setThirdPartyId] = useState(s.thirdPartyId ? String(s.thirdPartyId) : "");
  const [fresh, setFresh] = useState(s.newSupplier ?? { name: "", rfc: "", regimenFiscal: "601", codigoPostal: "" });
  const [warehouseId, setWarehouseId] = useState(s.warehouseId ? String(s.warehouseId) : "");
  const [lines, setLines] = useState<EditLine[]>(s.lines.map((l, i) => ({ ...l, key: i })));
  const action = useAction();
  const setLine = (key: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((sum, l) => {
    const base = r2(Number(l.qty) * Number(l.unitPrice) - Number(l.discount || 0));
    return sum + base + r2(base * Number(l.ivaRate)) - r2(base * Number(l.retIvaRate)) - r2(base * Number(l.retIsrRate));
  }, 0);
  const docTotal = intake.extracted.total ? Number(intake.extracted.total) : null;
  const posted = intake.status !== "extracted";

  async function confirm(validate: boolean) {
    const r = await action.run(() => api().confirmIntake(intake.id, {
      thirdPartyId: thirdPartyId ? Number(thirdPartyId) : undefined,
      newSupplier: thirdPartyId ? undefined : fresh,
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      lines: lines.map((l) => ({
        productId: l.productId ?? undefined, description: l.description, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount,
        ivaRate: l.ivaRate, retIvaRate: l.retIvaRate, retIsrRate: l.retIsrRate,
      })),
      validate,
    }));
    if (r) router.push(`/purchases/view/?id=${r.supplierInvoiceId}`);
  }
  async function discard() {
    const r = await action.run(() => api().discardIntake(intake.id));
    if (r) onDone();
  }

  return (
    <Card title={`${intake.file_name}`} actions={<span className="chip chip-info">{SOURCE_LABEL[intake.source]}{intake.model ? ` · ${intake.model}` : ""}</span>}>
      {intake.warnings.length ? (
        <ul className="warnings">{intake.warnings.map((w, i) => <li key={i} className={`w-${w.level}`}>{w.message}</li>)}</ul>
      ) : <ul className="warnings"><li className="w-info">Todo cuadra: proveedor, conceptos y total.</li></ul>}
      <div className="form-grid">
        <Field label="Proveedor" hint={!thirdPartyId ? "Se dará de alta al confirmar" : undefined}>
          <select value={thirdPartyId} onChange={(e) => setThirdPartyId(e.target.value)} disabled={posted}>
            <option value="">Proveedor nuevo…</option>
            {(suppliers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.rfc})</option>)}
          </select>
        </Field>
        {!thirdPartyId ? (
          <>
            <Field label="Nombre"><input value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} /></Field>
            <Field label="RFC"><input value={fresh.rfc} onChange={(e) => setFresh({ ...fresh, rfc: e.target.value.toUpperCase() })} /></Field>
            <Field label="Código postal"><input value={fresh.codigoPostal} inputMode="numeric" maxLength={5} onChange={(e) => setFresh({ ...fresh, codigoPostal: e.target.value })} /></Field>
          </>
        ) : null}
        <Field label="Almacén que recibe">
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={posted}>
            <option value="">—</option>
            {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="Folio fiscal (UUID)"><input value={s.uuid ?? "Sin UUID"} readOnly className="mono" /></Field>
        <Field label="Referencia / fecha"><input value={`${s.supplierRef ?? "—"} · ${s.issueDate ?? "—"} · ${s.metodoPago}`} readOnly /></Field>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Concepto en el documento</th><th>Registrar como</th><th className="num">Cantidad</th><th className="num">Precio unitario</th><th className="num">IVA</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.description}</td>
                <td>
                  <select value={l.productId ?? ""} disabled={posted} onChange={(e) => setLine(l.key, { productId: e.target.value ? Number(e.target.value) : null, matchedBy: null })}>
                    <option value="">Gasto (cuenta por omisión)</option>
                    {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                  </select>
                  {l.matchedBy ? <div className="match muted">{l.matchedBy === "sku" ? "Coincide por SKU" : `Coincide por nombre (${Math.round((l.score ?? 0) * 100)}%)`}</div> : null}
                </td>
                <td className="num"><input className="num" style={{ width: 90 }} value={l.qty} disabled={posted} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></td>
                <td className="num"><input className="num" style={{ width: 110 }} value={l.unitPrice} disabled={posted} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} /></td>
                <td className="num">
                  <select value={Number(l.ivaRate).toString()} disabled={posted} onChange={(e) => setLine(l.key, { ivaRate: e.target.value })}>
                    <option value="0.16">16%</option><option value="0.08">8%</option><option value="0">0%</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Total a registrar: <strong>{money(total)}</strong>
        {docTotal !== null ? <> · total del documento: <strong className={Math.abs(docTotal - total) > 0.05 ? "tone-danger" : ""}>{money(docTotal)}</strong></> : null}
      </p>
      <ErrorBox error={action.error} />
      {posted ? (
        intake.supplier_invoice_id ? <Link className="btn" href={`/purchases/view/?id=${intake.supplier_invoice_id}`}>Ver la factura registrada</Link> : <span className="muted">Documento descartado.</span>
      ) : (
        <div className="actions">
          <button className="btn btn-primary" onClick={() => confirm(true)} disabled={action.busy}>Registrar y validar</button>
          <button className="btn" onClick={() => confirm(false)} disabled={action.busy}>Guardar como borrador</button>
          <button className="btn btn-ghost" onClick={discard} disabled={action.busy}>Descartar</button>
        </div>
      )}
    </Card>
  );
}

export default function IntakePage() {
  const recent = useData(() => api().intakes());
  const company = useData(() => api().company());
  const [current, setCurrent] = useState<Intake | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const action = useAction();

  async function upload(file: File) {
    const r = await action.run(async () => api().uploadIntake({ fileName: file.name, mediaType: file.type, contentBase64: await toBase64(file) }));
    if (r) { setCurrent(r); void recent.reload(); }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void upload(file);
  }
  async function trySample() {
    const rfc = String(company.data?.rfc ?? "EKU9003173C9");
    const xml = sampleCfdi(rfc, String(company.data?.razon_social ?? ""));
    await upload(new File([xml], "cfdi-ejemplo.xml", { type: "text/xml" }));
  }
  async function open(id: number) {
    const r = await action.run(() => api().intake(id));
    if (r) setCurrent(r);
  }

  return (
    <>
      <PageHeader title="Subir factura de proveedor" subtitle="Arrastra el XML del CFDI, el PDF o una foto del ticket. El XML se lee exacto; el PDF y las fotos los lee la IA. Revisa y confirma antes de registrar." />
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
      >
        <input ref={input} type="file" accept={ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        {action.busy ? <><span className="spinner" /> Leyendo el documento…</> : <><strong>Suelta aquí el archivo</strong> o haz clic para elegirlo<div className="small muted">XML, PDF, JPG, PNG o WEBP, hasta 10 MB</div></>}
      </div>
      <p className="small">¿No tienes uno a la mano? <button className="btn btn-sm" onClick={trySample} disabled={action.busy}>Probar con un CFDI de ejemplo</button></p>
      <ErrorBox error={action.error} />
      {current ? <Review key={current.id} intake={current} onDone={() => { setCurrent(null); void recent.reload(); }} /> : null}
      <Card title="Documentos recientes">
        <ErrorBox error={recent.error} />
        {recent.data && recent.data.length === 0 ? <Empty>Aún no has subido documentos.</Empty> : null}
        {recent.data && recent.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Archivo</th><th>Origen</th><th>Proveedor</th><th className="num">Total</th><th>Estado</th><th>Subido</th></tr></thead>
              <tbody>
                {recent.data.map((d) => (
                  <tr key={d.id}>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => open(d.id)}>{d.file_name}</button></td>
                    <td>{SOURCE_LABEL[d.source]}</td><td>{d.supplier_name}</td><td className="num">{d.total ? money(d.total) : ""}</td>
                    <td><StatusChip status={d.status === "posted" ? "posted" : d.status === "discarded" ? "cancelled" : "draft"}
                      label={d.status === "posted" ? "Registrado" : d.status === "discarded" ? "Descartado" : "Por revisar"} /></td>
                    <td className="nowrap small">{dateTime(d.created_at)}{d.created_by_name ? ` · ${d.created_by_name}` : ""}</td>
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
