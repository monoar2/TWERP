import { calcularIsrProvisionalPM, D, determinarIvaMensual } from "@erp/mx";
import type { Db } from "@erp/db";
import { monthRange, movementByKey } from "./accounting.js";

/** IVA mensual from the posted ledger (cash basis). */
export async function ivaReport(db: Db, year: number, month: number, saldoAFavorAnterior = "0") {
  const { from, to } = monthRange(year, month);
  const m = await movementByKey(db, ["iva_transferred_collected", "iva_creditable_paid", "iva_withheld_by_customers", "iva_withheld_payable"], from, to);
  const r = determinarIvaMensual({
    trasladadoCobrado: m.iva_transferred_collected ?? 0,
    acreditablePagado: m.iva_creditable_paid ?? 0,
    retenidoPorClientes: m.iva_withheld_by_customers ?? 0,
    retenidoATerceros: m.iva_withheld_payable ?? 0,
    saldoAFavorAnterior,
  });
  return {
    year, month,
    ivaCausado: r.causado.toFixed(2),
    ivaAcreditable: r.acreditable.toFixed(2),
    ivaRetenidoPorClientes: r.retenidoPorClientes.toFixed(2),
    ivaACargo: r.aCargo.toFixed(2),
    ivaAFavor: r.aFavor.toFixed(2),
    retencionesIvaAEnterar: r.retencionesAEnterar.toFixed(2),
    note: "Cifras tomadas de la contabilidad. Revisa con tu contador antes de presentar la declaración.",
  };
}

/** Provisional ISR for personas morales (LISR art. 14), ingresos from the 4xx income accounts. */
export async function isrProvisionalReport(
  db: Db,
  year: number,
  month: number,
  opts: { coeficienteUtilidad: string; pagosProvisionalesAnteriores?: string; perdidasFiscales?: string; ptuPagada?: string },
) {
  const { to } = monthRange(year, month);
  const [row] = await db<{ ingresos: string }[]>`
    -- Credit minus debit nets returns (402, deudora) against sales.
    SELECT coalesce(sum(l.credit - l.debit), 0) AS ingresos
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND a.kind = 'income' AND e.entry_date BETWEEN ${`${year}-01-01`}::date AND ${to}::date`;
  const r = calcularIsrProvisionalPM({
    ingresosNominalesAcumulados: row!.ingresos,
    coeficienteUtilidad: opts.coeficienteUtilidad,
    pagosProvisionalesAnteriores: opts.pagosProvisionalesAnteriores ?? 0,
    perdidasFiscalesPendientes: opts.perdidasFiscales ?? 0,
    ptuPagada: opts.ptuPagada ?? 0,
  });
  return {
    year, month,
    ingresosNominalesAcumulados: D(row!.ingresos).toFixed(2),
    coeficienteUtilidad: opts.coeficienteUtilidad,
    utilidadFiscalEstimada: r.utilidadFiscalEstimada.toFixed(2),
    baseGravable: r.baseGravable.toFixed(2),
    isrCausado: r.isrCausado.toFixed(2),
    isrAPagar: r.isrAPagar.toFixed(2),
    note: "Ingresos nominales según contabilidad (cuentas de ingresos menos devoluciones). Revisa con tu contador.",
  };
}
