import { readFile } from "node:fs/promises";
import { createDb } from "../index.js";

/**
 * Load c_ClaveProdServ or c_ClaveUnidad from a CSV exported from SAT's
 * catCFDI spreadsheet (first column = code, second = description).
 *
 *   pnpm --filter @erp/db run load-sat-catalog prodserv ./c_ClaveProdServ.csv
 *   pnpm --filter @erp/db run load-sat-catalog unidad ./c_ClaveUnidad.csv
 */
const [kind, file] = process.argv.slice(2);
if (!file || (kind !== "prodserv" && kind !== "unidad")) {
  console.error("Usage: load-sat-catalog <prodserv|unidad> <file.csv>");
  process.exit(1);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const rows = (await readFile(file, "utf8"))
  .split(/\r?\n/)
  .map(parseCsvLine)
  .filter(([code, desc]) => code && desc && /^[A-Z0-9]{2,8}$/.test(code.trim()))
  .map(([code, desc]) => ({ code: code!.trim(), description: desc!.trim() }));

const sql = createDb();
try {
  const table = kind === "prodserv" ? "sat_clave_prod_serv" : "sat_clave_unidad";
  const column = kind === "prodserv" ? "description" : "name";
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000).map((r) => ({ code: r.code, [column]: r.description }));
    await sql`INSERT INTO ${sql(table)} ${sql(chunk)} ON CONFLICT (code) DO NOTHING`;
  }
  console.log(`Loaded ${rows.length} rows into ${table}`);
} finally {
  await sql.end();
}
