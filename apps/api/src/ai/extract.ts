import type Anthropic from "@anthropic-ai/sdk";
import type { MessagesApi } from "./agent.js";

/** What the intake knows about a received invoice, whether parsed from XML or read by Claude. */
export interface ExtractedDocument {
  documentType: "invoice" | "ticket" | "other";
  supplier: { rfc: string | null; name: string | null; regimenFiscal: string | null; codigoPostal: string | null };
  receiverRfc: string | null;
  uuid: string | null;
  reference: string | null;
  issueDate: string | null;
  metodoPago: "PUE" | "PPD" | null;
  currency: string;
  lines: Array<{
    description: string;
    sku: string | null;
    claveProdServ: string | null;
    qty: string;
    unitPrice: string;
    discount: string;
    ivaRate: string;
    retIvaRate: string;
    retIsrRate: string;
  }>;
  subtotal: string | null;
  iva: string | null;
  total: string | null;
  /** Anything the reader was unsure about, in Spanish. */
  notes: string[];
}

const nullableString = { type: ["string", "null"] };

/** JSON schema for structured outputs; every field is required, unknowns are null. */
const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["documentType", "supplier", "receiverRfc", "uuid", "reference", "issueDate", "metodoPago", "currency", "lines", "subtotal", "iva", "total", "notes"],
  properties: {
    documentType: { type: "string", enum: ["invoice", "ticket", "other"], description: "invoice = CFDI impreso o factura; ticket = nota de venta o ticket; other = no es un comprobante de compra" },
    supplier: {
      type: "object",
      additionalProperties: false,
      required: ["rfc", "name", "regimenFiscal", "codigoPostal"],
      properties: {
        rfc: { ...nullableString, description: "RFC del emisor (vendedor), 12 o 13 caracteres, en mayúsculas" },
        name: { ...nullableString, description: "Nombre o razón social del emisor" },
        regimenFiscal: { ...nullableString, description: "Clave de 3 dígitos del régimen fiscal del emisor, si aparece" },
        codigoPostal: { ...nullableString, description: "Código postal de 5 dígitos del emisor o lugar de expedición" },
      },
    },
    receiverRfc: { ...nullableString, description: "RFC del receptor (comprador)" },
    uuid: { ...nullableString, description: "Folio fiscal (UUID) del CFDI, formato 8-4-4-4-12" },
    reference: { ...nullableString, description: "Serie y folio o número de ticket del proveedor" },
    issueDate: { ...nullableString, description: "Fecha de emisión en formato YYYY-MM-DD" },
    metodoPago: { type: ["string", "null"], enum: ["PUE", "PPD", null] },
    currency: { type: "string", description: "Código ISO de la moneda, MXN si no se indica" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "sku", "claveProdServ", "qty", "unitPrice", "discount", "ivaRate", "retIvaRate", "retIsrRate"],
        properties: {
          description: { type: "string" },
          sku: { ...nullableString, description: "No. de identificación o código del producto" },
          claveProdServ: { ...nullableString, description: "Clave de producto o servicio SAT de 8 dígitos" },
          qty: { type: "string", description: "Cantidad como número decimal, p. ej. \"2\" o \"1.5\"" },
          unitPrice: { type: "string", description: "Precio unitario SIN IVA como número decimal" },
          discount: { type: "string", description: "Descuento de la línea en pesos, \"0\" si no hay" },
          ivaRate: { type: "string", description: "Tasa de IVA como fracción: \"0.16\", \"0.08\" o \"0\"" },
          retIvaRate: { type: "string", description: "Tasa de retención de IVA como fracción, \"0\" si no hay" },
          retIsrRate: { type: "string", description: "Tasa de retención de ISR como fracción, \"0\" si no hay" },
        },
      },
    },
    subtotal: { ...nullableString, description: "Subtotal antes de impuestos" },
    iva: { ...nullableString, description: "IVA trasladado total" },
    total: { ...nullableString, description: "Total a pagar" },
    notes: { type: "array", items: { type: "string" }, description: "Dudas o datos ilegibles, en español; vacío si todo es claro" },
  },
};

const SYSTEM = `Lees comprobantes de compra mexicanos (CFDI impresos en PDF, fotos de facturas o tickets) para registrarlos en un ERP.
Extrae los datos exactamente como aparecen. No inventes: si un dato no está o no se lee, usa null y explícalo en notes.
- Los precios unitarios van SIN IVA. Si el comprobante sólo muestra precios con IVA incluido (común en tickets), divídelos entre 1 + tasa y dilo en notes.
- La suma de (qty × unitPrice − discount) de las líneas debe coincidir con el subtotal; si no cuadra, dilo en notes.
- Montos como números decimales sin símbolo de moneda ni separadores de miles.`;

export type ExtractMediaType = "application/pdf" | "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Read a PDF or image with Claude, constrained to the extraction schema. */
export async function extractWithClaude(
  messages: MessagesApi, model: string, content: Buffer, mediaType: ExtractMediaType,
): Promise<{ document: ExtractedDocument; usage: { inputTokens: number; outputTokens: number } }> {
  const data = content.toString("base64");
  const file: Anthropic.Beta.BetaContentBlockParam = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };
  const response = await messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: [file, { type: "text", text: "Extrae los datos de este comprobante." }] }],
  });
  if (response.stop_reason === "refusal") throw new Error("La IA no pudo leer este documento");
  if (response.stop_reason === "max_tokens") throw new Error("El documento es demasiado largo para leerlo de una vez");
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
  let document: ExtractedDocument;
  try {
    document = JSON.parse(text) as ExtractedDocument;
  } catch {
    throw new Error("La IA devolvió una respuesta que no se pudo interpretar");
  }
  return { document, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
}
