import { createPrivateKey, createSign, X509Certificate, type KeyObject } from "node:crypto";
import type { CfdiSigner } from "./cfdi40.js";

/** A Certificado de Sello Digital (CSD) issued by SAT, loaded from its .cer and .key files. */
export interface Csd {
  /** 20-digit certificate number, as it goes in NoCertificado. */
  noCertificado: string;
  /** RFC of the certificate owner. */
  rfc: string;
  nombre: string;
  /** Branch name (OU). SAT puts it on CSDs only; e.firma (FIEL) certificates have none. */
  sucursal: string;
  validFrom: Date;
  validTo: Date;
  certificateBase64: string;
  signer: CfdiSigner;
}

export class CsdError extends Error {}

function subjectField(subject: string, name: string): string {
  const line = subject.split("\n").find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : "";
}

/**
 * Load and check a CSD: the .key (PKCS#8 DER, encrypted with the CSD
 * password) must open with the password and belong to the .cer.
 */
export function loadCsd(cer: Buffer, key: Buffer, password: string, now = new Date()): Csd {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(cer);
  } catch {
    throw new CsdError("El archivo .cer no es un certificado válido");
  }
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key, format: "der", type: "pkcs8", passphrase: password });
  } catch {
    throw new CsdError("No se pudo abrir el archivo .key: revisa la contraseña de la llave privada");
  }
  if (!cert.checkPrivateKey(privateKey)) throw new CsdError("La llave privada no corresponde al certificado");

  // x500UniqueIdentifier holds "RFC" or "RFC / RFC del representante legal".
  const rfc = subjectField(cert.subject, "x500UniqueIdentifier").split("/")[0]!.trim().toUpperCase();
  const sucursal = subjectField(cert.subject, "OU");
  if (!rfc) throw new CsdError("El certificado no contiene un RFC");
  if (!sucursal) throw new CsdError("El certificado parece ser de e.firma (FIEL); para facturar se requiere un CSD");
  const validFrom = new Date(cert.validFrom);
  const validTo = new Date(cert.validTo);
  if (now < validFrom || now > validTo) throw new CsdError(`El certificado no está vigente (vigencia ${cert.validFrom} a ${cert.validTo})`);

  const noCertificado = Buffer.from(cert.serialNumber, "hex").toString("latin1");
  const certificateBase64 = cert.raw.toString("base64");
  return {
    noCertificado,
    rfc,
    nombre: subjectField(cert.subject, "CN"),
    sucursal,
    validFrom,
    validTo,
    certificateBase64,
    signer: {
      noCertificado,
      certificado: certificateBase64,
      sign: (cadena) => createSign("RSA-SHA256").update(cadena, "utf8").sign(privateKey, "base64"),
    },
  };
}
