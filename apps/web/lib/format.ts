import { formatMXN } from "@erp/client";

export { formatMXN };
export const money = formatMXN;

export function qty(v: string | number | null | undefined, digits = 2): string {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: digits }).format(n);
}

export function date(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" });
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function firstOfMonth(): string {
  return `${today().slice(0, 8)}01`;
}

export const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  stamped: "Timbrada",
  cancelled: "Cancelada",
  validated: "Validada",
  posted: "Contabilizada",
};

export function folio(inv: { serie: string; folio: number | null; id: number }): string {
  return inv.folio != null ? `${inv.serie}-${inv.folio}` : `(PROV${inv.id})`;
}

export const MOVEMENT_KINDS: Record<string, string> = {
  initial: "Carga inicial",
  adjustment: "Ajuste",
  sale: "Venta",
  purchase: "Compra",
  transfer: "Traspaso",
  inventory: "Inventario físico",
  return: "Devolución",
};

export const CANCEL_MOTIVOS = [
  { code: "01", description: "Comprobante emitido con errores con relación" },
  { code: "02", description: "Comprobante emitido con errores sin relación" },
  { code: "03", description: "No se llevó a cabo la operación" },
  { code: "04", description: "Operación nominativa relacionada en una factura global" },
];

export const JOURNALS = [
  { code: "VT", name: "Ventas" },
  { code: "AC", name: "Compras" },
  { code: "CO", name: "Cobranza" },
  { code: "PA", name: "Pagos" },
  { code: "IN", name: "Inventarios" },
  { code: "OD", name: "Diario" },
];
/** Journals accepted by the manual póliza endpoint. */
export const MANUAL_JOURNALS = JOURNALS.filter((j) => ["OD", "CO", "PA", "IN"].includes(j.code));
