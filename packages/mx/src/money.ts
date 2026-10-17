import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Num = Decimal.Value;

export const D = (v: Num): Decimal => new Decimal(v);

/** Round to MXN centavos (2 decimals, half-up), the precision SAT validates for MXN totals. */
export const round2 = (v: Num): Decimal => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Format a monetary amount with exactly 2 decimals, as CFDI and Anexo 24 XML expect. */
export const fmt2 = (v: Num): string => round2(v).toFixed(2);

/** Format a rate or quantity with exactly 6 decimals (TasaOCuota, Cantidad). */
export const fmt6 = (v: Num): string => new Decimal(v).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);

export const sum = (values: Num[]): Decimal => values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
