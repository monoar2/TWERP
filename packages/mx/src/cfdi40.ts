import { computeDocument, DocumentTotals, LineInput, TaxSpec } from "./taxes.js";
import { fmt2, fmt6 } from "./money.js";
import { attrs } from "./xml.js";
import { FORMAS_PAGO, METODOS_PAGO, OBJETOS_IMPUESTO, REGIMENES_FISCALES, USOS_CFDI } from "./catalogs.js";
import { RFC_PUBLICO_GENERAL, validateRfc } from "./rfc.js";

export const CFDI_NAMESPACE = "http://www.sat.gob.mx/cfd/4";
export const CFDI_SCHEMA_LOCATION = "http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd";

export interface CfdiParty {
  rfc: string;
  nombre: string;
  regimenFiscal: string;
}

export interface CfdiReceptor extends CfdiParty {
  /** Código postal of the receptor's domicilio fiscal (required in CFDI 4.0). */
  domicilioFiscal: string;
  usoCfdi: string;
}

export interface CfdiConcepto extends LineInput {
  claveProdServ: string;
  noIdentificacion?: string;
  claveUnidad: string;
  unidad?: string;
  descripcion: string;
}

export interface InformacionGlobal {
  /** c_Periodicidad: 01 diario, 02 semanal, 03 quincenal, 04 mensual, 05 bimestral */
  periodicidad: string;
  meses: string;
  anio: number;
}

export interface CfdiInput {
  serie?: string;
  folio?: string;
  /** Local time of issue at the LugarExpedicion, format YYYY-MM-DDTHH:mm:ss. */
  fecha: string;
  tipoDeComprobante: "I" | "E";
  formaPago?: string;
  metodoPago?: "PUE" | "PPD";
  moneda?: string;
  tipoCambio?: string;
  exportacion?: string;
  /** Código postal where the CFDI is issued. */
  lugarExpedicion: string;
  emisor: CfdiParty;
  receptor: CfdiReceptor;
  conceptos: CfdiConcepto[];
  informacionGlobal?: InformacionGlobal;
  /** UUIDs related to this CFDI, e.g. the invoice a credit note refers to. */
  relacionados?: { tipoRelacion: string; uuids: string[] };
}

export interface CfdiValidationIssue {
  field: string;
  message: string;
}

const has = (list: { code: string }[], code?: string) => !!code && list.some((e) => e.code === code);
const CP_RE = /^\d{5}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/**
 * Business-rule validation for CFDI 4.0 before it is sent to a PAC. Covers the
 * rules that most often cause rejection (CFDI40xxx errors); the PAC still runs
 * the full SAT validation matrix when stamping.
 */
