import Anthropic from "@anthropic-ai/sdk";
import type { Db, Sql } from "@erp/db";
import type { Role } from "../auth/permissions.js";
import { AppError } from "../errors.js";
import { ACTIONS, actionForTool, allowedActions, createProposal } from "../services/actions.js";
import { describeAiSchema } from "./schema.js";
import { guardSql, UnsafeSqlError } from "./sql-guard.js";

const MAX_ROWS = 200;
const MAX_TURNS = 10;

export interface AiQueryRecord { sql: string; purpose: string; rowCount: number; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean; error?: string }

export interface AiChart {
  title: string;
  type: "bar" | "line" | "pie";
  x: string;
  y: string[];
  /** The query the chart plots; pinning a chart stores this SQL. */
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface AiQueryResult {
  answer: string;
  queries: AiQueryRecord[];
  charts: AiChart[];
  proposals: Awaited<ReturnType<typeof createProposal>>[];
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
  /** Who is asking. Without a user the assistant only reads. */
  user?: { id: number; role: Role };
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

const SHOW_CHART_TOOL: Anthropic.Beta.BetaTool = {
  name: "show_chart",
  description:
    "Muestra al usuario una gráfica de los resultados de una consulta run_sql que ya ejecutaste. Úsala cuando una tendencia, ranking o " +
    "composición se entienda mejor visualmente (ventas por mes, top clientes, mezcla por categoría). El usuario puede fijarla en su tablero, " +
    "donde la consulta se vuelve a ejecutar con datos actuales, así que la consulta no debe depender de valores copiados a mano.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      query_number: { type: "integer", description: "Número de la consulta run_sql a graficar, empezando en 1 en el orden en que las ejecutaste" },
      title: { type: "string" },
      type: { type: "string", enum: ["bar", "line", "pie"], description: "line para series de tiempo, bar para rankings y comparaciones, pie para composición de pocas categorías" },
      x: { type: "string", description: "Columna de categorías o fechas" },
      y: { type: "array", items: { type: "string" }, description: "Una o más columnas numéricas" },
    },
    required: ["query_number", "title", "type", "x", "y"],
    additionalProperties: false,
  },
};

function systemPrompt(schema: string, today: string, actions: string[]): string {
  const actionRules = actions.length
    ? `
Acciones:
- Si el usuario pide registrar o preparar algo, usa las herramientas propose_* (${actions.map((a) => ACTIONS[a]!.label.toLowerCase()).join(", ")}).
- Una propuesta NO cambia nada: el usuario la revisa y la aplica con un botón. Nunca digas que algo ya se registró; di que preparaste la propuesta.
- Busca primero los ids reales con run_sql. Si la herramienta devuelve un error de validación, corrígelo y vuelve a proponer.
- Propón sólo lo que el usuario pidió; no inventes operaciones.`
    : `
Acciones: con el rol de este usuario sólo puedes consultar. Si pide registrar algo, explica que su rol no lo permite.`;
  return `Eres el asistente de datos de un ERP para empresas mexicanas (inventarios, facturación CFDI 4.0, contabilidad electrónica SAT).
Respondes preguntas sobre los datos del sistema consultando la base de datos con la herramienta run_sql.

Reglas:
- Usa sólo las vistas del esquema ai listadas abajo. Califica siempre los nombres (ai.vista).
- Basa cada cifra de tu respuesta en resultados de run_sql; nunca inventes datos. Si la información no existe en estas vistas, dilo.
- Las ventas reales son facturas con status 'stamped' (excluye draft y cancelled). Sólo las pólizas status 'posted' afectan saldos.
- Montos en pesos mexicanos (MXN) salvo que se indique otra moneda. Formatea como $1,234.56.
- Responde en el idioma de la pregunta, de forma breve: primero la respuesta, luego el detalle relevante (una tabla Markdown si ayuda).
- Si una gráfica comunica mejor el resultado, llama a show_chart; no repitas en una tabla lo que ya muestra la gráfica.
- Si la pregunta es ambigua (por ejemplo, el periodo), elige la interpretación más razonable y dila.
- Fecha de hoy: ${today}.
${actionRules}

Vistas disponibles:
${schema}`;
}

/** Run model-written SQL through the guard as erp_ai_reader, read-only, with a timeout and a row cap. */
export async function runReadOnly(readerDb: Sql, sql: string, maxRows = MAX_ROWS) {
  const safe = guardSql(sql);
  return readerDb.begin("read only", async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    const rows = await tx.unsafe(`SELECT * FROM (${safe}) AS q LIMIT ${maxRows + 1}`);
    const columns = rows.columns?.map((c) => c.name) ?? [];
    const truncated = rows.length > maxRows;
    return { columns, rows: [...rows].slice(0, maxRows) as Record<string, unknown>[], truncated };
  });
}

