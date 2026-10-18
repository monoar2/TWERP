import type { Sql } from "@erp/db";
import { answerQuestion, runReadOnly, type MessagesApi } from "../ai/agent.js";
import { describeAiSchema } from "../ai/schema.js";
import { UnsafeSqlError } from "../ai/sql-guard.js";

/**
 * A Model Context Protocol server for the ERP, so Claude Desktop, Claude Code
 * or any MCP client can query it. Every tool is read-only and goes through the
 * same guard and erp_ai_reader role as the in-app assistant. The JSON-RPC
 * handling is transport-agnostic: routes/mcp.ts serves it over Streamable
 * HTTP and cli/mcp-stdio.ts over stdio.
 */

export interface McpDeps {
  sql: Sql;
  readerSql?: Sql;
  messages?: MessagesApi;
  model: string;
}

export interface JsonRpcRequest { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> }
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "erp-mexico", title: "ERP México", version: "0.1.0" };

const INSTRUCTIONS =
  "ERP para una empresa mexicana: inventarios, facturación CFDI 4.0, compras, bancos y contabilidad electrónica del SAT. " +
  "Llama primero a describe_schema para conocer las vistas ai.* y después usa run_sql con consultas SELECT. Montos en MXN. " +
  "Las ventas reales son facturas con status 'stamped'; sólo las pólizas 'posted' afectan saldos.";

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  needs?: "reader" | "claude";
  call(deps: McpDeps, args: Record<string, unknown>): Promise<{ text: string; structured?: Record<string, unknown> }>;
}

const TOOLS: ToolDef[] = [
  {
    name: "describe_schema",
    title: "Describir esquema",
    description: "Lista las vistas de solo lectura del ERP (esquema ai) con sus columnas, tipos y una descripción de cada una.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async call(deps) {
      return { text: await describeAiSchema(deps.sql) };
    },
  },
  {
    name: "run_sql",
    title: "Consultar con SQL",
    description: "Ejecuta UNA consulta PostgreSQL SELECT/WITH sobre las vistas ai.* y devuelve hasta 200 filas en JSON. Transacción de solo lectura con límite de 5 s.",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string", description: "Consulta SELECT o WITH sobre vistas ai.*" } },
      required: ["sql"],
      additionalProperties: false,
    },
    needs: "reader",
    async call(deps, args) {
      const r = await runReadOnly(deps.readerSql!, String(args.sql ?? ""));
      const structured = { columns: r.columns, rows: r.rows, truncated: r.truncated };
      return { text: JSON.stringify(structured), structured };
    },
  },
  {
    name: "list_audit_findings",
    title: "Hallazgos del auditor",
    description: "Devuelve los hallazgos abiertos del auditor automático: facturas duplicadas, proveedores en la lista 69-B, ventas bajo costo, cobranza vencida, etc.",
    inputSchema: {
      type: "object",
      properties: { severity: { type: "string", enum: ["high", "medium", "low"], description: "Filtra por severidad" } },
      additionalProperties: false,
    },
    async call(deps, args) {
      const severity = typeof args.severity === "string" ? args.severity : null;
      const rows = await deps.sql`
        SELECT id, check_code, severity, title, detail, evidence, first_seen, last_seen FROM audit_findings
        WHERE status = 'open' AND (${severity}::text IS NULL OR severity = ${severity})
        ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, last_seen DESC LIMIT 200`;
      const structured = { findings: [...rows] };
      return { text: JSON.stringify(structured), structured };
    },
  },
  {
    name: "ask_erp",
    title: "Preguntar al ERP",
    description: "Hace una pregunta en lenguaje natural al asistente del ERP, que consulta los datos y responde en Markdown con las consultas que usó. Útil cuando no quieres escribir SQL.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
      additionalProperties: false,
    },
    needs: "claude",
    async call(deps, args) {
      const r = await answerQuestion({ db: deps.sql, readerDb: deps.readerSql!, messages: deps.messages!, model: deps.model }, String(args.question ?? ""));
      return { text: r.answer, structured: { answer: r.answer, queries: r.queries.map(({ sql, purpose, rowCount, error }) => ({ sql, purpose, rowCount, error })) } };
    },
  },
];

function available(deps: McpDeps): ToolDef[] {
  return TOOLS.filter((t) => (t.needs === "reader" ? !!deps.readerSql : t.needs === "claude" ? !!deps.readerSql && !!deps.messages : true));
}

/** Handle one JSON-RPC message. Returns null for notifications, which get no response. */
export async function handleMcp(deps: McpDeps, msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid Request");
  if (msg.id === undefined) return null; // notifications/initialized, notifications/cancelled, ...

  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: available(deps).map((t) => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = available(deps).find((t) => t.name === name);
      if (!tool) return fail(-32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const r = await tool.call(deps, args);
        return ok({ content: [{ type: "text", text: r.text }], ...(r.structured ? { structuredContent: r.structured } : {}), isError: false });
      } catch (err) {
        // Tool errors go back to the model as results so it can correct the query.
        const message = err instanceof UnsafeSqlError ? err.message : `Error: ${(err as Error).message}`;
        return ok({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}