export function validateCfdi(input: CfdiInput): CfdiValidationIssue[] {
  const issues: CfdiValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  if (!FECHA_RE.test(input.fecha)) add("fecha", "Formato de fecha AAAA-MM-DDThh:mm:ss requerido");
  if (!CP_RE.test(input.lugarExpedicion)) add("lugarExpedicion", "Código postal de 5 dígitos requerido");
  if (input.conceptos.length === 0) add("conceptos", "Se requiere al menos un concepto");

  const emisorRfc = validateRfc(input.emisor.rfc);
  if (!emisorRfc.valid || emisorRfc.kind === "generico") add("emisor.rfc", "RFC del emisor inválido");
  const regimenEmisor = REGIMENES_FISCALES.find((r) => r.code === input.emisor.regimenFiscal);
  if (!regimenEmisor) add("emisor.regimenFiscal", "Régimen fiscal no existe en c_RegimenFiscal");
  else if (emisorRfc.kind === "moral" && !regimenEmisor.moral) add("emisor.regimenFiscal", "Régimen no aplica a personas morales");
  else if (emisorRfc.kind === "fisica" && !regimenEmisor.fisica) add("emisor.regimenFiscal", "Régimen no aplica a personas físicas");

  const r = input.receptor;
  const receptorRfc = validateRfc(r.rfc);
  if (!receptorRfc.valid) add("receptor.rfc", receptorRfc.error ?? "RFC del receptor inválido");
  if (!CP_RE.test(r.domicilioFiscal)) add("receptor.domicilioFiscal", "Código postal de 5 dígitos requerido");
  if (!has(USOS_CFDI, r.usoCfdi)) add("receptor.usoCfdi", "Uso de CFDI no existe en c_UsoCFDI");
  if (!REGIMENES_FISCALES.some((x) => x.code === r.regimenFiscal)) add("receptor.regimenFiscal", "Régimen fiscal no existe");
  if (!r.nombre.trim()) add("receptor.nombre", "Nombre o razón social requerido (tal como aparece en la Constancia de Situación Fiscal)");

  if (r.rfc.toUpperCase() === RFC_PUBLICO_GENERAL) {
    if (r.usoCfdi !== "S01") add("receptor.usoCfdi", "Para público en general el uso debe ser S01");
    if (r.regimenFiscal !== "616") add("receptor.regimenFiscal", "Para público en general el régimen debe ser 616");
    if (r.domicilioFiscal !== input.lugarExpedicion)
      add("receptor.domicilioFiscal", "Para público en general debe ser igual al LugarExpedicion");
    if (r.nombre.toUpperCase() === "PUBLICO EN GENERAL" && !input.informacionGlobal)
      add("informacionGlobal", "La factura global a PUBLICO EN GENERAL requiere InformacionGlobal");
  }

  if (input.tipoDeComprobante === "I" || input.tipoDeComprobante === "E") {
    if (!has(METODOS_PAGO, input.metodoPago)) add("metodoPago", "Método de pago requerido (PUE o PPD)");
    if (!has(FORMAS_PAGO, input.formaPago)) add("formaPago", "Forma de pago requerida");
    if (input.metodoPago === "PPD" && input.formaPago !== "99") add("formaPago", "Con PPD la forma de pago debe ser 99 (Por definir)");
    if (input.metodoPago === "PUE" && input.formaPago === "99") add("formaPago", "Con PUE la forma de pago no puede ser 99");
  }

  const moneda = input.moneda ?? "MXN";
  if (moneda !== "MXN" && moneda !== "XXX" && !input.tipoCambio) add("tipoCambio", "Tipo de cambio requerido para moneda distinta de MXN");

  input.conceptos.forEach((c, i) => {
    const f = `conceptos[${i}]`;
    if (!/^\d{8}$/.test(c.claveProdServ)) add(`${f}.claveProdServ`, "ClaveProdServ de 8 dígitos requerida");
    if (!c.claveUnidad) add(`${f}.claveUnidad`, "ClaveUnidad requerida");
    if (!c.descripcion.trim()) add(`${f}.descripcion`, "Descripción requerida");
    if (!has(OBJETOS_IMPUESTO, c.objetoImp)) add(`${f}.objetoImp`, "ObjetoImp no existe en c_ObjetoImp");
    if (c.objetoImp === "02" && !(c.traslados?.length || c.retenciones?.length))
      add(`${f}.impuestos`, "ObjetoImp 02 requiere al menos un traslado o retención");
    if (c.objetoImp !== "02" && (c.traslados?.length || c.retenciones?.length))
      add(`${f}.impuestos`, "Sólo ObjetoImp 02 puede desglosar impuestos");
    if (Number(c.quantity) <= 0) add(`${f}.quantity`, "La cantidad debe ser mayor a cero");
    if (Number(c.unitPrice) < 0) add(`${f}.unitPrice`, "El valor unitario no puede ser negativo");
  });
  return issues;
}

function taxAttrs(t: { impuesto: string; tipoFactor: string; rate?: string; base: { toString(): string }; importe?: { toString(): string } }) {
  return attrs([
    ["Base", fmt2(t.base.toString())],
    ["Impuesto", t.impuesto],
    ["TipoFactor", t.tipoFactor],
    ["TasaOCuota", t.tipoFactor === "Exento" ? undefined : fmt6(t.rate ?? 0)],
    ["Importe", t.importe === undefined ? undefined : fmt2(t.importe.toString())],
  ]);
}

export interface BuiltCfdi {
  xml: string;
  totals: DocumentTotals;
}

/**
 * Build the unsigned CFDI 4.0 XML. Sello, NoCertificado and Certificado are
 * added by the signing step (CSD) and the TimbreFiscalDigital by the PAC.
 */
