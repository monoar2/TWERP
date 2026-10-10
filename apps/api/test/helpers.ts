import { randomBytes } from "node:crypto";
import { configureAiReader, createDb, migrate, seedReferenceData, type Sql } from "@erp/db";
import type { FastifyInstance } from "fastify";
import type { MessagesApi } from "../src/ai/agent.js";
import { buildServer } from "../src/server.js";
import { SandboxPac } from "../src/services/pac.js";

/** Admin connection used to create a throwaway database per test file. */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://erp:erp@localhost:5432/postgres";
const READER_PASSWORD = "erp_ai_reader_test";

export interface TestEnv {
  app: FastifyInstance;
  sql: Sql;
  readerSql: Sql;
  setMessages(m: MessagesApi): void;
  close(): Promise<void>;
}

export async function createTestEnv(): Promise<TestEnv> {
  const name = `erp_test_${randomBytes(4).toString("hex")}`;
  const admin = createDb(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const sql = createDb(url.toString());
  await migrate(sql);
  const readerUrl = new URL(url);
  readerUrl.username = "erp_ai_reader";
  readerUrl.password = READER_PASSWORD;
  await configureAiReader(sql, readerUrl.toString());
  await sql.unsafe(`GRANT CONNECT ON DATABASE ${name} TO erp_ai_reader`);
  await seedReferenceData(sql, { rfc: "EKU9003173C9", razonSocial: "ESCUELA KEMPER URGATE", regimenFiscal: "601", codigoPostal: "42501" });
  const readerSql = createDb(readerUrl.toString(), { max: 2 });

  let messages: MessagesApi | undefined;
  const ctx = { sql, readerSql, aiModel: "claude-opus-5-5", pac: new SandboxPac(), get messages() { return messages; } };
  const app = await buildServer(ctx);
  return {
    app,
    sql,
    readerSql,
    setMessages: (m) => { messages = m; },
    async close() {
      await app.close();
      await readerSql.end();
      await sql.end();
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Inject a JSON request and fail loudly on unexpected status codes. */
export async function call<T = any>(app: FastifyInstance, method: "GET" | "POST" | "PUT", url: string, body?: unknown, expected = [200, 201]): Promise<T> {
  const res = await app.inject({ method, url, payload: body as object | undefined });
  if (!expected.includes(res.statusCode)) throw new Error(`${method} ${url} -> ${res.statusCode}: ${res.body}`);
  return (res.headers["content-type"]?.toString().includes("json") ? res.json() : res.body) as T;
}
