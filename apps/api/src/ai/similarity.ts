/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const word of normalizeText(s).split(" ")) {
    const w = ` ${word} `;
    for (let i = 0; i < w.length - 1; i++) {
      const g = w.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
  }
  return m;
}

/** Sørensen–Dice coefficient over character bigrams, 0..1. Robust to word order and small typos. */
export function similarity(a: string, b: string): number {
  const x = bigrams(a), y = bigrams(b);
  let total = 0, shared = 0;
  for (const n of x.values()) total += n;
  for (const n of y.values()) total += n;
  for (const [g, n] of x) shared += Math.min(n, y.get(g) ?? 0);
  return total ? (2 * shared) / total : 0;
}