export function buildCfdiXml(input: CfdiInput): BuiltCfdi {
  const totals = computeDocument(input.conceptos);
  const moneda = input.moneda ?? "MXN";
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<cfdi:Comprobante xmlns:cfdi="${CFDI_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
      ` xsi:schemaLocation="${CFDI_SCHEMA_LOCATION}"` +
      attrs([
        ["Version", "4.0"],
        ["Serie", input.serie],
        ["Folio", input.folio],
        ["Fecha", input.fecha],
        ["FormaPago", input.formaPago],
        ["SubTotal", fmt2(totals.subtotal)],
        ["Descuento", totals.discount.isZero() ? undefined : fmt2(totals.discount)],
        ["Moneda", moneda],
        ["TipoCambio", moneda === "MXN" ? undefined : input.tipoCambio],
        ["Total", fmt2(totals.total)],
        ["TipoDeComprobante", input.tipoDeComprobante],
        ["Exportacion", input.exportacion ?? "01"],
        ["MetodoPago", input.metodoPago],
        ["LugarExpedicion", input.lugarExpedicion],
      ]) +
      ">",
  );
  if (input.informacionGlobal) {
    const g = input.informacionGlobal;
    out.push(`<cfdi:InformacionGlobal${attrs([["Periodicidad", g.periodicidad], ["Meses", g.meses], ["Año", g.anio]])}/>`);
  }
  if (input.relacionados?.uuids.length) {
    out.push(`<cfdi:CfdiRelacionados${attrs([["TipoRelacion", input.relacionados.tipoRelacion]])}>`);
    for (const uuid of input.relacionados.uuids) out.push(`<cfdi:CfdiRelacionado${attrs([["UUID", uuid]])}/>`);
    out.push("</cfdi:CfdiRelacionados>");
  }
  out.push(
    `<cfdi:Emisor${attrs([["Rfc", input.emisor.rfc.toUpperCase()], ["Nombre", input.emisor.nombre], ["RegimenFiscal", input.emisor.regimenFiscal]])}/>`,
  );
  const r = input.receptor;
  out.push(
    `<cfdi:Receptor${attrs([
      ["Rfc", r.rfc.toUpperCase()],
      ["Nombre", r.nombre],
      ["DomicilioFiscalReceptor", r.domicilioFiscal],
      ["RegimenFiscalReceptor", r.regimenFiscal],
      ["UsoCFDI", r.usoCfdi],
    ])}/>`,
  );
  out.push("<cfdi:Conceptos>");
  input.conceptos.forEach((c, i) => {
    const t = totals.lines[i]!;
    out.push(
      `<cfdi:Concepto${attrs([
        ["ClaveProdServ", c.claveProdServ],
        ["NoIdentificacion", c.noIdentificacion],
        ["Cantidad", fmt6(c.quantity)],
        ["ClaveUnidad", c.claveUnidad],
        ["Unidad", c.unidad],
        ["Descripcion", c.descripcion],
        ["ValorUnitario", fmt6(c.unitPrice)],
        ["Importe", fmt2(t.importe)],
        ["Descuento", t.discount.isZero() ? undefined : fmt2(t.discount)],
        ["ObjetoImp", c.objetoImp],
      ])}>`,
    );
    if (t.traslados.length || t.retenciones.length) {
      out.push("<cfdi:Impuestos>");
      if (t.traslados.length) {
        out.push("<cfdi:Traslados>");
        for (const tr of t.traslados) out.push(`<cfdi:Traslado${taxAttrs(tr)}/>`);
        out.push("</cfdi:Traslados>");
      }
      if (t.retenciones.length) {
        out.push("<cfdi:Retenciones>");
        for (const rt of t.retenciones) out.push(`<cfdi:Retencion${taxAttrs(rt)}/>`);
        out.push("</cfdi:Retenciones>");
      }
      out.push("</cfdi:Impuestos>");
    }
    out.push("</cfdi:Concepto>");
  });
  out.push("</cfdi:Conceptos>");

  if (totals.traslados.length || totals.retenciones.length) {
    const hasTasaTraslado = totals.traslados.some((t) => t.tipoFactor !== "Exento");
    out.push(
      `<cfdi:Impuestos${attrs([
        ["TotalImpuestosRetenidos", totals.retenciones.length ? fmt2(totals.totalRetenciones) : undefined],
        ["TotalImpuestosTrasladados", hasTasaTraslado ? fmt2(totals.totalTraslados) : undefined],
      ])}>`,
    );
    if (totals.retenciones.length) {
      out.push("<cfdi:Retenciones>");
      for (const rt of totals.retenciones) out.push(`<cfdi:Retencion${attrs([["Impuesto", rt.impuesto], ["Importe", fmt2(rt.importe)]])}/>`);
      out.push("</cfdi:Retenciones>");
    }
    if (totals.traslados.length) {
      out.push("<cfdi:Traslados>");
      for (const tr of totals.traslados) out.push(`<cfdi:Traslado${taxAttrs(tr)}/>`);
      out.push("</cfdi:Traslados>");
    }
    out.push("</cfdi:Impuestos>");
  }
  out.push("</cfdi:Comprobante>");
  return { xml: out.join("\n"), totals };
}

/** Standard IVA 16% traslado, the default for most goods and services. */
export const IVA_16: TaxSpec = { impuesto: "002", tipoFactor: "Tasa", rate: "0.160000" };
