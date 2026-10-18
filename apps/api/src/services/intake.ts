import { computeLine, conceptoRates, D, IMPUESTOS, parseCfdi, validateRfc, type ParsedCfdi } from "@erp/mx";
import type { Db, Sql } from "@erp/db";
import type { MessagesApi } from "../ai/agent.js";
import { extractWithClaude, type ExtractedDocument, type ExtractMediaType } from "../ai/extract.js";
import { similarity } from "../ai/similarity.js";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import { createSupplierInvoice, validateSupplierInvoice, type SupplierLineInput } from "./purchases.js";

/**
 * Document intake: turn a received CFDI XML, a PDF or a photo into a draft
 * supplier invoice. XML is parsed exactly; PDFs and images are read by Claude.
 * Either way the result is matched against suppliers and products and kept
 * as a suggestion until a user confirms it.
 */

export interface IntakeDeps {
  sql: Sql;
  messages?: MessagesApi;
  model: string;
}

export interface SuggestedLine extends Required<Pick<SupplierLineInput, "qty" | "unitPrice">> {
  description: string;
  productId: number | null;
  productName: string | null;
  matchedBy: "sku" | "name" | null;
  score: number | null;
  discount: string;
  ivaRate: string;
  retIvaRate: string;
  retIsrRate: string;
}

export interface IntakeSuggestion {
  thirdPartyId: number | null;
  supplierName: string | null;
  /** Filled when the supplier is not registered yet; confirming creates it. */
  newSupplier: { name: string; rfc: string; regimenFiscal: string; codigoPostal: string } | null;
  warehouseId: number | null;
  supplierRef: string | null;
  uuid: string | null;
  issueDate: string | null;
  metodoPago: "PUE" | "PPD";
  lines: SuggestedLine[];
  computedTotal: string;
}

export interface IntakeWarning { level: "error" | "warning" | "info"; message: string }

const MAX_BYTES = 10 * 1024 * 1024;
const NAME_MATCH_THRESHOLD = 0.5;
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

export function detectSource(fileName: string, mediaType: string, content: Buffer): "cfdi_xml" | "pdf" | "image" {
  const head = content.subarray(0, 64).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/xml/i.test(mediaType) || /\.xml$/i.test(fileName) || head.startsWith("<")) return "cfdi_xml";
  if (mediaType === "application/pdf" || content.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (/^image\/(jpeg|png|gif|webp)$/.test(mediaType)) return "image";
  throw badRequest("Formato no soportado: sube el XML del CFDI, un PDF o una foto (JPG, PNG, WEBP)");
}

/** Map a parsed CFDI to the intake's document shape. */
export function fromCfdi(c: ParsedCfdi): ExtractedDocument {
  return {
    documentType: c.tipoDeComprobante === "I" ? "invoice" : "other",
    supplier: { rfc: c.emisor.rfc, name: c.emisor.nombre, regimenFiscal: c.emisor.regimenFiscal, codigoPostal: c.lugarExpedicion },
    receiverRfc: c.receptor.rfc,
    uuid: c.uuid,
    reference: [c.serie, c.folio].filter(Boolean).join("-") || null,
    issueDate: c.fecha.slice(0, 10) || null,
    metodoPago: c.metodoPago === "PPD" ? "PPD" : c.metodoPago === "PUE" ? "PUE" : null,
    currency: c.moneda,
    lines: c.conceptos.map((k) => ({
      description: k.descripcion, sku: k.noIdentificacion, claveProdServ: k.claveProdServ,
      qty: k.cantidad, unitPrice: k.valorUnitario, discount: k.descuento, ...conceptoRates(k),
    })),
    subtotal: c.subTotal,
    iva: c.totalImpuestosTrasladados,
    total: c.total,
    notes: [],
  };
}

