import { configureAiReader, createDb, migrate } from "../index.js";

const sql = createDb();
try {
  const ran = await migrate(sql);
  console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date");
  if (await configureAiReader(sql)) console.log("Configured login for erp_ai_reader");
  else console.log("AI_DATABASE_URL not set; erp_ai_reader cannot log in yet");
} finally {
  await sql.end();
}
