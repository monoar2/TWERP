/**
 * Defense-in-depth checks on model-written SQL. The real boundary is the
 * database: queries run as erp_ai_reader, which can only SELECT from the
 * views in schema "ai", inside a READ ONLY transaction with a timeout.
 */
const FORBIDDEN = /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|vacuum|analyze|cluster|reindex|lock|listen|notify|prepare|execute|deallocate|set|reset|discard|comment|security|refresh|import)\b/i;
const FORBIDDEN_FUNCS = /\b(pg_sleep\w*|pg_read_\w+|pg_ls_\w+|pg_stat_file|lo_\w+|dblink\w*|pg_terminate_backend|pg_cancel_backend|set_config|current_setting|txid_\w+|pg_advisory\w*)\s*\(/i;

export class UnsafeSqlError extends Error {}

export function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Normalize, validate and return a single read-only statement. */
export function guardSql(raw: string): string {
  let sql = stripSqlComments(raw).trim();
  sql = sql.replace(/;\s*$/, "").trim();
  if (!sql) throw new UnsafeSqlError("La consulta está vacía");
  // String literals can legitimately contain keywords; check code outside quotes.
  const code = sql.replace(/'(?:[^']|'')*'/g, "''");
  if (code.includes(";")) throw new UnsafeSqlError("Sólo se permite una sentencia");
  if (!/^(select|with)\b/i.test(code)) throw new UnsafeSqlError("Sólo se permiten consultas SELECT");
  const kw = FORBIDDEN.exec(code);
  if (kw) throw new UnsafeSqlError(`Palabra no permitida en consultas de solo lectura: ${kw[1]}`);
  const fn = FORBIDDEN_FUNCS.exec(code);
  if (fn) throw new UnsafeSqlError(`Función no permitida: ${fn[1]}`);
  if (/\b(pg_catalog|information_schema|public)\s*\./i.test(code)) throw new UnsafeSqlError("Sólo se pueden consultar las vistas del esquema ai");
  return sql;
}
