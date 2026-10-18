import { createDb } from "@erp/db";
import { readFile } from "node:fs/promises";

/**
 * Load SAT's list of taxpayers under artículo 69-B (operaciones simuladas)
 * so intake and the auditor can flag those suppliers. Download
 * Listado_Completo_69-B.csv from the SAT open data portal and pass its path:
 *
 *   pnpm --filter @erp/api load:69b ./Listado_Completo_69-B.csv
 *
 * The file is Latin-1 with a few title lines before the header row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parse69b(text: string): Array<{ rfc: string; name: string; situacion: string }> {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => r.some((c) => c.trim().toUpperCase() === "RFC"));
  if (headerAt < 0) throw new Error("No se encontró la fila de encabezados (columna RFC)");
  const header = rows[headerAt]!.map((c) => c.trim().toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iRfc = col(/^rfc$/), iName = col(/nombre/), iSit = col(/situaci/);
  if (iName < 0 || iSit < 0) throw new Error("Faltan las columnas de nombre o situación del contribuyente");
  const out = new Map<string, { rfc: string; name: string; situacion: string }>();
  for (const r of rows.slice(headerAt + 1)) {
    const rfc = (r[iRfc] ?? "").trim().toUpperCase();
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) continue;
    out.set(rfc, { rfc, name: (r[iName] ?? "").trim(), situacion: (r[iSit] ?? "").trim() });
  }
  return [...out.values()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error("Uso: load-69b <ruta a Listado_Completo_69-B.csv>");
    process.exit(1);
  }
  const buf = await readFile(path);
  // SAT publishes in Latin-1; fall back to it when the bytes are not valid UTF-8.
  const utf8 = buf.toString("utf8");
  const entries = parse69b(utf8.includes("�") ? buf.toString("latin1") : utf8);
  const sql = createDb();
  try {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM sat_69b`;
      for (let i = 0; i < entries.length; i += 1000) await tx`INSERT INTO sat_69b ${tx(entries.slice(i, i + 1000), "rfc", "name", "situacion")}`;
    });
    console.log(`Lista 69-B cargada: ${entries.length} contribuyentes`);
  } finally {
    await sql.end();
  }
}
