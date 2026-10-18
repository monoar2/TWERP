import { D } from "./money.js";

/**
 * Read a received CFDI 3.3 / 4.0 (the XML a supplier sends) into plain data.
 * CFDIs are attribute-only XML without mixed content, so a small element
 * parser is enough; it does not validate the seal or the XSD.
 */

export interface ParsedCfdiTax {
  impuesto: string;
  tipoFactor: string;
  rate: string | null;
  base: string;
  importe: string | null;
}

export interface ParsedCfdiConcepto {
  claveProdServ: string;
  noIdentificacion: string | null;
  cantidad: string;
  claveUnidad: string;
  unidad: string | null;
  descripcion: string;
  valorUnitario: string;
  importe: string;
  descuento: string;
  objetoImp: string | null;
  traslados: ParsedCfdiTax[];
  retenciones: ParsedCfdiTax[];
}

export interface ParsedCfdi {
  version: string;
  tipoDeComprobante: string;
  serie: string | null;
  folio: string | null;
  fecha: string;
  formaPago: string | null;
  metodoPago: string | null;
  moneda: string;
  tipoCambio: string | null;
  subTotal: string;
  descuento: string;
  total: string;
  lugarExpedicion: string | null;
  emisor: { rfc: string; nombre: string; regimenFiscal: string | null };
  receptor: { rfc: string; nombre: string; usoCfdi: string | null; domicilioFiscal: string | null; regimenFiscal: string | null };
  conceptos: ParsedCfdiConcepto[];
  totalImpuestosTrasladados: string;
  totalImpuestosRetenidos: string;
  /** From the TimbreFiscalDigital; null when the CFDI was never stamped. */
  uuid: string | null;
  fechaTimbrado: string | null;
}

export class CfdiParseError extends Error {}

interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/** Parse XML into an element tree, keeping only elements and attributes. */
export function parseXmlElements(xml: string): XmlElement {
  const src = xml.replace(/^﻿/, "");
  const root: XmlElement = { name: "#root", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>/g;
  const attr = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = tag.exec(src))) {
    if (src.slice(last, m.index).includes("<")) throw new CfdiParseError("XML mal formado");
    last = tag.lastIndex;
    if (!m[2]) continue; // declaration, comment, CDATA, doctype
    const [, closing, name, rawAttrs, selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) throw new CfdiParseError(`Etiqueta de cierre inesperada: ${name}`);
      continue;
    }
    const el: XmlElement = { name: name!, attrs: {}, children: [] };
    let a: RegExpExecArray | null;
    attr.lastIndex = 0;
    while ((a = attr.exec(rawAttrs ?? ""))) el.attrs[a[1]!] = decode(a[2] ?? a[3] ?? "");
    stack[stack.length - 1]!.children.push(el);
    if (!selfClosing) stack.push(el);
  }
  if (stack.length !== 1) throw new CfdiParseError("XML incompleto");
  return root;
}

const local = (name: string) => name.slice(name.indexOf(":") + 1);
const child = (el: XmlElement | undefined, name: string) => el?.children.find((c) => local(c.name) === name);
const children = (el: XmlElement | undefined, name: string) => el?.children.filter((c) => local(c.name) === name) ?? [];
const opt = (v: string | undefined) => (v === undefined || v === "" ? null : v);

function taxes(el: XmlElement | undefined, kind: "Traslado" | "Retencion"): ParsedCfdiTax[] {
  const group = child(el, kind === "Traslado" ? "Traslados" : "Retenciones");
  return children(group, kind).map((t) => ({
    impuesto: t.attrs.Impuesto ?? "",
    tipoFactor: t.attrs.TipoFactor ?? "Tasa",
    rate: opt(t.attrs.TasaOCuota),
    base: t.attrs.Base ?? "0",
    importe: opt(t.attrs.Importe),
  }));
}

