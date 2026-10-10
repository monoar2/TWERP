import { randomUUID } from "node:crypto";

/**
 * A PAC (Proveedor Autorizado de Certificación) signs CFDIs with the SAT
 * timbre. Real providers (Finkok, SW Sapien, Facturama, FacturAPI, ...) are
 * plugged in by implementing this interface; most accept unsigned XML plus
 * the issuer's CSD and return the stamped XML.
 */
export interface PacProvider {
  readonly name: string;
  stamp(xml: string): Promise<{ uuid: string; xml: string; stampedAt: string }>;
  cancel(uuid: string, motivo: string, folioSustitucion?: string): Promise<{ status: "cancelled" | "pending"; acuse?: string }>;
}

/**
 * Development provider: returns a fake TimbreFiscalDigital so the full flow
 * can be exercised. The result is NOT a valid CFDI for SAT.
 */
export class SandboxPac implements PacProvider {
  readonly name = "sandbox";

  async stamp(xml: string) {
    const uuid = randomUUID().toUpperCase();
    const stampedAt = new Date().toISOString().slice(0, 19);
    const tfd =
      `<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"` +
      ` Version="1.1" UUID="${uuid}" FechaTimbrado="${stampedAt}" RfcProvCertif="SPR190613I52"` +
      ` SelloCFD="SANDBOX" NoCertificadoSAT="00000000000000000000" SelloSAT="SANDBOX"/></cfdi:Complemento>`;
    return { uuid, stampedAt, xml: xml.replace("</cfdi:Comprobante>", `${tfd}\n</cfdi:Comprobante>`) };
  }

  async cancel() {
    return { status: "cancelled" as const };
  }
}
