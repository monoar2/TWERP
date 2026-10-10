import Anthropic from "@anthropic-ai/sdk";
import type { Db, Sql } from "@erp/db";
import { describeAiSchema } from "./schema.js";
import { guardSql, UnsafeSqlError } from "./sql-guard.js";

const MAX_ROWS = 200;
const MAX_TURNS = 8;

export interface AiQueryResult {
  answer: string;
  queries: Array<{ sql: string; purpose: string; rowCount: number; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean; error?: string }>;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** The subset of the SDK the agent uses, so tests can inject a fake. */
export type MessagesApi = Pick<Anthropic["beta"]["messages"], "create">;

export interface AiDeps {
  /** Owner connection: schema introspection and logging. */
  db: Sql;
  /** erp_ai_reader connection: executes model-written SQL. */
  readerDb: Sql;
  messages: MessagesApi;
  model: string;
}

const RUN_SQL_TOOL: Anthropic.Beta.BetaTool = {
  name: "run_sql",
  description:
    "Ejecuta UNA consulta PostgreSQL de solo lectura (SELECT o WITH) sobre las vistas del esquema ai y devuelve hasta 200 filas en JSON. " +
    "Úsala tantas veces como necesites para responder con datos reales.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "Consulta SELECT/WITH sobre vistas ai.*" },
      purpose: { type: "string", description: "Qué responde esta consulta, en una frase" },
    },
    required: ["sql", "purpose"],
    additionalProperties: false,
  },
};

function systemPrompt(schema: string, today: string): string {
  return `Eres el asistente de datos de un ERP para empresas mexicanas (inventarios, facturación CFDI 4.0, contabilidad electrónica SAT).
Respondes preguntas sobre los datos del sistema consultando la base de datos con la herramienta run_sql.

Reglas:
- Usa sólo las vistas del esquema ai listadas abajo. Califica siempre los nombres (ai.vista).
- Basa cada cifra de tu respuesta en resultados de run_sql; nunca inventes datos. Si la información no existe en estas vistas, dilo.
- Las ventas reales son facturas con status 'stamped' (excluye draft y cancelled). Sólo las pólizas status 'posted' afectan saldos.
- Montos en pesos mexicanos (MXN) salvo que se indique otra moneda. Formatea como $1,234.56.
- Responde en el idioma de la pregunta, de forma breve: primero la respuesta, luego el detalle relevante (una tabla Markdown si ayuda).
- Si la pregunta es ambigua (por ejemplo, el periodo), elige la interpretación más razonable y dila.
- Fecha de hoy: ${today}.

Vistas disponibles:
${schema}`;
}

async function runReadOnly(readerDb: Sql, sql: string) {
  const safe = guardSql(sql);
  return readerDb.begin("read only", async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    const rows = await tx.unsafe(`SELECT * FROM (${safe}) AS q LIMIT ${MAX_ROWS + 1}`);
    const columns = rows.columns?.map((c) => c.name) ?? [];
    const truncated = rows.length > MAX_ROWS;
    return { columns, rows: [...rows].slice(0, MAX_ROWS) as Record<string, unknown>[], truncated };
  });
}

/**
 * Answer a natural-language question about ERP data. Claude writes SQL, the
 * server runs it read-only and returns rows, and the loop continues until
 * Claude produces a final answer.
 */
export async function answerQuestion(deps: AiDeps, question: string, history: HistoryTurn[] = []): Promise<AiQueryResult> {
  const schema = await describeAiSchema(deps.db);
  const today = new Date().toISOString().slice(0, 10);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];
  const queries: AiQueryResult["queries"] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let answer = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await deps.messages.create({
      model: deps.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // Re-run on Anthropic's recommended model if a safety classifier declines.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: systemPrompt(schema, today), cache_control: { type: "ephemeral" } }],
      tools: [RUN_SQL_TOOL],
      messages,
    });
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "refusal") {
      answer = "No puedo responder esa pregunta.";
      break;
    }
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      answer = text || "No obtuve una respuesta.";
      break;
    }

    messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const input = use.input as { sql?: unknown; purpose?: unknown };
      const sql = typeof input.sql === "string" ? input.sql : "";
      const purpose = typeof input.purpose === "string" ? input.purpose : "";
      try {
        const r = await runReadOnly(deps.readerDb, sql);
        queries.push({ sql, purpose, rowCount: r.rows.length, columns: r.columns, rows: r.rows.slice(0, 50), truncated: r.truncated });
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ columns: r.columns, rows: r.rows, truncated: r.truncated }) });
      } catch (err) {
        const message = err instanceof UnsafeSqlError ? err.message : `Error de base de datos: ${(err as Error).message}`;
        queries.push({ sql, purpose, rowCount: 0, columns: [], rows: [], truncated: false, error: message });
        results.push({ type: "tool_result", tool_use_id: use.id, content: message, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
    if (turn === MAX_TURNS - 1) answer = text || "Alcancé el límite de consultas para esta pregunta; intenta hacerla más específica.";
  }

  await deps.db`INSERT INTO ai_query_log (question, answer, queries, model, input_tokens, output_tokens)
                VALUES (${question}, ${answer}, ${deps.db.json(queries.map(({ rows, ...q }) => q) as never)}, ${deps.model}, ${usage.inputTokens}, ${usage.outputTokens})`;
  return { answer, queries, model: deps.model, usage };
}

export type { Db };