/** Check a chart spec against the columns its query returned. */
export function chartError(columns: string[], x: string, y: string[]): string | null {
  const missing = [x, ...y].filter((c) => !columns.includes(c));
  if (missing.length) return `Columnas inexistentes en la consulta: ${missing.join(", ")}. Disponibles: ${columns.join(", ")}`;
  if (!y.length) return "Indica al menos una columna numérica en y";
  return null;
}

/**
 * Answer a natural-language question about ERP data. Claude writes SQL, the
 * server runs it read-only and returns rows, and the loop continues until
 * Claude produces a final answer. Along the way it may draw charts of its
 * queries and propose writes that the user applies separately.
 */
export async function answerQuestion(deps: AiDeps, question: string, history: HistoryTurn[] = []): Promise<AiQueryResult> {
  const schema = await describeAiSchema(deps.db);
  const today = new Date().toISOString().slice(0, 10);
  const actions = deps.user ? allowedActions(deps.user.role) : [];
  const tools = [RUN_SQL_TOOL, SHOW_CHART_TOOL, ...actions.map((a) => ACTIONS[a]!.tool)];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];
  const queries: AiQueryResult["queries"] = [];
  // Full result sets (up to MAX_ROWS) by query, for charts; `queries` keeps only a preview.
  const fullRows: Array<{ columns: string[]; rows: Record<string, unknown>[] } | null> = [];
  const charts: AiChart[] = [];
  const proposals: AiQueryResult["proposals"] = [];
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
      system: [{ type: "text", text: systemPrompt(schema, today, actions), cache_control: { type: "ephemeral" } }],
      tools,
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
      const reply = (content: string, isError = false) => results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
      if (use.name === "run_sql") {
        const input = use.input as { sql?: unknown; purpose?: unknown };
        const sql = typeof input.sql === "string" ? input.sql : "";
        const purpose = typeof input.purpose === "string" ? input.purpose : "";
        try {
          const r = await runReadOnly(deps.readerDb, sql);
          queries.push({ sql, purpose, rowCount: r.rows.length, columns: r.columns, rows: r.rows.slice(0, 50), truncated: r.truncated });
          fullRows.push({ columns: r.columns, rows: r.rows });
          reply(JSON.stringify({ query_number: queries.length, columns: r.columns, rows: r.rows, truncated: r.truncated }));
        } catch (err) {
          const message = err instanceof UnsafeSqlError ? err.message : `Error de base de datos: ${(err as Error).message}`;
          queries.push({ sql, purpose, rowCount: 0, columns: [], rows: [], truncated: false, error: message });
          fullRows.push(null);
          reply(message, true);
        }
      } else if (use.name === "show_chart") {
        const input = use.input as { query_number: number; title: string; type: AiChart["type"]; x: string; y: string[] };
        const q = queries[input.query_number - 1];
        const data = fullRows[input.query_number - 1];
        if (!q || !data) { reply(`No existe la consulta ${input.query_number} o falló`, true); continue; }
        const error = chartError(data.columns, input.x, input.y);
        if (error) { reply(error, true); continue; }
        charts.push({ title: input.title, type: input.type, x: input.x, y: input.y, sql: q.sql, columns: data.columns, rows: data.rows });
        reply("Gráfica mostrada al usuario.");
      } else {
        const kind = actionForTool(use.name);
        if (!kind || !actions.includes(kind)) { reply(`Herramienta no disponible: ${use.name}`, true); continue; }
        try {
          const p = await createProposal(deps.db, deps.user?.id, kind, use.input as { summary?: unknown });
          proposals.push(p);
          reply(JSON.stringify({ proposal_id: p.id, status: "pendiente de confirmación del usuario", preview: p.preview }));
        } catch (err) {
          const details = err instanceof AppError && err.details ? ` ${JSON.stringify(err.details)}` : "";
          reply(`No se pudo preparar la propuesta: ${(err as Error).message}${details}`, true);
        }
      }
    }
    messages.push({ role: "user", content: results });
    if (turn === MAX_TURNS - 1) answer = text || "Alcancé el límite de consultas para esta pregunta; intenta hacerla más específica.";
  }

  await deps.db`INSERT INTO ai_query_log (question, answer, queries, model, input_tokens, output_tokens)
                VALUES (${question}, ${answer}, ${deps.db.json(queries.map(({ rows, ...q }) => q) as never)}, ${deps.model}, ${usage.inputTokens}, ${usage.outputTokens})`;
  return { answer, queries, charts, proposals, model: deps.model, usage };
}

export type { Db };
