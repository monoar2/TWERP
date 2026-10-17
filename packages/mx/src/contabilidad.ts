import { fmt2 } from "./money.js";
import { attrs } from "./xml.js";
import type { Num } from "./money.js";

/**
 * Electronic accounting XML (Contabilidad en Medios Electrónicos, Anexo 24
 * RMF, version 1.3): chart of accounts, trial balance and journal entries.
 * Files must still be zipped and, for pólizas, sent only when SAT requests
 * them (TipoSolicitud).
 */
const NS = {
  catalogo: "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas",
  balanza: "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion",
  polizas: "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo",
};
const XSD = {
  catalogo: "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas/CatalogoCuentas_1_3.xsd",
  balanza: "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion/BalanzaComprobacion_1_3.xsd",
  polizas: "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo/PolizasPeriodo_1_3.xsd",
};

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const XSI = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const mes = (m: number) => String(m).padStart(2, "0");

export interface PeriodHeader {
  rfc: string;
  year: number;
  month: number;
}

export interface CatalogAccount {
  codAgrup: string;
  numCta: string;
  desc: string;
  subCtaDe?: string;
  nivel: number;
  natur: "D" | "A";
}

export function buildCatalogoXml(h: PeriodHeader, accounts: CatalogAccount[]): string {
  const rows = accounts.map(
    (a) =>
      `<catalogocuentas:Ctas${attrs([
        ["CodAgrup", a.codAgrup],
        ["NumCta", a.numCta],
        ["Desc", a.desc],
        ["SubCtaDe", a.subCtaDe],
        ["Nivel", a.nivel],
        ["Natur", a.natur],
      ])}/>`,
  );
  return [
    XML_DECL,
    `<catalogocuentas:Catalogo xmlns:catalogocuentas="${NS.catalogo}" ${XSI} xsi:schemaLocation="${NS.catalogo} ${XSD.catalogo}"` +
      attrs([["Version", "1.3"], ["RFC", h.rfc], ["Mes", mes(h.month)], ["Anio", h.year]]) +
      ">",
    ...rows,
    "</catalogocuentas:Catalogo>",
  ].join("\n");
}

export interface BalanceRow {
  numCta: string;
  saldoIni: Num;
  debe: Num;
  haber: Num;
  saldoFin: Num;
}

/** TipoEnvio: N = normal, C = complementaria (requires FechaModBal). */
export function buildBalanzaXml(
  h: PeriodHeader,
  rows: BalanceRow[],
  opts: { tipoEnvio?: "N" | "C"; fechaModBal?: string } = {},
): string {
  return [
    XML_DECL,
    `<BCE:Balanza xmlns:BCE="${NS.balanza}" ${XSI} xsi:schemaLocation="${NS.balanza} ${XSD.balanza}"` +
      attrs([
        ["Version", "1.3"],
        ["RFC", h.rfc],
        ["Mes", mes(h.month)],
        ["Anio", h.year],
        ["TipoEnvio", opts.tipoEnvio ?? "N"],
        ["FechaModBal", opts.tipoEnvio === "C" ? opts.fechaModBal : undefined],
      ]) +
      ">",
    ...rows.map(
      (r) =>
        `<BCE:Ctas${attrs([
          ["NumCta", r.numCta],
          ["SaldoIni", fmt2(r.saldoIni)],
          ["Debe", fmt2(r.debe)],
          ["Haber", fmt2(r.haber)],
          ["SaldoFin", fmt2(r.saldoFin)],
        ])}/>`,
    ),
    "</BCE:Balanza>",
  ].join("\n");
}

export interface PolizaTransaction {
  numCta: string;
  desCta: string;
  concepto: string;
  debe: Num;
  haber: Num;
  /** Domestic CFDI backing this line. */
  compNal?: { uuid: string; rfc: string; montoTotal: Num };
}

export interface Poliza {
  numUnIdenPol: string;
  fecha: string;
  concepto: string;
  transacciones: PolizaTransaction[];
}

/**
 * TipoSolicitud: AF acto de fiscalización, FC fiscalización compulsa,
 * DE devolución, CO compensación. AF/FC require NumOrden, DE/CO NumTramite.
 */
export function buildPolizasXml(
  h: PeriodHeader,
  polizas: Poliza[],
  solicitud: { tipoSolicitud: "AF" | "FC" | "DE" | "CO"; numOrden?: string; numTramite?: string },
): string {
  const out: string[] = [XML_DECL];
  out.push(
    `<PLZ:Polizas xmlns:PLZ="${NS.polizas}" ${XSI} xsi:schemaLocation="${NS.polizas} ${XSD.polizas}"` +
      attrs([
        ["Version", "1.3"],
        ["RFC", h.rfc],
        ["Mes", mes(h.month)],
        ["Anio", h.year],
        ["TipoSolicitud", solicitud.tipoSolicitud],
        ["NumOrden", solicitud.numOrden],
        ["NumTramite", solicitud.numTramite],
      ]) +
      ">",
  );
  for (const p of polizas) {
    out.push(`<PLZ:Poliza${attrs([["NumUnIdenPol", p.numUnIdenPol], ["Fecha", p.fecha], ["Concepto", p.concepto]])}>`);
    for (const t of p.transacciones) {
      out.push(
        `<PLZ:Transaccion${attrs([
          ["NumCta", t.numCta],
          ["DesCta", t.desCta],
          ["Concepto", t.concepto],
          ["Debe", fmt2(t.debe)],
          ["Haber", fmt2(t.haber)],
        ])}>`,
      );
      if (t.compNal) {
        out.push(
          `<PLZ:CompNal${attrs([["UUID_CFDI", t.compNal.uuid.toUpperCase()], ["RFC", t.compNal.rfc], ["MontoTotal", fmt2(t.compNal.montoTotal)]])}/>`,
        );
      }
      out.push("</PLZ:Transaccion>");
    }
    out.push("</PLZ:Poliza>");
  }
  out.push("</PLZ:Polizas>");
  return out.join("\n");
}