export function parseCfdi(xml: string): ParsedCfdi {
  const doc = parseXmlElements(xml);
  const c = doc.children.find((e) => local(e.name) === "Comprobante");
  if (!c) throw new CfdiParseError("El archivo no es un CFDI (falta cfdi:Comprobante)");
  const version = c.attrs.Version ?? c.attrs.version ?? "";
  if (!["3.3", "4.0"].includes(version)) throw new CfdiParseError(`Versión de CFDI no soportada: ${version || "desconocida"}`);
  const emisor = child(c, "Emisor");
  const receptor = child(c, "Receptor");
  if (!emisor || !receptor) throw new CfdiParseError("El CFDI no tiene Emisor o Receptor");
  const conceptos = children(child(c, "Conceptos"), "Concepto").map((k): ParsedCfdiConcepto => {
    const imp = child(k, "Impuestos");
    return {
      claveProdServ: k.attrs.ClaveProdServ ?? "",
      noIdentificacion: opt(k.attrs.NoIdentificacion),
      cantidad: k.attrs.Cantidad ?? "0",
      claveUnidad: k.attrs.ClaveUnidad ?? "",
      unidad: opt(k.attrs.Unidad),
      descripcion: k.attrs.Descripcion ?? "",
      valorUnitario: k.attrs.ValorUnitario ?? "0",
      importe: k.attrs.Importe ?? "0",
      descuento: k.attrs.Descuento ?? "0",
      objetoImp: opt(k.attrs.ObjetoImp),
      traslados: taxes(imp, "Traslado"),
      retenciones: taxes(imp, "Retencion"),
    };
  });
  if (!conceptos.length) throw new CfdiParseError("El CFDI no tiene conceptos");
  const impuestos = c.children.find((e) => local(e.name) === "Impuestos");
  const tfd = child(child(c, "Complemento"), "TimbreFiscalDigital");
  return {
    version,
    tipoDeComprobante: c.attrs.TipoDeComprobante ?? "I",
    serie: opt(c.attrs.Serie),
    folio: opt(c.attrs.Folio),
    fecha: c.attrs.Fecha ?? "",
    formaPago: opt(c.attrs.FormaPago),
    metodoPago: opt(c.attrs.MetodoPago),
    moneda: c.attrs.Moneda ?? "MXN",
    tipoCambio: opt(c.attrs.TipoCambio),
    subTotal: c.attrs.SubTotal ?? "0",
    descuento: c.attrs.Descuento ?? "0",
    total: c.attrs.Total ?? "0",
    lugarExpedicion: opt(c.attrs.LugarExpedicion),
    emisor: { rfc: (emisor.attrs.Rfc ?? "").toUpperCase(), nombre: emisor.attrs.Nombre ?? "", regimenFiscal: opt(emisor.attrs.RegimenFiscal) },
    receptor: {
      rfc: (receptor.attrs.Rfc ?? "").toUpperCase(), nombre: receptor.attrs.Nombre ?? "", usoCfdi: opt(receptor.attrs.UsoCFDI),
      domicilioFiscal: opt(receptor.attrs.DomicilioFiscalReceptor), regimenFiscal: opt(receptor.attrs.RegimenFiscalReceptor),
    },
    conceptos,
    totalImpuestosTrasladados: impuestos?.attrs.TotalImpuestosTrasladados ?? "0",
    totalImpuestosRetenidos: impuestos?.attrs.TotalImpuestosRetenidos ?? "0",
    uuid: tfd?.attrs.UUID ? tfd.attrs.UUID.toUpperCase() : null,
    fechaTimbrado: opt(tfd?.attrs.FechaTimbrado),
  };
}

/**
 * Per-line rates the ERP stores for a supplier invoice line: IVA rate (0 when
 * exempt or not taxed) and withholding rates.
 */
export function conceptoRates(k: ParsedCfdiConcepto): { ivaRate: string; retIvaRate: string; retIsrRate: string } {
  const iva = k.traslados.find((t) => t.impuesto === "002");
  const retIva = k.retenciones.find((t) => t.impuesto === "002");
  const retIsr = k.retenciones.find((t) => t.impuesto === "001");
  // Withholdings at concept level carry TasaOCuota; derive it from the amounts when missing.
  const rate = (t: ParsedCfdiTax | undefined) =>
    !t ? "0" : t.rate ?? (D(t.base).gt(0) && t.importe ? D(t.importe).dividedBy(t.base).toDecimalPlaces(6).toString() : "0");
  return { ivaRate: iva && iva.tipoFactor !== "Exento" ? rate(iva) : "0", retIvaRate: rate(retIva), retIsrRate: rate(retIsr) };
}
