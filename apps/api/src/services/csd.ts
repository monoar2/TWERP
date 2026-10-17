import { CsdError, loadCsd, type Csd } from "@erp/mx";
import type { Db } from "@erp/db";
import { AppError, badRequest } from "../errors.js";
import { decrypt, encrypt } from "../secrets.js";

export interface CsdInfo {
  rfc: string;
  noCertificado: string;
  validFrom: string;
  validTo: string;
  uploadedAt: string;
}

const noSecretKey = () => new AppError(503, "Configura ERP_SECRET_KEY en el servidor para guardar el CSD (openssl rand -hex 32)");

/** Check and store the company's CSD, replacing the active one. */
export async function saveCsd(
  tx: Db, secretKey: Buffer | undefined, files: { cer: Buffer; key: Buffer; password: string }, userId?: number,
): Promise<CsdInfo> {
  if (!secretKey) throw noSecretKey();
  let csd: Csd;
  try {
    csd = loadCsd(files.cer, files.key, files.password);
  } catch (err) {
    if (err instanceof CsdError) throw badRequest(err.message);
    throw err;
  }
  const [company] = await tx<{ rfc: string }[]>`SELECT rfc FROM company WHERE id = 1`;
  if (!company) throw badRequest("Configura los datos fiscales de la empresa antes de subir el CSD");
  if (company.rfc.toUpperCase() !== csd.rfc) throw badRequest(`El CSD es del RFC ${csd.rfc} y la empresa tiene el RFC ${company.rfc}`);

  await tx`UPDATE company_csd SET active = false WHERE active`;
  await tx`DELETE FROM company_csd WHERE no_certificado = ${csd.noCertificado}`;
  await tx`
    INSERT INTO company_csd (rfc, no_certificado, certificate, key_encrypted, password_encrypted, valid_from, valid_to, uploaded_by)
    VALUES (${csd.rfc}, ${csd.noCertificado}, ${files.cer}, ${encrypt(secretKey, files.key)},
            ${encrypt(secretKey, Buffer.from(files.password, "utf8"))}, ${csd.validFrom}, ${csd.validTo}, ${userId ?? null})`;
  return (await csdInfo(tx))!;
}

export async function csdInfo(tx: Db): Promise<CsdInfo | null> {
  const [row] = await tx<CsdInfo[]>`
    SELECT rfc, no_certificado AS "noCertificado", valid_from AS "validFrom", valid_to AS "validTo", uploaded_at AS "uploadedAt"
    FROM company_csd WHERE active`;
  return row ?? null;
}

/** The active CSD, decrypted, with its files (the PAC needs them to cancel). */
export async function activeCsd(tx: Db, secretKey: Buffer | undefined): Promise<{ csd: Csd; cer: Buffer; key: Buffer; password: string } | undefined> {
  const [row] = await tx<{ certificate: Buffer; key_encrypted: Buffer; password_encrypted: Buffer }[]>`
    SELECT certificate, key_encrypted, password_encrypted FROM company_csd WHERE active`;
  if (!row) return undefined;
  if (!secretKey) throw noSecretKey();
  const key = decrypt(secretKey, row.key_encrypted);
  const password = decrypt(secretKey, row.password_encrypted).toString("utf8");
  try {
    return { csd: loadCsd(row.certificate, key, password), cer: row.certificate, key, password };
  } catch (err) {
    if (err instanceof CsdError) throw new AppError(422, `El CSD guardado ya no se puede usar: ${err.message}`);
    throw err;
  }
}
