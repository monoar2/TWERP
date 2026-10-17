import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MessagesApi } from "../src/ai/agent.js";
import { guardSql, UnsafeSqlError } from "../src/ai/sql-guard.js";
import { call, createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
  await call(env.app, "POST", "/products", { sku: "PAP-01", name: "Papel bond", claveProdServ: "14111507", claveUnidad: "XBX", salePrice: 90 });
}, 60_000);
afterAll(async () => env?.close());

/** Fake Claude that replays scripted responses and records requests. */
function scripted(steps: Array<{ sql?: string; text?: string }>) {
  const requests: any[] = [];
  let i = 0;
  const api = {
    create: async (params: any) => {
      requests.push(structuredClone(params));
      const step = steps[i++]!;
      const usage = { input_tokens: 10, output_tokens: 5 };
      if (step.sql) {
        return { stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: `tu_${i}`, name: "run_sql", input: { sql: step.sql, purpose: "test" } }] };
      }
      return { stop_reason: "end_turn", usage, content: [{ type: "text", text: step.text }] };
    },
  } as unknown as MessagesApi;
  return { api, requests };
}

describe("AI query", () => {
  it("runs model SQL read-only and returns the answer with its queries", async () => {
    const fake = scripted([{ sql: "SELECT sku, name, sale_price FROM ai.products" }, { text: "Hay 1 producto: Papel bond." }]);
    env.setMessages(fake.api);
    const r = await call(env.app, "POST", "/ai/query", { question: "¿Qué productos tengo?" });
    expect(r.answer).toBe("Hay 1 producto: Papel bond.");
    expect(r.queries[0].rows).toEqual([{ sku: "PAP-01", name: "Papel bond", sale_price: "90.000000" }]);
    // The schema is in the system prompt and the tool result went back to the model.
    expect(fake.requests[0].system[0].text).toContain("ai.stock_levels");
    expect(fake.requests[0].model).toBe("claude-opus-5-5");
    expect(JSON.stringify(fake.requests[1].messages)).toContain("Papel bond");
    const log = await env.sql`SELECT question FROM ai_query_log`;
    expect(log).toHaveLength(1);
  });

  it("returns blocked statements to the model as tool errors", async () => {
    const fake = scripted([{ sql: "DELETE FROM ai.products" }, { sql: "SELECT * FROM public.products" }, { text: "No puedo modificar datos." }]);
    env.setMessages(fake.api);
    const r = await call(env.app, "POST", "/ai/query", { question: "Borra los productos" });
    expect(r.queries.map((q: any) => !!q.error)).toEqual([true, true]);
    const products = await env.sql`SELECT count(*)::int AS n FROM products`;
    expect(products[0]!.n).toBe(1);
  });

  it("is confined by the database role even if the guard is bypassed", async () => {
    await expect(env.readerSql.unsafe("SELECT * FROM public.products")).rejects.toThrow(/permission denied/);
    await expect(env.readerSql.unsafe("INSERT INTO ai_query_log (question) VALUES ('x')")).rejects.toThrow(/read-only|permission denied|does not exist/);
  });
});

describe("guardSql", () => {
  it("accepts SELECT and WITH, stripping a trailing semicolon", () => {
    expect(guardSql("select 1;")).toBe("select 1");
    expect(guardSql("WITH x AS (SELECT 1) SELECT * FROM x")).toContain("WITH");
    expect(guardSql("SELECT 'delete; drop' AS note FROM ai.products")).toContain("delete; drop");
  });
  it("rejects writes, multiple statements and dangerous functions", () => {
    for (const bad of ["DELETE FROM ai.products", "SELECT 1; DROP TABLE x", "SELECT pg_sleep(10)", "SELECT * FROM pg_catalog.pg_roles", "/* x */ UPDATE a SET b=1"]) {
      expect(() => guardSql(bad), bad).toThrow(UnsafeSqlError);
    }
  });
});
