import Anthropic from "@anthropic-ai/sdk";
import { createDb } from "@erp/db";
import { buildServer } from "./server.js";
import { SandboxPac } from "./services/pac.js";

const sql = createDb(process.env.DATABASE_URL);
const readerSql = process.env.AI_DATABASE_URL ? createDb(process.env.AI_DATABASE_URL, { max: 4 }) : undefined;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined;

if (!process.env.ERP_API_TOKEN) console.warn("ERP_API_TOKEN is not set: the API accepts unauthenticated requests");
if (!anthropic || !readerSql) console.warn("AI queries disabled: set ANTHROPIC_API_KEY and AI_DATABASE_URL");

const app = await buildServer(
  {
    sql,
    readerSql,
    messages: anthropic?.beta.messages,
    aiModel: process.env.AI_MODEL ?? "claude-opus-5-5",
    pac: new SandboxPac(),
    apiToken: process.env.ERP_API_TOKEN,
  },
  { logger: true },
);

await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: "0.0.0.0" });
