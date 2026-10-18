import Anthropic from "@anthropic-ai/sdk";
import { createDb } from "@erp/db";
import { runAudit } from "../services/auditor.js";

/** Run the auditor once, e.g. from cron when the API's own schedule is off (AUDIT_INTERVAL_HOURS=0). */
const sql = createDb();
const messages = process.env.ANTHROPIC_API_KEY ? new Anthropic().beta.messages : undefined;
try {
  const r = await runAudit({ sql, messages, model: process.env.AI_MODEL ?? "claude-opus-5-5" }, "schedule");
  if (!r) console.log("Another audit is running; skipped.");
  else console.log(`Run ${r.runId}: ${r.findings} open finding(s), ${r.newFindings} new, ${r.resolved} resolved.\n\n${r.summary ?? ""}`);
} finally {
  await sql.end();
}
