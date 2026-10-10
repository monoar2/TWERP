import { D, Decimal, Num, round2, sum } from "./money.js";
import { IMPUESTOS, ImpuestoCode } from "./catalogs.js";

export type TipoFactor = "Tasa" | "Cuota" | "Exento";

/** IVA rates in force (LIVA art. 1, 2-A; región fronteriza decree). */
export const IVA_RATES = {
  general: "0.160000",
  frontera: "0.080000",
  cero: "0.000000",
} as const;

/**
 * Common withholding presets. IVA retention of two thirds of 16% applies to
 * services paid by personas morales to personas físicas (RLIVA art. 3), ISR
 * 10% to professional fees and leasing (LISR arts. 106, 116) and 1.25% to
 * RESICO personas físicas (LISR art. 113-J).
 */
export const RETENCION_PRESETS = {
  ivaDosTercios: { impuesto: IMPUESTOS.IVA, rate: "0.106667" },
  ivaFletes: { impuesto: IMPUESTOS.IVA, rate: "0.040000" },
  isrHonorarios: { impuesto: IMPUESTOS.ISR, rate: "0.100000" },
  isrResico: { impuesto: IMPUESTOS.ISR, rate: "0.012500" },
} as const;

export interface TaxSpec {
  impuesto: ImpuestoCode;
  tipoFactor: TipoFactor;
  /** Rate as decimal string, e.g. "0.160000". Not used for Exento. */
  rate?: string;
}

export interface LineInput {
  quantity: Num;
  unitPrice: Num;
  discount?: Num;
  /** c_ObjetoImp. Only "02" lines carry tax breakdowns. */
  objetoImp: string;
  traslados?: TaxSpec[];
  retenciones?: Array<Omit<TaxSpec, "tipoFactor"> & { tipoFactor?: "Tasa" }>;
}

export interface TaxAmount {
  impuesto: ImpuestoCode;
  tipoFactor: TipoFactor;
  rate?: string;
  base: Decimal;
  /** Undefined for Exento traslados. */
  importe?: Decimal;
}

export interface LineTotals {
  importe: Decimal;
  discount: Decimal;
  base: Decimal;
  traslados: TaxAmount[];
  retenciones: TaxAmount[];
  totalTraslados: Decimal;
  totalRetenciones: Decimal;
  total: Decimal;
}

/**
 * Compute one CFDI concept. Importe = Cantidad × ValorUnitario and each tax
 * Importe = Base × TasaOCuota are rounded to centavos, which keeps the
 * comprobante totals inside SAT's rounding tolerance for MXN.
 */
export function computeLine(line: LineInput): LineTotals {
  const importe = round2(D(line.quantity).times(line.unitPrice));
  const discount = round2(line.discount ?? 0);
  if (discount.greaterThan(importe)) throw new Error("El descuento no puede ser mayor al importe");
  const base = importe.minus(discount);
  const taxable = line.objetoImp === "02";

  const traslados: TaxAmount[] = taxable
    ? (line.traslados ?? []).map((t) =>
        t.tipoFactor === "Exento"
          ? { impuesto: t.impuesto, tipoFactor: "Exento", base }
          : { impuesto: t.impuesto, tipoFactor: t.tipoFactor, rate: t.rate, base, importe: round2(base.times(t.rate ?? 0)) },
      )
    : [];
  const retenciones: TaxAmount[] = taxable
    ? (line.retenciones ?? []).map((r) => ({
        impuesto: r.impuesto,
        tipoFactor: "Tasa",
        rate: r.rate,
        base,
        importe: round2(base.times(r.rate ?? 0)),
      }))
    : [];

  const totalTraslados = sum(traslados.map((t) => t.importe ?? 0));
  const totalRetenciones = sum(retenciones.map((r) => r.importe ?? 0));
  return {
    importe,
    discount,
    base,
    traslados,
    retenciones,
    totalTraslados,
    totalRetenciones,
    total: base.plus(totalTraslados).minus(totalRetenciones),
  };
}

export interface GroupedTax {
  impuesto: ImpuestoCode;
  tipoFactor: TipoFactor;
  rate?: string;
  base: Decimal;
  importe?: Decimal;
}

export interface DocumentTotals {
  lines: LineTotals[];
  subtotal: Decimal;
  discount: Decimal;
  traslados: GroupedTax[];
  /** Retenciones are grouped by impuesto only (CFDI 4.0 comprobante level). */
  retenciones: Array<{ impuesto: ImpuestoCode; importe: Decimal }>;
  totalTraslados: Decimal;
  totalRetenciones: Decimal;
  total: Decimal;
}

