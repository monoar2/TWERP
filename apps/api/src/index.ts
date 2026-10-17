import Anthropic from "@anthropic-ai/sdk";
import { createDb } from "@erp/db";
import { parseSecretKey } from "./secrets.js";
import { buildServer } from "./server.js";
import { pacFromEnv } from "./services/pac.js";

const sql = createDb(process.env.DATABASE_URL);
const readerSql = process.env.AI_DATABASE_URL ? createDb(process.env.AI_DATABASE_URL, { max: 4 }) : undefined;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined;
const pac = pacFromEnv();
const secretKey = parseSecretKey(process.env.ERP_SECRET_KEY);

if (!anthropic || !readerSql) console.warn("AI queries disabled: set ANTHROPIC_API_KEY and AI_DATABASE_URL");
if (!secretKey) console.warn("ERP_SECRET_KEY is not set: the company CSD can't be stored, so real CFDIs can't be sealed");
if (pac.name === "sandbox") console.warn("PAC_PROVIDER=sandbox: invoices get a fake timbre and are not valid for SAT");
const [count] = await sql<{ users: number }[]>`SELECT count(*)::int AS users FROM users`;
if (count?.users === 0) console.warn("No users yet: create the first administrator with `pnpm --filter @erp/api user:create`");

const app = await buildServer(
  {
    sql,
    readerSql,
    messages: anthropic?.beta.messages,
    aiModel: process.env.AI_MODEL ?? "claude-opus-5-5",
    pac,
    secretKey,
    timezone: process.env.ERP_TIMEZONE ?? "America/Mexico_City",
  },
  { logger: true },
);

await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: "0.0.0.0" });
