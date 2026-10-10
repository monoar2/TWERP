import { CODIGO_AGRUPADOR, CLAVES_UNIDAD_COMUNES } from "@erp/mx";
import type { Sql } from "./client.js";

type Kind = "asset" | "liability" | "equity" | "income" | "cost" | "expense";

/**
 * Starter chart of accounts. Level-1 accounts mirror the SAT level-1 groups
 * and only aggregate; level-2 accounts receive postings. Add level-3
 * subaccounts (e.g. one per bank) from the UI as the business needs them.
 */
const CHART: Array<[code: string, name: string, kind: Kind, children: Array<[string, string]>]> = [
  ["101", "Caja", "asset", [["101.01", "Caja y efectivo"]]],
  ["102", "Bancos", "asset", [["102.01", "Bancos nacionales"]]],
  ["105", "Clientes", "asset", [["105.01", "Clientes nacionales"]]],
  ["113", "Impuestos a favor", "asset", [["113.01", "IVA a favor"], ["113.02", "ISR a favor"]]],
  ["115", "Inventario", "asset", [["115.01", "Inventario"]]],
  ["118", "Impuestos acreditables pagados", "asset", [["118.01", "IVA acreditable pagado"]]],
  ["119", "Impuestos acreditables por pagar", "asset", [["119.01", "IVA pendiente de pago"]]],
  ["201", "Proveedores", "liability", [["201.01", "Proveedores nacionales"]]],
  ["208", "Impuestos trasladados cobrados", "liability", [["208.01", "IVA trasladado cobrado"]]],
  ["209", "Impuestos trasladados no cobrados", "liability", [["209.01", "IVA trasladado no cobrado"]]],
  ["213", "Impuestos y derechos por pagar", "liability", [["213.01", "IVA por pagar"], ["213.03", "ISR por pagar"]]],
  ["216", "Impuestos retenidos", "liability", [["216.04", "ISR retenido por servicios profesionales"], ["216.10", "IVA retenido"]]],
  ["301", "Capital social", "equity", [["301.01", "Capital fijo"]]],
  ["304", "Resultado de ejercicios anteriores", "equity", [["304.01", "Utilidad de ejercicios anteriores"]]],
  ["305", "Resultado del ejercicio", "equity", [["305.01", "Utilidad del ejercicio"]]],
  ["401", "Ingresos", "income", [["401.01", "Ventas gravadas a la tasa general"], ["401.04", "Ventas gravadas al 0%"], ["401.07", "Ventas exentas"]]],
  ["402", "Devoluciones, descuentos o bonificaciones sobre ingresos", "income", [["402.01", "Devoluciones y descuentos sobre ventas"]]],
  ["501", "Costo de venta", "cost", [["501.01", "Costo de venta"]]],
  ["601", "Gastos generales", "expense", [["601.45", "Arrendamiento"], ["601.50", "Teléfono e internet"], ["601.84", "Otros gastos generales"]]],
  ["701", "Gastos financieros", "expense", [["701.10", "Comisiones bancarias"]]],
  ["702", "Productos financieros", "income", [["702.10", "Otros productos financieros"]]],
];

export const DEFAULT_ACCOUNT_SETTINGS: Array<[key: string, code: string, description: string]> = [
  ["cash", "101.01", "Caja"],
  ["customers", "105.01", "Clientes"],
  ["suppliers", "201.01", "Proveedores"],
  ["inventory", "115.01", "Inventario"],
  ["cost_of_sales", "501.01", "Costo de venta"],
  ["inventory_adjustment", "501.01", "Ajustes de inventario (mermas y sobrantes)"],
  ["sales_taxed", "401.01", "Ventas gravadas a la tasa general"],
  ["sales_zero", "401.04", "Ventas gravadas al 0%"],
  ["sales_exempt", "401.07", "Ventas exentas"],
  ["sales_returns", "402.01", "Devoluciones y descuentos sobre ventas"],
  ["iva_transferred_collected", "208.01", "IVA trasladado cobrado"],
  ["iva_transferred_pending", "209.01", "IVA trasladado no cobrado"],
  ["iva_creditable_paid", "118.01", "IVA acreditable pagado"],
  ["iva_creditable_pending", "119.01", "IVA pendiente de pago"],
  ["iva_withheld_by_customers", "113.01", "IVA retenido por clientes"],
  ["isr_withheld_by_customers", "113.02", "ISR retenido por clientes"],
  ["iva_withheld_payable", "216.10", "IVA retenido a proveedores por enterar"],
  ["isr_withheld_payable", "216.04", "ISR retenido a proveedores por enterar"],
  ["default_expense", "601.84", "Gasto por omisión"],
  ["opening_equity", "301.01", "Capital (saldos iniciales)"],
];

const JOURNALS: Array<[string, string, "I" | "E" | "D"]> = [
  ["VT", "Ventas", "D"],
  ["AC", "Compras", "D"],
  ["CO", "Cobranza", "I"],
  ["PA", "Pagos", "E"],
  ["IN", "Inventarios", "D"],
  ["OD", "Diario", "D"],
];

export interface CompanyInput {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
}

/** Load SAT reference catalogs, the starter chart and journals. Idempotent. */
export async function seedReferenceData(sql: Sql, company?: CompanyInput): Promise<void> {
  await sql.begin(async (tx) => {
    for (const c of CODIGO_AGRUPADOR) {
      await tx`INSERT INTO sat_codigo_agrupador (code, description, level, nature)
               VALUES (${c.code}, ${c.description}, ${c.level}, ${c.nature})
               ON CONFLICT (code) DO NOTHING`;
    }
    for (const u of CLAVES_UNIDAD_COMUNES) {
      await tx`INSERT INTO sat_clave_unidad (code, name) VALUES (${u.code}, ${u.description}) ON CONFLICT DO NOTHING`;
    }
    const natureOf = new Map(CODIGO_AGRUPADOR.map((c) => [c.code, c.nature]));
    for (const [code, name, kind, children] of CHART) {
      const [parent] = await tx<{ id: number }[]>`
        INSERT INTO accounts (code, name, level, nature, kind, sat_code, postable)
        VALUES (${code}, ${name}, 1, ${natureOf.get(code)!}, ${kind}, ${code}, false)
        ON CONFLICT (code) DO UPDATE SET name = accounts.name RETURNING id`;
      for (const [childCode, childName] of children) {
        await tx`INSERT INTO accounts (code, name, parent_id, level, nature, kind, sat_code, postable)
                 VALUES (${childCode}, ${childName}, ${parent!.id}, 2, ${natureOf.get(childCode)!}, ${kind}, ${childCode}, true)
                 ON CONFLICT (code) DO NOTHING`;
      }
    }
    for (const [key, code, description] of DEFAULT_ACCOUNT_SETTINGS) {
      await tx`INSERT INTO account_settings (key, account_id, description)
               SELECT ${key}, id, ${description} FROM accounts WHERE code = ${code}
               ON CONFLICT (key) DO NOTHING`;
    }
    for (const [code, name, satType] of JOURNALS) {
      await tx`INSERT INTO journals (code, name, sat_type) VALUES (${code}, ${name}, ${satType}) ON CONFLICT DO NOTHING`;
    }
    if (company) {
      await tx`INSERT INTO company (id, rfc, razon_social, regimen_fiscal, codigo_postal)
               VALUES (1, ${company.rfc}, ${company.razonSocial}, ${company.regimenFiscal}, ${company.codigoPostal})
               ON CONFLICT (id) DO NOTHING`;
    }
  });
}