export function computeDocument(lines: LineInput[]): DocumentTotals {
  const computed = lines.map(computeLine);
  const trasladoGroups = new Map<string, GroupedTax>();
  const retencionGroups = new Map<string, { impuesto: ImpuestoCode; importe: Decimal }>();

  for (const line of computed) {
    for (const t of line.traslados) {
      const key = `${t.impuesto}|${t.tipoFactor}|${t.rate ?? ""}`;
      const g = trasladoGroups.get(key);
      if (g) {
        g.base = g.base.plus(t.base);
        if (t.importe) g.importe = (g.importe ?? D(0)).plus(t.importe);
      } else {
        trasladoGroups.set(key, { ...t });
      }
    }
    for (const r of line.retenciones) {
      const g = retencionGroups.get(r.impuesto);
      if (g) g.importe = g.importe.plus(r.importe ?? 0);
      else retencionGroups.set(r.impuesto, { impuesto: r.impuesto, importe: r.importe ?? D(0) });
    }
  }

  const subtotal = sum(computed.map((l) => l.importe));
  const discount = sum(computed.map((l) => l.discount));
  const totalTraslados = sum(computed.map((l) => l.totalTraslados));
  const totalRetenciones = sum(computed.map((l) => l.totalRetenciones));
  return {
    lines: computed,
    subtotal,
    discount,
    traslados: [...trasladoGroups.values()],
    retenciones: [...retencionGroups.values()],
    totalTraslados,
    totalRetenciones,
    total: subtotal.minus(discount).plus(totalTraslados).minus(totalRetenciones),
  };
}

export interface IvaMensualInput {
  /** IVA trasladado cobrado in the month (cash basis, LIVA art. 1-B). */
  trasladadoCobrado: Num;
  /** IVA acreditable effectively paid in the month (LIVA art. 5). */
  acreditablePagado: Num;
  /** IVA withheld from us by customers in the month. */
  retenidoPorClientes?: Num;
  /** IVA we withheld from suppliers; paid separately to SAT. */
  retenidoATerceros?: Num;
  /** IVA a favor from previous periods applied this month. */
  saldoAFavorAnterior?: Num;
}

export interface IvaMensualResult {
  causado: Decimal;
  acreditable: Decimal;
  retenidoPorClientes: Decimal;
  aCargo: Decimal;
  aFavor: Decimal;
  retencionesAEnterar: Decimal;
}

/** Monthly definitive IVA determination (LIVA art. 5-D). */
export function determinarIvaMensual(input: IvaMensualInput): IvaMensualResult {
  const causado = round2(input.trasladadoCobrado);
  const acreditable = round2(input.acreditablePagado);
  const retenidoPorClientes = round2(input.retenidoPorClientes ?? 0);
  const saldo = causado.minus(acreditable).minus(retenidoPorClientes).minus(input.saldoAFavorAnterior ?? 0);
  return {
    causado,
    acreditable,
    retenidoPorClientes,
    aCargo: saldo.gt(0) ? round2(saldo) : D(0),
    aFavor: saldo.lt(0) ? round2(saldo.abs()) : D(0),
    retencionesAEnterar: round2(input.retenidoATerceros ?? 0),
  };
}

export interface IsrProvisionalPMInput {
  /** Ingresos nominales accumulated from January to the current month. */
  ingresosNominalesAcumulados: Num;
  /** Coeficiente de utilidad from the last filed annual return (LISR art. 14). */
  coeficienteUtilidad: Num;
  ptuPagada?: Num;
  perdidasFiscalesPendientes?: Num;
  pagosProvisionalesAnteriores?: Num;
  retencionesBancarias?: Num;
  /** Corporate rate, 30% (LISR art. 9). */
  tasa?: Num;
}

export interface IsrProvisionalResult {
  utilidadFiscalEstimada: Decimal;
  baseGravable: Decimal;
  isrCausado: Decimal;
  isrAPagar: Decimal;
}

/** Monthly provisional ISR payment for personas morales, LISR art. 14. */
export function calcularIsrProvisionalPM(input: IsrProvisionalPMInput): IsrProvisionalResult {
  const utilidad = round2(D(input.ingresosNominalesAcumulados).times(input.coeficienteUtilidad));
  let base = utilidad.minus(input.ptuPagada ?? 0).minus(input.perdidasFiscalesPendientes ?? 0);
  if (base.lt(0)) base = D(0);
  const isrCausado = round2(base.times(input.tasa ?? "0.30"));
  let aPagar = isrCausado.minus(input.pagosProvisionalesAnteriores ?? 0).minus(input.retencionesBancarias ?? 0);
  if (aPagar.lt(0)) aPagar = D(0);
  return { utilidadFiscalEstimada: utilidad, baseGravable: round2(base), isrCausado, isrAPagar: round2(aPagar) };
}