const decimal = (v: string | null | undefined, fallback = "0") => {
  const s = (v ?? "").replace(/[$,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? s : fallback;
};

/** Total the ERP will compute for these lines, using the same math as supplier invoices. */
function linesTotal(lines: Array<Pick<SuggestedLine, "qty" | "unitPrice" | "discount" | "ivaRate" | "retIvaRate" | "retIsrRate">>) {
  return lines.reduce((s, l) => {
    const t = computeLine({
      quantity: l.qty, unitPrice: l.unitPrice, discount: l.discount, objetoImp: "02",
      traslados: [{ impuesto: IMPUESTOS.IVA, tipoFactor: "Tasa", rate: String(l.ivaRate) }],
      retenciones: [
        ...(D(l.retIvaRate).gt(0) ? [{ impuesto: IMPUESTOS.IVA, rate: String(l.retIvaRate) }] : []),
        ...(D(l.retIsrRate).gt(0) ? [{ impuesto: IMPUESTOS.ISR, rate: String(l.retIsrRate) }] : []),
      ],
    });
    return s.plus(t.total);
  }, D(0));
}

/** Match the document to the ERP's suppliers, products and warehouse; collect warnings. */
export async function suggest(db: Db, doc: ExtractedDocument): Promise<{ suggestion: IntakeSuggestion; warnings: IntakeWarning[] }> {
  const warnings: IntakeWarning[] = [];
  const rfc = doc.supplier.rfc?.toUpperCase().trim() || null;
  const [company] = await db<{ rfc: string }[]>`SELECT rfc FROM company WHERE id = 1`;

  if (doc.documentType === "other") warnings.push({ level: "warning", message: "El documento no parece una factura o ticket de compra." });
  if (doc.receiverRfc && company && doc.receiverRfc.toUpperCase() !== company.rfc.toUpperCase())
    warnings.push({ level: "error", message: `La factura está a nombre de ${doc.receiverRfc}, no de tu empresa (${company.rfc}). El IVA no sería acreditable.` });
  if (doc.currency && doc.currency !== "MXN")
    warnings.push({ level: "warning", message: `La factura está en ${doc.currency}; se registrará con los importes tal cual, sin tipo de cambio.` });

  let thirdPartyId: number | null = null;
  let supplierName: string | null = doc.supplier.name;
  let newSupplier: IntakeSuggestion["newSupplier"] = null;
  if (rfc) {
    const [party] = await db<{ id: number; name: string; is_supplier: boolean }[]>`
      SELECT id, name, is_supplier FROM third_parties WHERE upper(rfc) = ${rfc} AND active ORDER BY is_supplier DESC, id LIMIT 1`;
    if (party) {
      thirdPartyId = party.id;
      supplierName = party.name;
      if (!party.is_supplier) warnings.push({ level: "info", message: `${party.name} está registrado como cliente; al confirmar también se marcará como proveedor.` });
    } else {
      newSupplier = {
        name: doc.supplier.name ?? rfc, rfc,
        regimenFiscal: doc.supplier.regimenFiscal ?? (validateRfc(rfc).kind === "fisica" ? "612" : "601"),
        codigoPostal: /^\d{5}$/.test(doc.supplier.codigoPostal ?? "") ? doc.supplier.codigoPostal! : "",
      };
      warnings.push({ level: "info", message: `${newSupplier.name} (${rfc}) no está registrado; se dará de alta como proveedor al confirmar.` });
      if (!newSupplier.codigoPostal) warnings.push({ level: "warning", message: "Falta el código postal del proveedor nuevo; captúralo antes de confirmar." });
    }
    if (!validateRfc(rfc).valid) warnings.push({ level: "warning", message: `El RFC del proveedor (${rfc}) no tiene un formato válido.` });
    const [blacklisted] = await db<{ situacion: string }[]>`SELECT situacion FROM sat_69b WHERE rfc = ${rfc}`;
    if (blacklisted && !/desvirtuado|favorable/i.test(blacklisted.situacion))
      warnings.push({ level: "error", message: `El proveedor aparece en la lista 69-B del SAT (${blacklisted.situacion}): sus facturas pueden considerarse operaciones simuladas.` });
  } else {
    warnings.push({ level: "error", message: "No se encontró el RFC del proveedor; selecciónalo manualmente." });
  }

  const uuid = doc.uuid && UUID_RE.test(doc.uuid) ? doc.uuid.toUpperCase() : null;
  if (uuid) {
    const [dup] = await db<{ id: number }[]>`SELECT id FROM supplier_invoices WHERE upper(uuid) = ${uuid} AND status <> 'cancelled'`;
    if (dup) warnings.push({ level: "error", message: `Este CFDI ya está registrado (factura de proveedor #${dup.id}).` });
  } else {
    warnings.push({ level: "warning", message: "El comprobante no tiene folio fiscal (UUID): el IVA no es acreditable sin CFDI." });
  }

  const products = await db<{ id: number; sku: string; name: string; clave_prod_serv: string }[]>`
    SELECT id, sku, name, clave_prod_serv FROM products WHERE active`;
  const lines: SuggestedLine[] = doc.lines.map((l) => {
    const bySku = l.sku ? products.find((p) => p.sku.toUpperCase() === l.sku!.toUpperCase()) : undefined;
    let match: { id: number; name: string; by: "sku" | "name"; score: number } | null = bySku ? { id: bySku.id, name: bySku.name, by: "sku", score: 1 } : null;
    if (!match) {
      let best: { p: (typeof products)[number]; score: number } | undefined;
      for (const p of products) {
        // Same SAT key is a strong hint that it is the same kind of product.
        const score = similarity(l.description, p.name) + (l.claveProdServ && l.claveProdServ === p.clave_prod_serv ? 0.15 : 0);
        if (!best || score > best.score) best = { p, score };
      }
      if (best && best.score >= NAME_MATCH_THRESHOLD) match = { id: best.p.id, name: best.p.name, by: "name", score: Math.min(1, Number(best.score.toFixed(2))) };
    }
    return {
      description: l.description,
      productId: match?.id ?? null, productName: match?.name ?? null, matchedBy: match?.by ?? null, score: match?.score ?? null,
      qty: decimal(l.qty, "1"), unitPrice: decimal(l.unitPrice), discount: decimal(l.discount),
      ivaRate: decimal(l.ivaRate, "0.16"), retIvaRate: decimal(l.retIvaRate), retIsrRate: decimal(l.retIsrRate),
    };
  });
  if (!lines.length) warnings.push({ level: "error", message: "No se encontraron conceptos en el documento." });
  const unmatched = lines.filter((l) => !l.productId).length;
  if (unmatched) warnings.push({ level: "info", message: `${unmatched} concepto(s) sin producto: se registrarán como gasto salvo que elijas un producto.` });

  const computed = linesTotal(lines);
  if (doc.total && /^\d+(\.\d+)?$/.test(decimal(doc.total, "")) && computed.minus(doc.total).abs().gt("0.05"))
    warnings.push({ level: "warning", message: `El total calculado ($${computed.toFixed(2)}) no coincide con el del documento ($${D(doc.total).toFixed(2)}). Revisa los conceptos.` });
  for (const n of doc.notes) warnings.push({ level: "info", message: `IA: ${n}` });

  const [wh] = await db<{ id: number }[]>`SELECT id FROM warehouses WHERE active ORDER BY id LIMIT 1`;
  return {
    suggestion: {
      thirdPartyId, supplierName, newSupplier, warehouseId: wh?.id ?? null, supplierRef: doc.reference, uuid,
      issueDate: doc.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(doc.issueDate) ? doc.issueDate : null,
      metodoPago: doc.metodoPago ?? "PUE", lines, computedTotal: computed.toFixed(2),
    },
    warnings,
  };
}

export async function createIntake(
  deps: IntakeDeps, userId: number | undefined, file: { fileName: string; mediaType: string; content: Buffer },
) {
  if (!file.content.length) throw badRequest("El archivo está vacío");
  if (file.content.length > MAX_BYTES) throw badRequest("El archivo excede 10 MB");
  const source = detectSource(file.fileName, file.mediaType, file.content);
  let doc: ExtractedDocument;
  let model: string | null = null;
  if (source === "cfdi_xml") {
    try {
      doc = fromCfdi(parseCfdi(file.content.toString("utf8")));
    } catch (err) {
      throw badRequest((err as Error).message);
    }
  } else {
    if (!deps.messages) throw new AppError(503, "Leer PDFs e imágenes requiere la IA (ANTHROPIC_API_KEY). Sube el XML del CFDI.");
    const mediaType = (source === "pdf" ? "application/pdf" : file.mediaType) as ExtractMediaType;
    try {
      doc = (await extractWithClaude(deps.messages, deps.model, file.content, mediaType)).document;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(502, (err as Error).message);
    }
    model = deps.model;
  }
  const { suggestion, warnings } = await suggest(deps.sql, doc);
  const [row] = await deps.sql<{ id: number }[]>`
    INSERT INTO document_intakes (file_name, media_type, source, content, extracted, suggestion, warnings, model, created_by)
    VALUES (${file.fileName}, ${file.mediaType}, ${source}, ${file.content}, ${deps.sql.json(doc as never)}, ${deps.sql.json(suggestion as never)},
            ${deps.sql.json(warnings as never)}, ${model}, ${userId ?? null})
    RETURNING id`;
  return getIntake(deps.sql, row!.id);
}

export async function getIntake(db: Db, id: number) {
  const [row] = await db`
    SELECT d.id, d.file_name, d.media_type, d.source, d.status, d.extracted, d.suggestion, d.warnings, d.model, d.supplier_invoice_id, d.created_at,
           u.name AS created_by_name
    FROM document_intakes d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = ${id}`;
  if (!row) throw notFound("Documento");
  return row;
}

export interface ConfirmIntakeInput {
  thirdPartyId?: number;
  newSupplier?: { name: string; rfc: string; regimenFiscal: string; codigoPostal: string };
  warehouseId?: number;
  supplierRef?: string;
  issueDate?: string;
  metodoPago?: "PUE" | "PPD";
  lines?: SupplierLineInput[];
  /** Also validate: stock in and post the póliza. */
  validate?: boolean;
}

/** Turn an intake into a supplier invoice (and a supplier when new); optionally validate it. */
export async function confirmIntake(tx: Db, id: number, input: ConfirmIntakeInput) {
  const [row] = await tx<{ status: string; suggestion: IntakeSuggestion }[]>`SELECT status, suggestion FROM document_intakes WHERE id = ${id} FOR UPDATE`;
  if (!row) throw notFound("Documento");
  if (row.status !== "extracted") throw conflict("Este documento ya se procesó");
  const s = row.suggestion;

  let thirdPartyId = input.thirdPartyId ?? s.thirdPartyId ?? undefined;
  const fresh = input.newSupplier ?? (thirdPartyId ? undefined : s.newSupplier ?? undefined);
  if (!thirdPartyId && fresh) {
    if (!/^\d{5}$/.test(fresh.codigoPostal)) throw badRequest("Captura el código postal del proveedor nuevo");
    const [created] = await tx<{ id: number }[]>`
      INSERT INTO third_parties (name, rfc, regimen_fiscal, codigo_postal, is_supplier)
      VALUES (${fresh.name}, ${fresh.rfc.toUpperCase()}, ${fresh.regimenFiscal}, ${fresh.codigoPostal}, true) RETURNING id`;
    thirdPartyId = created!.id;
  }
  if (!thirdPartyId) throw badRequest("Selecciona el proveedor");
  await tx`UPDATE third_parties SET is_supplier = true WHERE id = ${thirdPartyId} AND NOT is_supplier`;

  const lines: SupplierLineInput[] = input.lines ?? s.lines.map((l) => ({
    productId: l.productId ?? undefined, description: l.description, qty: l.qty, unitPrice: l.unitPrice,
    discount: l.discount, ivaRate: l.ivaRate, retIvaRate: l.retIvaRate, retIsrRate: l.retIsrRate,
  }));
  const invoiceId = await createSupplierInvoice(tx, {
    thirdPartyId,
    warehouseId: input.warehouseId ?? s.warehouseId ?? undefined,
    supplierRef: input.supplierRef ?? s.supplierRef ?? undefined,
    uuid: s.uuid ?? undefined,
    issueDate: input.issueDate ?? s.issueDate ?? undefined,
    metodoPago: input.metodoPago ?? s.metodoPago,
    lines,
  });
  const validated = input.validate ? await validateSupplierInvoice(tx, invoiceId) : null;
  await tx`UPDATE document_intakes SET status = 'posted', supplier_invoice_id = ${invoiceId} WHERE id = ${id}`;
  return { intakeId: id, supplierInvoiceId: invoiceId, thirdPartyId, journalEntryId: validated?.journalEntryId ?? null };
}
