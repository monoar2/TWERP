import Anthropic from "@anthropic-ai/sdk";
import { configureAiReader, createDb, migrate, seedReferenceData } from "@erp/db";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answerQuestion } from "../ai/agent.js";
import { grade } from "../evals/grade.js";
import { QUESTIONS } from "../evals/questions.js";
import { runAudit } from "../services/auditor.js";
import { seedDemo } from "../services/demo.js";

/**
 * AI eval: build a throwaway database with the demo data, ask every
 * benchmark question through the real assistant and grade the answers
 * against truth queries. Writes evals/results/{report.md,report.json,badge.json}.
 *
 *   ANTHROPIC_API_KEY=... pnpm --filter @erp/api eval [--only id,id] [--repeat N]
 *
 * EVAL_DATABASE_URL (default TEST_DATABASE_URL) must be able to CREATE DATABASE.
 * EVAL_MIN_ACCURACY (0-1) makes the run fail below that score, for CI.
 */
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = flag("--only")?.split(",");
const repeat = Math.max(1, Number(flag("--repeat") ?? 1));
const model = process.env.AI_MODEL ?? "claude-opus-5-5";
const concurrency = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 3));
const minAccuracy = Number(process.env.EVAL_MIN_ACCURACY ?? 0);
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "evals", "results");

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error("Set ANTHROPIC_API_KEY to run the eval.");
  process.exit(1);
}

const adminUrl = process.env.EVAL_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "postgres://erp:erp@localhost:5432/postgres";
const name = `erp_eval_${randomBytes(4).toString("hex")}`;
const admin = createDb(adminUrl, { max: 1 });
await admin.unsafe(`CREATE DATABASE ${name}`);
const url = new URL(adminUrl);
url.pathname = `/${name}`;
const sql = createDb(url.toString());
const readerUrl = new URL(url);
readerUrl.username = "erp_ai_reader";
readerUrl.password = randomBytes(12).toString("hex");
const readerSql = createDb(readerUrl.toString(), { max: concurrency });

try {
  console.log(`Preparing ${name} with the demo data…`);
  await migrate(sql);
  await configureAiReader(sql, readerUrl.toString());
  await sql.unsafe(`GRANT CONNECT ON DATABASE ${name} TO erp_ai_reader`);
  await seedReferenceData(sql, { rfc: "EKU9003173C9", razonSocial: "ESCUELA KEMPER URGATE", regimenFiscal: "601", codigoPostal: "42501" });
  await seedDemo(sql, { createAdmin: false });
  await runAudit({ sql, model }, "manual");

  const messages = new Anthropic().beta.messages;
  const cases = QUESTIONS.filter((q) => !only || only.includes(q.id)).flatMap((q) => Array.from({ length: repeat }, (_, run) => ({ q, run })));
  const results: Array<{
    id: string; category: string; run: number; question: string; pass: boolean; missing: string[]; answer: string;
    queries: number; sqlErrors: number; inputTokens: number; outputTokens: number; ms: number; error?: string;
  }> = [];

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
    while (next < cases.length) {
      const { q, run } = cases[next++]!;
      const truth = [...(await sql.unsafe(q.truth))] as Record<string, unknown>[];
      const started = Date.now();
      try {
        const r = await answerQuestion({ db: sql, readerDb: readerSql, messages, model }, q.question);
        const g = grade(r.answer, truth, q);
        results.push({
          id: q.id, category: q.category, run, question: q.question, pass: g.pass, missing: g.missing, answer: r.answer,
          queries: r.queries.length, sqlErrors: r.queries.filter((x) => x.error).length,
          inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, ms: Date.now() - started,
        });
        console.log(`${g.pass ? "PASS" : "FAIL"} ${q.id}${repeat > 1 ? `#${run + 1}` : ""}${g.pass ? "" : ` (missing ${g.missing.join(", ")})`}`);
      } catch (err) {
        results.push({
          id: q.id, category: q.category, run, question: q.question, pass: false, missing: [], answer: "", queries: 0, sqlErrors: 0,
          inputTokens: 0, outputTokens: 0, ms: Date.now() - started, error: (err as Error).message,
        });
        console.log(`ERROR ${q.id}: ${(err as Error).message}`);
      }
    }
  }));

  results.sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run);
  const passed = results.filter((r) => r.pass).length;
  const accuracy = results.length ? passed / results.length : 0;
  const pct = Math.round(accuracy * 100);
  const tokens = results.reduce((s, r) => ({ input: s.input + r.inputTokens, output: s.output + r.outputTokens }), { input: 0, output: 0 });
  const categories = [...new Set(results.map((r) => r.category))];
  const byCategory = categories.map((cat) => {
    const rs = results.filter((r) => r.category === cat);
    return `| ${cat} | ${rs.filter((r) => r.pass).length}/${rs.length} |`;
  }).join("\n");

  const md = `# AI eval

**${passed}/${results.length} correct (${pct}%)** · model \`${model}\` · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
· ${tokens.input.toLocaleString("en")} input / ${tokens.output.toLocaleString("en")} output tokens
· median ${median(results.map((r) => r.ms))} ms per question

| Category | Correct |
|---|---|
${byCategory}

| Question | Result | SQL queries | Missing from the answer |
|---|---|---|---|
${results.map((r) => `| \`${r.id}\`${repeat > 1 ? ` #${r.run + 1}` : ""} ${r.question} | ${r.pass ? "✅" : "❌"} | ${r.queries}${r.sqlErrors ? ` (${r.sqlErrors} failed)` : ""} | ${r.error ?? r.missing.join(", ")} |`).join("\n")}
`;
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "report.md"), md);
  await writeFile(join(outDir, "report.json"), JSON.stringify({ model, accuracy, passed, total: results.length, tokens, results }, null, 2));
  await writeFile(join(outDir, "badge.json"), JSON.stringify({
    schemaVersion: 1, label: "AI eval", message: `${pct}%`, color: pct >= 90 ? "brightgreen" : pct >= 75 ? "yellow" : "red",
  }));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(`\n${passed}/${results.length} correct (${pct}%). Report: ${join(outDir, "report.md")}`);
  if (accuracy < minAccuracy) process.exitCode = 1;
} finally {
  await readerSql.end();
  await sql.end();
  if (!process.env.EVAL_KEEP_DB) await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
  await admin.end();
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}
