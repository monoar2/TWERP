import { randomBytes } from "node:crypto";
import { configureAiReader, createDb, migrate, seedReferenceData, type Sql } from "@erp/db";
import type { FastifyInstance } from "fastify";
import type { MessagesApi } from "../src/ai/agent.js";
import { buildServer } from "../src/server.js";
import { createSession } from "../src/auth/sessions.js";
import { SandboxPac, type PacProvider } from "../src/services/pac.js";
import { createUser } from "../src/services/users.js";

/** Admin connection used to create a throwaway database per test file. */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://erp:erp@localhost:5432/postgres";
const READER_PASSWORD = "erp_ai_reader_test";

export interface TestEnv {
  app: FastifyInstance;
  /** Bearer token of the admin user every `call` signs in as. */
  adminToken: string;
  sql: Sql;
  readerSql: Sql;
  setMessages(m: MessagesApi): void;
  close(): Promise<void>;
}

export async function createTestEnv(opts: { pac?: PacProvider } = {}): Promise<TestEnv> {
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
  const ctx = {
    sql, readerSql, aiModel: "claude-opus-5-5", pac: opts.pac ?? new SandboxPac(), secretKey: randomBytes(32), timezone: "America/Mexico_City",
    get messages() { return messages; },
  };
  const app = await buildServer(ctx);
  const admin_ = await createUser(sql, { email: "admin@test.mx", name: "Admin", role: "admin", password: "contraseña-segura" });
  const adminToken = (await createSession(sql, admin_.id)).token;
  tokens.set(app, adminToken);
  return {
    app,
    adminToken,
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

const tokens = new WeakMap<FastifyInstance, string>();

/** Inject a JSON request as the admin user and fail loudly on unexpected status codes. */
export async function call<T = any>(app: FastifyInstance, method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown, expected = [200, 201]): Promise<T> {
  return callAs<T>(app, tokens.get(app), method, url, body, expected);
}

/** Like `call` with an explicit bearer token (undefined sends none). */
export async function callAs<T = any>(
  app: FastifyInstance, token: string | undefined, method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown, expected = [200, 201],
): Promise<T> {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await app.inject({ method, url, headers, payload: body as object | undefined });
  if (!expected.includes(res.statusCode)) throw new Error(`${method} ${url} -> ${res.statusCode}: ${res.body}`);
  return (res.headers["content-type"]?.toString().includes("json") ? res.json() : res.body) as T;
}

/** app.inject signed in as the admin user, for asserting on error responses. */
export function inject(app: FastifyInstance, opts: { method: "GET" | "POST" | "PUT" | "PATCH"; url: string; payload?: object }) {
  const token = tokens.get(app);
  return app.inject({ ...opts, headers: token ? { authorization: `Bearer ${token}` } : {} });
}
