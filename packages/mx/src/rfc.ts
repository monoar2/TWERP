/** RFC used for sales to the general public (público en general). */
export const RFC_PUBLICO_GENERAL = "XAXX010101000";
/** RFC used for foreign customers without a Mexican RFC. */
export const RFC_EXTRANJERO = "XEXX010101000";

export type RfcKind = "fisica" | "moral" | "generico";

export interface RfcValidation {
  valid: boolean;
  kind?: RfcKind;
  error?: string;
}

// Persona moral: 3 letters (Ñ and & allowed) + YYMMDD + 3-char homoclave.
// Persona física: 4 letters + YYMMDD + 3-char homoclave.
const RFC_RE = /^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z\d]{2})([A\d])$/;

/**
 * Structural RFC validation (format and embedded date). It does not check the
 * homoclave digit nor whether the RFC is registered with SAT (use the PAC's
 * Lista de RFC / LCO validation for that).
 */
export function validateRfc(input: string): RfcValidation {
  const rfc = input.trim().toUpperCase();
  if (rfc === RFC_PUBLICO_GENERAL || rfc === RFC_EXTRANJERO) return { valid: true, kind: "generico" };
  const m = RFC_RE.exec(rfc);
  if (!m) return { valid: false, error: "Formato de RFC inválido" };
  const [, letters, , mm, dd] = m;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { valid: false, error: "Fecha inválida en el RFC" };
  return { valid: true, kind: letters!.length === 3 ? "moral" : "fisica" };
}

export function normalizeRfc(input: string): string {
  return input.trim().toUpperCase();
}
