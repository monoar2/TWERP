import { describe, expect, it } from "vitest";
import {
  buildBalanzaXml,
  buildCatalogoXml,
  buildCfdiXml,
  buildPolizasXml,
  calcularIsrProvisionalPM,
  computeDocument,
  computeLine,
  determinarIvaMensual,
  IVA_16,
  RETENCION_PRESETS,
  validateCfdi,
  validateRfc,
  type CfdiInput,
} from "./index.js";

describe("validateRfc", () => {
  it("recognizes personas morales, físicas and generic RFCs", () => {
    expect(validateRfc("EKU9003173C9")).toEqual({ valid: true, kind: "moral" });
    expect(validateRfc("XIQB891116QE4")).toEqual({ valid: true, kind: "fisica" });
    expect(validateRfc("XAXX010101000").kind).toBe("generico");
  });
  it("rejects malformed RFCs and impossible dates", () => {
    expect(validateRfc("ABC123").valid).toBe(false);
    expect(validateRfc("EKU9013173C9").valid).toBe(false);
  });
});

describe("taxes", () => {
  it("computes IVA 16% per line rounded to centavos", () => {
    const l = computeLine({ quantity: 3, unitPrice: "33.333", objetoImp: "02", traslados: [IVA_16] });
    expect(l.importe.toFixed(2)).toBe("100.00");
    expect(l.totalTraslados.toFixed(2)).toBe("16.00");
    expect(l.total.toFixed(2)).toBe("116.00");
  });

  it("applies discounts before tax and handles withholdings", () => {
    const l = computeLine({
      quantity: 1,
      unitPrice: 10000,
      discount: 1000,
      objetoImp: "02",
      traslados: [IVA_16],
      retenciones: [RETENCION_PRESETS.ivaDosTercios, RETENCION_PRESETS.isrHonorarios],
    });
    expect(l.base.toFixed(2)).toBe("9000.00");
    expect(l.totalTraslados.toFixed(2)).toBe("1440.00");
    expect(l.totalRetenciones.toFixed(2)).toBe("1860.00"); // 960.00 IVA + 900.00 ISR
    expect(l.total.toFixed(2)).toBe("8580.00");
  });

  it("does not break down taxes when ObjetoImp is not 02", () => {
    const l = computeLine({ quantity: 1, unitPrice: 50, objetoImp: "01", traslados: [IVA_16] });
    expect(l.traslados).toHaveLength(0);
    expect(l.total.toFixed(2)).toBe("50.00");
  });

  it("groups document taxes by impuesto, factor and rate", () => {
    const doc = computeDocument([
      { quantity: 1, unitPrice: 100, objetoImp: "02", traslados: [IVA_16] },
      { quantity: 2, unitPrice: 50, objetoImp: "02", traslados: [IVA_16] },
      { quantity: 1, unitPrice: 30, objetoImp: "02", traslados: [{ impuesto: "002", tipoFactor: "Tasa", rate: "0.000000" }] },
      { quantity: 1, unitPrice: 20, objetoImp: "02", traslados: [{ impuesto: "002", tipoFactor: "Exento" }] },
    ]);
    expect(doc.traslados).toHaveLength(3);
    expect(doc.traslados[0]!.base.toFixed(2)).toBe("200.00");
    expect(doc.traslados[0]!.importe!.toFixed(2)).toBe("32.00");
    expect(doc.total.toFixed(2)).toBe("282.00");
  });

  it("determines monthly IVA a cargo and a favor", () => {
    expect(determinarIvaMensual({ trasladadoCobrado: 1600, acreditablePagado: 1000 }).aCargo.toFixed(2)).toBe("600.00");
    const favor = determinarIvaMensual({ trasladadoCobrado: 100, acreditablePagado: 300, retenidoPorClientes: 50 });
    expect(favor.aFavor.toFixed(2)).toBe("250.00");
    expect(favor.aCargo.toFixed(2)).toBe("0.00");
  });

  it("calculates provisional ISR for personas morales", () => {
    const r = calcularIsrProvisionalPM({
      ingresosNominalesAcumulados: 1_000_000,
      coeficienteUtilidad: "0.1500",
      pagosProvisionalesAnteriores: 20_000,
    });
    expect(r.utilidadFiscalEstimada.toFixed(2)).toBe("150000.00");
    expect(r.isrCausado.toFixed(2)).toBe("45000.00");
    expect(r.isrAPagar.toFixed(2)).toBe("25000.00");
  });
});

