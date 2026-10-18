import { normalizeText } from "../ai/similarity.js";

/**
 * Grading for the AI eval: an answer passes when every expected number
 * appears in it (allowing for currency formatting and rounding) and every
 * expected name appears in it, ignoring case and accents.
 */

/** Numbers written in an answer: $1,234.56, 1234.56, 1,234, 12.5%, "1.2 millones". */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /(-?)\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s*(?:millones|mdp|millón|mil)\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let n = Number(`${m[1]}${m[2]!.replace(/,/g, "")}${m[3] ?? ""}`);
    const scale = m[4]?.trim().toLowerCase();
    if (scale === "mil") n *= 1_000;
    else if (scale) n *= 1_000_000;
    out.push(n);
  }
  return out;
}

/** Counts and small integers must match exactly; amounts within a peso or 0.1%, plus whatever a "millones" rounding loses. */
export function numberMatches(expected: number, found: number[]): boolean {
  const integer = Number.isInteger(expected) && Math.abs(expected) < 10_000;
  return found.some((n) => {
    if (integer) return n === expected;
    const tol = Math.max(1, Math.abs(expected) * 0.001);
    if (Math.abs(n - expected) <= tol) return true;
    // "$1.2 millones" style: accept rounding to the precision written.
    return Math.abs(expected) >= 1_000_000 && Math.abs(n - expected) <= 50_000;
  });
}

export interface GradeSpec {
  /** Columns of the first truth row that must appear as numbers. */
  numbers?: string[];
  /** Columns of the first truth row that must appear as text. */
  texts?: string[];
  /** Column whose value in every truth row must appear as text (lists). */
  allTexts?: string;
}

export interface Grade { pass: boolean; missing: string[] }

export function grade(answer: string, truth: Record<string, unknown>[], spec: GradeSpec): Grade {
  const missing: string[] = [];
  const found = extractNumbers(answer);
  const normAnswer = normalizeText(answer);
  const row = truth[0] ?? {};
  for (const col of spec.numbers ?? []) {
    const expected = Number(row[col] ?? 0);
    const zeroOk = expected === 0 && /\b(no hay|ninguna?|ningun|no tienes|no tiene|cero)\b/.test(normAnswer);
    if (!zeroOk && !numberMatches(expected, found)) missing.push(`${col}=${expected}`);
  }
  const texts = [
    ...(spec.texts ?? []).map((c) => String(row[c] ?? "")),
    ...(spec.allTexts ? truth.map((r) => String(r[spec.allTexts!] ?? "")) : []),
  ];
  for (const t of texts) if (t && !normAnswer.includes(normalizeText(t))) missing.push(`"${t}"`);
  return { pass: missing.length === 0, missing };
}
