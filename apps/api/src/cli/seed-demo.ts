import { createDb } from "@erp/db";
import { seedDemo } from "../services/demo.js";

/** Load the demo data into DATABASE_URL (see services/demo.ts). */
const sql = createDb();
try {
  const r = await seedDemo(sql);
  if (!r.loaded) console.log("The database already has products; demo data not loaded.");
  else {
    console.log(`Demo data loaded: ${r.invoices} stamped invoices for ${r.total} MXN`);
    if (r.demoLogin) console.log(`Demo login: ${r.demoLogin}`);
  }
} finally {
  await sql.end();
}
