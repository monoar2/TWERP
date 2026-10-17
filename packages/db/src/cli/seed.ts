import { createDb, seedReferenceData } from "../index.js";

// Defaults to the SAT test taxpayer used in CFDI sandboxes; set COMPANY_* to your own data.
const sql = createDb();
try {
  await seedReferenceData(sql, {
    rfc: process.env.COMPANY_RFC ?? "EKU9003173C9",
    razonSocial: process.env.COMPANY_NAME ?? "ESCUELA KEMPER URGATE",
    regimenFiscal: process.env.COMPANY_REGIMEN ?? "601",
    codigoPostal: process.env.COMPANY_CP ?? "42501",
  });
  console.log("Reference data loaded");
} finally {
  await sql.end();
}
