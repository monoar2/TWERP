import { describe, expect, it } from "vitest";
import { buildCfdiXml, CfdiParseError, conceptoRates, parseCfdi } from "../src/index.js";
import { CFDI_CASES } from "./cfdi-cases.js";

const TFD =
  `<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1"` +
  ` UUID="5fb2822e-396d-4725-8521-cdc4bdd20ccf" FechaTimbrado="2026-10-02T09:31:00" SelloSAT="x"/></cfdi:Complemento>`;
const stamp = (xml: string) => xml.replace("</cfdi:Comprobante>", `${TFD}</cfdi:Comprobante>`);

describe("parseCfdi", () => {
  it("reads back what the builder emits, including the timbre", () => {
    const built = buildCfdiXml(CFDI_CASES.simple!);
    const p = parseCfdi(stamp(built.xml));
    expect(p.version).toBe("4.0");
    expect(p.emisor).toEqual({ rfc: "EKU9003173C9", nombre: "ESCUELA KEMPER URGATE", regimenFiscal: "601" });
    expect(p.receptor.rfc).toBe("XIQB891116QE4");
    expect(p.uuid).toBe("5FB2822E-396D-4725-8521-CDC4BDD20CCF");
    expect(p.total).toBe(built.totals.total.toFixed(2));
    expect(p.conceptos).toHaveLength(1);
    // Entities in attributes are decoded.
    expect(p.conceptos[0]!.descripcion).toBe('Laptop & cargador <15">');
    expect(p.conceptos[0]!.noIdentificacion).toBe("LAP-01");
    expect(conceptoRates(p.conceptos[0]!)).toEqual({ ivaRate: "0.160000", retIvaRate: "0", retIsrRate: "0" });
  });

  it("handles withholdings, exempt and tax-free lines", () => {
    const p = parseCfdi(buildCfdiXml(CFDI_CASES.retencionesYDescuento!).xml);
    expect(p.uuid).toBeNull();
    expect(p.metodoPago).toBe("PPD");
    const [servicio, exento, tasaCero, noObjeto] = p.conceptos.map(conceptoRates);
    expect(servicio).toEqual({ ivaRate: "0.160000", retIvaRate: "0.106667", retIsrRate: "0.100000" });
    expect(exento!.ivaRate).toBe("0");
    expect(tasaCero!.ivaRate).toBe("0.000000");
    expect(noObjeto).toEqual({ ivaRate: "0", retIvaRate: "0", retIsrRate: "0" });
    expect(p.conceptos[0]!.descuento).toBe("500.25");
  });

  it("rejects files that are not CFDIs", () => {
    expect(() => parseCfdi("<factura/>")).toThrow(CfdiParseError);
    expect(() => parseCfdi("<cfdi:Comprobante Version=\"4.0\"><cfdi:Emisor")).toThrow(CfdiParseError);
    expect(() => parseCfdi('<cfdi:Comprobante Version="2.0"/>')).toThrow(/Versión/);
  });
});