const baseCfdi = (): CfdiInput => ({
  serie: "A",
  folio: "1",
  fecha: "2026-10-01T10:00:00",
  tipoDeComprobante: "I",
  formaPago: "03",
  metodoPago: "PUE",
  lugarExpedicion: "06600",
  emisor: { rfc: "EKU9003173C9", nombre: "ESCUELA KEMPER URGATE", regimenFiscal: "601" },
  receptor: { rfc: "XIQB891116QE4", nombre: "BERENICE XIMO QUEZADA", regimenFiscal: "612", domicilioFiscal: "06000", usoCfdi: "G03" },
  conceptos: [
    {
      claveProdServ: "43211503",
      claveUnidad: "H87",
      unidad: "Pieza",
      descripcion: "Laptop & cargador",
      quantity: 2,
      unitPrice: 15000,
      objetoImp: "02",
      traslados: [IVA_16],
    },
  ],
});

describe("CFDI 4.0", () => {
  it("validates a correct invoice without issues", () => {
    expect(validateCfdi(baseCfdi())).toEqual([]);
  });

  it("flags PPD without forma de pago 99 and público en general rules", () => {
    const c = baseCfdi();
    c.metodoPago = "PPD";
    c.receptor = { rfc: "XAXX010101000", nombre: "PUBLICO EN GENERAL", regimenFiscal: "601", domicilioFiscal: "01000", usoCfdi: "G03" };
    const fields = validateCfdi(c).map((i) => i.field);
    expect(fields).toEqual(
      expect.arrayContaining(["formaPago", "receptor.usoCfdi", "receptor.regimenFiscal", "receptor.domicilioFiscal", "informacionGlobal"]),
    );
  });

  it("builds XML with escaped attributes and matching totals", () => {
    const { xml, totals } = buildCfdiXml(baseCfdi());
    expect(totals.total.toFixed(2)).toBe("34800.00");
    expect(xml).toContain('Version="4.0"');
    expect(xml).toContain('SubTotal="30000.00"');
    expect(xml).toContain('Total="34800.00"');
    expect(xml).toContain('Descripcion="Laptop &amp; cargador"');
    expect(xml).toContain('TasaOCuota="0.160000"');
    expect(xml).toContain('TotalImpuestosTrasladados="4800.00"');
    expect(xml).toContain('DomicilioFiscalReceptor="06000"');
  });
});

describe("contabilidad electrónica", () => {
  const h = { rfc: "EKU9003173C9", year: 2026, month: 9 };
  it("builds the chart of accounts", () => {
    const xml = buildCatalogoXml(h, [{ codAgrup: "102.01", numCta: "102.01.01", desc: "Banco", subCtaDe: "102.01", nivel: 3, natur: "D" }]);
    expect(xml).toContain('Mes="09"');
    expect(xml).toContain('CodAgrup="102.01"');
  });
  it("builds the trial balance", () => {
    const xml = buildBalanzaXml(h, [{ numCta: "102.01.01", saldoIni: 0, debe: 116, haber: 0, saldoFin: 116 }]);
    expect(xml).toContain('TipoEnvio="N"');
    expect(xml).toContain('SaldoFin="116.00"');
  });
  it("builds journal entries with CFDI references", () => {
    const xml = buildPolizasXml(
      h,
      [
        {
          numUnIdenPol: "I-1",
          fecha: "2026-09-01",
          concepto: "Venta",
          transacciones: [
            { numCta: "105.01.01", desCta: "Clientes", concepto: "Venta", debe: 116, haber: 0, compNal: { uuid: "abc", rfc: "XAXX010101000", montoTotal: 116 } },
          ],
        },
      ],
      { tipoSolicitud: "AF", numOrden: "ABC6912345/12" },
    );
    expect(xml).toContain('UUID_CFDI="ABC"');
    expect(xml).toContain('NumOrden="ABC6912345/12"');
  });
});
