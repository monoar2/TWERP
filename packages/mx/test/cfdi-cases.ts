import { IVA_16, type CfdiInput } from "../src/index.js";

const emisor = { rfc: "EKU9003173C9", nombre: "ESCUELA KEMPER URGATE", regimenFiscal: "601" };
const receptor = { rfc: "XIQB891116QE4", nombre: "BERENICE XIMO QUEZADA", regimenFiscal: "612", domicilioFiscal: "06000", usoCfdi: "G03" };

/**
 * CFDIs covering every node the builder emits. Their cadenas originales in
 * cadenas.json were produced by SAT's cadenaoriginal_4_0.xslt.
 */
export const CFDI_CASES: Record<string, CfdiInput> = {
  simple: {
    serie: "A", folio: "1", fecha: "2026-10-01T10:00:00", tipoDeComprobante: "I", formaPago: "03", metodoPago: "PUE",
    lugarExpedicion: "06000", emisor, receptor,
    conceptos: [{ claveProdServ: "43211503", noIdentificacion: "LAP-01", claveUnidad: "H87", unidad: "Pieza", descripcion: "Laptop & cargador <15\">",
      quantity: 2, unitPrice: 15000, objetoImp: "02", traslados: [IVA_16] }],
  },
  retencionesYDescuento: {
    serie: "B", folio: "27", fecha: "2026-10-02T09:30:15", tipoDeComprobante: "I", formaPago: "99", metodoPago: "PPD",
    lugarExpedicion: "64000", emisor, receptor: { ...receptor, rfc: "EKU9003173C9", nombre: "ESCUELA KEMPER URGATE", regimenFiscal: "601" },
    conceptos: [
      { claveProdServ: "80111600", claveUnidad: "E48", descripcion: "  Servicio   de\tconsultoría  ", quantity: 1, unitPrice: "10000.50", discount: "500.25",
        objetoImp: "02", traslados: [IVA_16],
        retenciones: [{ impuesto: "002", rate: "0.106667" }, { impuesto: "001", rate: "0.100000" }] },
      { claveProdServ: "01010101", claveUnidad: "ACT", descripcion: "Exento", quantity: "3.5", unitPrice: "100", objetoImp: "02",
        traslados: [{ impuesto: "002", tipoFactor: "Exento" }] },
      { claveProdServ: "50202306", claveUnidad: "H87", descripcion: "Tasa cero", quantity: 4, unitPrice: "12.345678", objetoImp: "02",
        traslados: [{ impuesto: "002", tipoFactor: "Tasa", rate: "0.000000" }] },
      { claveProdServ: "84111506", claveUnidad: "E48", descripcion: "No objeto", quantity: 1, unitPrice: 50, objetoImp: "01" },
    ],
  },
  globalYRelacionados: {
    serie: "G", folio: "3", fecha: "2026-10-03T23:59:59", tipoDeComprobante: "E", formaPago: "01", metodoPago: "PUE",
    lugarExpedicion: "06000", emisor,
    receptor: { rfc: "XAXX010101000", nombre: "PUBLICO EN GENERAL", regimenFiscal: "616", domicilioFiscal: "06000", usoCfdi: "S01" },
    informacionGlobal: { periodicidad: "04", meses: "09", anio: 2026 },
    relacionados: { tipoRelacion: "01", uuids: ["5FB2822E-396D-4725-8521-CDC4BDD20CCF", "6FB2822E-396D-4725-8521-CDC4BDD20CCE"] },
    conceptos: [{ claveProdServ: "01010101", claveUnidad: "ACT", descripcion: "Venta", quantity: 1, unitPrice: "1000", objetoImp: "02", traslados: [IVA_16] }],
  },
};
