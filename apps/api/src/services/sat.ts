import { buildBalanzaXml, buildCatalogoXml, buildPolizasXml, type Poliza } from "@erp/mx";
import type { Db } from "@erp/db";
import { badRequest } from "../errors.js";
import { monthRange, trialBalance } from "./accounting.js";

async function header(db: Db, year: number, month: number) {
  const [company] = await db<{ rfc: string }[]>`SELECT rfc FROM company WHERE id = 1`;
  if (!company) throw badRequest("Configura los datos fiscales de la empresa");
  return { rfc: company.rfc, year, month };
}

export async function catalogoXml(db: Db, year: number, month: number) {
  const accounts = await db<{ code: string; name: string; sat_code: string; parent_code: string | null; level: number; nature: "D" | "A" }[]>`
    SELECT a.code, a.name, a.sat_code, p.code AS parent_code, a.level, a.nature
    FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id WHERE a.active ORDER BY a.code`;
  return buildCatalogoXml(
    await header(db, year, month),
    accounts.map((a) => ({ codAgrup: a.sat_code, numCta: a.code, desc: a.name, subCtaDe: a.parent_code ?? undefined, nivel: a.level, natur: a.nature })),
  );
}

export async function balanzaXml(db: Db, year: number, month: number, tipoEnvio: "N" | "C" = "N", fechaModBal?: string) {
  const rows = await trialBalance(db, year, month);
  return buildBalanzaXml(
    await header(db, year, month),
    rows.map((r) => ({ numCta: r.code, saldoIni: r.saldoIni, debe: r.debe, haber: r.haber, saldoFin: r.saldoFin })),
    { tipoEnvio, fechaModBal },
  );
}

export async function polizasXml(db: Db, year: number, month: number, solicitud: { tipoSolicitud: "AF" | "FC" | "DE" | "CO"; numOrden?: string; numTramite?: string }) {
  if ((solicitud.tipoSolicitud === "AF" || solicitud.tipoSolicitud === "FC") && !solicitud.numOrden) throw badRequest("AF y FC requieren NumOrden");
  if ((solicitud.tipoSolicitud === "DE" || solicitud.tipoSolicitud === "CO") && !solicitud.numTramite) throw badRequest("DE y CO requieren NumTramite");
  const { from, to } = monthRange(year, month);
  const rows = await db<{ entry_id: number; journal_code: string; sat_type: string; number: number; entry_date: string; concept: string; code: string; name: string; description: string; debit: string; credit: string; cfdi_uuid: string | null; rfc: string | null; cfdi_total: string | null }[]>`
    SELECT e.id AS entry_id, e.journal_code, j.sat_type, e.number, e.entry_date, e.concept, a.code, a.name, l.description, l.debit, l.credit, l.cfdi_uuid, l.rfc, l.cfdi_total
    FROM journal_entries e JOIN journals j ON j.code = e.journal_code JOIN journal_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND e.entry_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY e.entry_date, e.id, l.line_no`;
  const polizas = new Map<number, Poliza>();
  for (const r of rows) {
    let p = polizas.get(r.entry_id);
    if (!p) {
      p = { numUnIdenPol: `${r.sat_type}-${r.journal_code}-${r.number}`, fecha: r.entry_date.slice(0, 10), concepto: r.concept, transacciones: [] };
      polizas.set(r.entry_id, p);
    }
    p.transacciones.push({
      numCta: r.code, desCta: r.name, concepto: r.description, debe: r.debit, haber: r.credit,
      compNal: r.cfdi_uuid && r.rfc ? { uuid: r.cfdi_uuid, rfc: r.rfc, montoTotal: r.cfdi_total ?? "0" } : undefined,
    });
  }
  return buildPolizasXml(await header(db, year, month), [...polizas.values()], solicitud);
}
