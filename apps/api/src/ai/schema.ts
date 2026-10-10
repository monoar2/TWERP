import type { Db } from "@erp/db";

/**
 * Describe the AI-visible views (columns, types and comments) as compact text
 * for the system prompt. Read with the owner connection so the catalog query
 * is not limited by the reader role's search_path.
 */
export async function describeAiSchema(db: Db): Promise<string> {
  const rows = await db<{ view: string; view_comment: string | null; column_name: string; data_type: string }[]>`
    SELECT c.relname AS view, obj_description(c.oid, 'pg_class') AS view_comment, a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'ai' AND c.relkind = 'v'
    ORDER BY c.relname, a.attnum`;
  const views = new Map<string, { comment: string | null; cols: string[] }>();
  for (const r of rows) {
    const v = views.get(r.view) ?? { comment: r.view_comment, cols: [] };
    v.cols.push(`${r.column_name} ${r.data_type}`);
    views.set(r.view, v);
  }
  return [...views]
    .map(([name, v]) => `ai.${name}${v.comment ? ` -- ${v.comment}` : ""}\n  ${v.cols.join(", ")}`)
    .join("\n\n");
}
