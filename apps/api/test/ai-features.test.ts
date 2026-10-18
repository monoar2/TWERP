import { buildCfdiXml, IVA_16 } from "@erp/mx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MessagesApi } from "../src/ai/agent.js";
import { createSession } from "../src/auth/sessions.js";
import { parse69b } from "../src/cli/load-69b.js";
import { extractNumbers, grade } from "../src/evals/grade.js";
import { runAudit } from "../src/services/auditor.js";
import { createUser } from "../src/services/users.js";
import { call, callAs, createTestEnv, inject, type TestEnv } from "./helpers.js";

let env: TestEnv;
let ids: { supplier: number; customer: number; product: number; main: number; shop: number };

beforeAll(async () => {
  env = await createTestEnv();
  const main = await call(env.app, "POST", "/warehouses", { code: "MAIN", name: "General" });
  const shop = await call(env.app, "POST", "/warehouses", { code: "TDA", name: "Tienda" });
  const supplier = await call(env.app, "POST", "/third-parties", { name: "DISTRIBUIDORA TECNOLOGICA", rfc: "DTE0101011A1", regimenFiscal: "601", codigoPostal: "03100", isSupplier: true });
  const customer = await call(env.app, "POST", "/third-parties", { name: "COMERCIALIZADORA DEL BAJIO", rfc: "CBA0505129K3", regimenFiscal: "601", codigoPostal: "37000", isCustomer: true });
  const product = await call(env.app, "POST", "/products", { sku: "MON-27", name: "Monitor 27 pulgadas 4K", claveProdServ: "43211902", claveUnidad: "H87", salePrice: 7499, purchasePrice: 5200 });
  ids = { supplier: supplier.id, customer: customer.id, product: product.id, main: main.id, shop: shop.id };
}, 60_000);
afterAll(async () => env?.close());

type Step = { tool?: string; input?: Record<string, unknown>; text?: string };
/** Fake Claude replaying scripted steps; a step with `tool` returns a tool_use block. */
function scripted(steps: Step[]) {
  const requests: any[] = [];
  let i = 0;
  const api = {
    create: async (params: any) => {
      requests.push(structuredClone(params));
      const step = steps[i++] ?? { text: "fin" };
      const usage = { input_tokens: 10, output_tokens: 5 };
      if (step.tool) return { stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: `tu_${i}`, name: step.tool, input: step.input }] };
      return { stop_reason: "end_turn", usage, content: [{ type: "text", text: step.text }] };
    },
  } as unknown as MessagesApi;
  return { api, requests };
}

function supplierCfdi(opts: { receptor?: string; qty?: number; noIdentificacion?: string; descripcion?: string } = {}) {
  const { xml } = buildCfdiXml({
    serie: "F", folio: "1001", fecha: "2026-10-01T10:00:00", tipoDeComprobante: "I", formaPago: "99", metodoPago: "PPD", lugarExpedicion: "03100",
    emisor: { rfc: "DTE0101011A1", nombre: "DISTRIBUIDORA TECNOLOGICA", regimenFiscal: "601" },
    receptor: { rfc: opts.receptor ?? "EKU9003173C9", nombre: "ESCUELA KEMPER URGATE", regimenFiscal: "601", domicilioFiscal: "42501", usoCfdi: "G01" },
    conceptos: [
      { claveProdServ: "43211902", noIdentificacion: opts.noIdentificacion, claveUnidad: "H87", descripcion: opts.descripcion ?? "MONITOR 27\" 4K UHD",
        quantity: opts.qty ?? 4, unitPrice: 5200, objetoImp: "02", traslados: [IVA_16] },
      { claveProdServ: "78102203", claveUnidad: "E48", descripcion: "Flete", quantity: 1, unitPrice: 350, objetoImp: "02", traslados: [IVA_16] },
    ],
  });
  const uuid = crypto.randomUUID().toUpperCase();
  return {
    uuid,
    xml: xml.replace("</cfdi:Comprobante>", `<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${uuid}" FechaTimbrado="2026-10-01T10:01:00"/></cfdi:Complemento></cfdi:Comprobante>`),
  };
}
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

describe("document intake", () => {
  it("parses a supplier CFDI, matches supplier and product, and posts it on confirm", async () => {
    const { xml, uuid } = supplierCfdi();
    const intake = await call(env.app, "POST", "/intake", { fileName: "factura.xml", mediaType: "text/xml", contentBase64: b64(xml) });
    expect(intake.source).toBe("cfdi_xml");
    expect(intake.suggestion.thirdPartyId).toBe(ids.supplier);
    expect(intake.suggestion.uuid).toBe(uuid);
    const [monitor, flete] = intake.suggestion.lines;
    expect(monitor).toMatchObject({ productId: ids.product, matchedBy: "name", qty: "4.000000", unitPrice: "5200.000000", ivaRate: "0.160000" });
    expect(flete.productId).toBeNull();
    expect(intake.suggestion.computedTotal).toBe("24534.00"); // (4 × 5200 + 350) × 1.16
    expect(intake.warnings.filter((w: any) => w.level === "error")).toEqual([]);

    const done = await call(env.app, "POST", `/intake/${intake.id}/confirm`, { validate: true });
    expect(done.journalEntryId).toBeTruthy();
    const [inv] = await env.sql`SELECT status, total, upper(uuid) AS uuid FROM supplier_invoices WHERE id = ${done.supplierInvoiceId}`;
    expect(inv).toEqual({ status: "validated", total: "24534.00", uuid });
    const [stock] = await env.sql`SELECT qty FROM stock WHERE product_id = ${ids.product} AND warehouse_id = ${ids.main}`;
    expect(Number(stock!.qty)).toBe(4);

    // The same CFDI again is flagged, and the database refuses a second registration.
    const again = await call(env.app, "POST", "/intake", { fileName: "factura.xml", mediaType: "text/xml", contentBase64: b64(xml) });
    expect(again.warnings.some((w: any) => w.level === "error" && /ya está registrado/.test(w.message))).toBe(true);
    const res = await inject(env.app, { method: "POST", url: `/intake/${again.id}/confirm`, payload: {} });
    expect(res.statusCode).toBe(409);
  });

  it("matches by SKU, warns about a CFDI addressed to someone else and offers to create unknown suppliers", async () => {
    const { xml } = supplierCfdi({ receptor: "XIQB891116QE4", noIdentificacion: "MON-27", descripcion: "Pantalla" });
    const intake = await call(env.app, "POST", "/intake", { fileName: "otra.xml", mediaType: "", contentBase64: b64(xml.replace(/DTE0101011A1/g, "NUE0101011A1")) });
    expect(intake.suggestion.lines[0]).toMatchObject({ productId: ids.product, matchedBy: "sku" });
    expect(intake.suggestion.thirdPartyId).toBeNull();
    expect(intake.suggestion.newSupplier).toMatchObject({ rfc: "NUE0101011A1", codigoPostal: "03100" });
    expect(intake.warnings.some((w: any) => w.level === "error" && /XIQB891116QE4/.test(w.message))).toBe(true);
    const done = await call(env.app, "POST", `/intake/${intake.id}/confirm`, {});
    const [party] = await env.sql`SELECT is_supplier FROM third_parties WHERE id = ${done.thirdPartyId}`;
    expect(party!.is_supplier).toBe(true);
  });

  it("reads PDFs and photos with Claude using structured output", async () => {
    const extracted = {
      documentType: "ticket", supplier: { rfc: "DTE0101011A1", name: "DISTRIBUIDORA TECNOLOGICA", regimenFiscal: null, codigoPostal: null },
      receiverRfc: null, uuid: null, reference: "T-77", issueDate: "2026-10-05", metodoPago: null, currency: "MXN",
      lines: [{ description: "Monitor 27 4K", sku: null, claveProdServ: null, qty: "1", unitPrice: "5000", discount: "0", ivaRate: "0.16", retIvaRate: "0", retIsrRate: "0" }],
      subtotal: "5000", iva: "800", total: "5800", notes: ["Ticket sin folio fiscal"],
    };
    const fake = scripted([{ text: JSON.stringify(extracted) }]);
    env.setMessages(fake.api);
    const intake = await call(env.app, "POST", "/intake", { fileName: "ticket.jpg", mediaType: "image/jpeg", contentBase64: b64(Buffer.from([0xff, 0xd8, 0xff, 0xe0])) });
    expect(intake.source).toBe("image");
    expect(fake.requests[0].output_config.format.type).toBe("json_schema");
    expect(fake.requests[0].messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
    expect(intake.suggestion.lines[0].productId).toBe(ids.product);
    expect(intake.warnings.map((w: any) => w.message).join(" ")).toMatch(/UUID[\s\S]*IA: Ticket sin folio fiscal/);
  });

  it("rejects unsupported files", async () => {
    const res = await inject(env.app, { method: "POST", url: "/intake", payload: { fileName: "a.docx", mediaType: "application/msword", contentBase64: b64("PK\x03\x04") } });
    expect(res.statusCode).toBe(400);
  });
});

describe("AI copilot actions", () => {
  it("dry-runs a proposal, then applies it only when the user confirms", async () => {
    const fake = scripted([
      { tool: "propose_sales_invoice", input: { summary: "Factura de 1 monitor", thirdPartyId: ids.customer, warehouseId: ids.main, metodoPago: "PPD", notes: null,
        lines: [{ productId: ids.product, description: null, qty: 1, unitPrice: null }] } },
      { text: "Preparé la factura en borrador; revísala y aplícala." },
    ]);
    env.setMessages(fake.api);
    const before = await env.sql`SELECT count(*)::int AS n FROM sales_invoices`;
    const r = await call(env.app, "POST", "/ai/query", { question: "Factúrale un monitor a Comercializadora del Bajío" });
    expect(fake.requests[0].tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(["run_sql", "show_chart", "propose_sales_invoice", "propose_journal_entry"]));
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].preview.total).toBe("8698.84"); // list price 7499 + IVA
    // The dry run left nothing behind.
    expect((await env.sql`SELECT count(*)::int AS n FROM sales_invoices`)[0]!.n).toBe(before[0]!.n);

    const applied = await call(env.app, "POST", `/ai/proposals/${r.proposals[0].id}/apply`);
    expect(applied.status).toBe("applied");
    const [inv] = await env.sql`SELECT status, total FROM sales_invoices WHERE id = ${applied.result.salesInvoiceId}`;
    expect(inv).toEqual({ status: "draft", total: "8698.84" });
    const again = await inject(env.app, { method: "POST", url: `/ai/proposals/${r.proposals[0].id}/apply` });
    expect(again.statusCode).toBe(409);
    const [audit] = await env.sql`SELECT path, status FROM audit_log WHERE path LIKE '/ai/proposals/%/apply' ORDER BY id LIMIT 1`;
    expect(audit).toEqual({ path: `/ai/proposals/${r.proposals[0].id}/apply`, status: 200 });
  });

  it("returns validation errors to the model so it can correct itself", async () => {
    const fake = scripted([
      { tool: "propose_journal_entry", input: { summary: "x", journal: "OD", date: "2026-10-01", concept: "Descuadrada",
        lines: [{ accountCode: "102.01", debit: 100, credit: null, description: null }, { accountCode: "102.01", debit: null, credit: 90, description: null }] } },
      { text: "No cuadra." },
    ]);
    env.setMessages(fake.api);
    const r = await call(env.app, "POST", "/ai/query", { question: "Registra una póliza" });
    expect(r.proposals).toEqual([]);
    const toolResult = fake.requests[1].messages.at(-1).content[0];
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/no cuadra/);
  });

  it("only offers the actions the user's role may apply", async () => {
    const token = async (role: "contador" | "consulta") => {
      const u = await createUser(env.sql, { email: `${role}@test.mx`, name: role, role, password: "contraseña-segura" });
      return { id: u.id, token: (await createSession(env.sql, u.id)).token };
    };
    const contador = await token("contador");
    const consulta = await token("consulta");
    const fake = scripted([{ text: "ok" }, { text: "ok" }]);
    env.setMessages(fake.api);
    await callAs(env.app, contador.token, "POST", "/ai/query", { question: "Hola, ¿qué puedes hacer?" });
    await callAs(env.app, consulta.token, "POST", "/ai/query", { question: "Hola, ¿qué puedes hacer?" });
    // Accountants don't move stock; read-only users only read.
    expect(fake.requests[0].tools.map((t: any) => t.name)).toEqual(["run_sql", "show_chart", "propose_sales_invoice", "propose_journal_entry"]);
    expect(fake.requests[1].tools.map((t: any) => t.name)).toEqual(["run_sql", "show_chart"]);
    expect(fake.requests[1].system[0].text).toMatch(/sólo puedes consultar/);
    // Applying re-checks the role, and only the asker (or an admin) may apply.
    const [mine] = await env.sql`INSERT INTO ai_proposals (user_id, kind, summary, payload) VALUES (${consulta.id}, 'journal_entry', 'x', '{}') RETURNING id`;
    expect((await callAs(env.app, consulta.token, "POST", `/ai/proposals/${mine!.id}/apply`, undefined, [403])).error).toMatch(/rol/);
    const [theirs] = await env.sql`INSERT INTO ai_proposals (user_id, kind, summary, payload) VALUES (${consulta.id}, 'journal_entry', 'x', '{}') RETURNING id`;
    expect((await callAs(env.app, contador.token, "POST", `/ai/proposals/${theirs!.id}/apply`, undefined, [403])).error).toMatch(/quien hizo la pregunta/);
  });
});

describe("charts and dashboard widgets", () => {
  it("returns charts the model asks for and pins them as live widgets", async () => {
    const sql = "SELECT name, sale_price FROM ai.products ORDER BY name";
    const fake = scripted([
      { tool: "run_sql", input: { sql, purpose: "precios" } },
      { tool: "show_chart", input: { query_number: 1, title: "Precios", type: "bar", x: "name", y: ["nope"] } },
      { tool: "show_chart", input: { query_number: 1, title: "Precios", type: "bar", x: "name", y: ["sale_price"] } },
      { text: "Aquí está la gráfica." },
    ]);
    env.setMessages(fake.api);
    const r = await call(env.app, "POST", "/ai/query", { question: "Grafica los precios" });
    expect(r.charts).toHaveLength(1);
    expect(r.charts[0]).toMatchObject({ type: "bar", x: "name", y: ["sale_price"], sql });
    expect(JSON.stringify(fake.requests[2].messages.at(-1))).toMatch(/Columnas inexistentes/);

    const w = await call(env.app, "POST", "/ai/widgets", { title: "Precios", question: "Grafica los precios", sql, chart: { type: "bar", x: "name", y: ["sale_price"] } });
    await call(env.app, "POST", "/products", { sku: "NEW-1", name: "Nuevo", claveProdServ: "43211902", claveUnidad: "H87", salePrice: 10 });
    const widgets = await call(env.app, "GET", "/ai/widgets");
    expect(widgets.find((x: any) => x.id === w.id).rows.map((row: any) => row.name)).toContain("Nuevo");
    const bad = await inject(env.app, { method: "POST", url: "/ai/widgets", payload: { title: "x", sql: "DELETE FROM ai.products", chart: { type: "bar", x: "a", y: ["b"] } } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("auditor", () => {
  it("finds planted problems, keeps them stable across runs and resolves what disappears", async () => {
    await env.sql`INSERT INTO sat_69b (rfc, name, situacion) VALUES ('DTE0101011A1', 'DISTRIBUIDORA TECNOLOGICA SA', 'Presunto')`;
    env.setMessages(undefined as unknown as MessagesApi);
    const first = await call(env.app, "POST", "/audit/run");
    const findings = await call(env.app, "GET", "/audit/findings");
    const codes = findings.map((f: any) => f.check_code);
    expect(codes).toContain("supplier_69b");
    expect(first.summary).toBeNull(); // no Claude configured

    const second = await runAudit({ sql: env.sql, model: "m" });
    expect(second!.newFindings).toBe(0);
    await env.sql`DELETE FROM sat_69b`;
    const third = await runAudit({ sql: env.sql, model: "m" });
    expect(third!.resolved).toBeGreaterThanOrEqual(1);
    const [f] = await env.sql`SELECT status FROM audit_findings WHERE check_code = 'supplier_69b'`;
    expect(f!.status).toBe("resolved");
  });

  it("asks Claude for a summary when configured, and lets users dismiss findings", async () => {
    await env.sql`INSERT INTO sat_69b (rfc, name, situacion) VALUES ('DTE0101011A1', 'DISTRIBUIDORA TECNOLOGICA SA', 'Definitivo')`;
    const fake = scripted([{ text: "Atiende hoy la factura duplicada." }]);
    const r = await runAudit({ sql: env.sql, model: "m", messages: fake.api });
    expect(r!.summary).toBe("Atiende hoy la factura duplicada.");
    expect(fake.requests[0].output_config.effort).toBe("low");
    const [open] = await env.sql`SELECT id FROM audit_findings WHERE status = 'open' LIMIT 1`;
    if (open) {
      expect((await call(env.app, "POST", `/audit/findings/${open.id}/dismiss`, { note: "revisado" })).status).toBe("dismissed");
    }
  });
});

describe("MCP server", () => {
  const rpc = (body: object) => call(env.app, "POST", "/mcp", body, [200, 202]);
  it("speaks JSON-RPC: initialize, tools/list and read-only tools/call", async () => {
    env.setMessages(scripted([]).api);
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();
    expect(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).toBe("");
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.result.tools.map((t: any) => t.name)).toEqual(["describe_schema", "run_sql", "list_audit_findings", "ask_erp"]);
    const q = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "run_sql", arguments: { sql: "SELECT sku FROM ai.products WHERE sku = 'MON-27'" } } });
    expect(q.result.structuredContent.rows).toEqual([{ sku: "MON-27" }]);
    const blocked = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "run_sql", arguments: { sql: "DELETE FROM ai.products" } } });
    expect(blocked.result.isError).toBe(true);
    expect((await rpc({ jsonrpc: "2.0", id: 5, method: "nope" })).error.code).toBe(-32601);
  });
  it("requires a signed-in user", async () => {
    const res = await env.app.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 1, method: "ping" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("eval grader and 69-B loader", () => {
  it("finds numbers in Spanish money formats", () => {
    expect(extractNumbers("Vendiste $1,234,567.89 y 12 facturas; unos 1.2 millones")).toEqual([1234567.89, 12, 1200000]);
    expect(grade("Tu mejor cliente es **Innovación Educativa** con $366,843.04", [{ name: "INNOVACION EDUCATIVA", total: "366843.04" }], { texts: ["name"], numbers: ["total"] }).pass).toBe(true);
    expect(grade("Tienes 5 clientes", [{ n: "4" }], { numbers: ["n"] })).toEqual({ pass: false, missing: ["n=4"] });
    expect(grade("No hay productos bajo el mínimo.", [{ n: 0 }], { numbers: ["n"] }).pass).toBe(true);
  });
  it("parses SAT's 69-B CSV with its title rows", () => {
    const csv = 'Listado completo,,,\r\nInformación actualizada,,,\r\nNo,RFC,Nombre del Contribuyente,Situación del contribuyente\r\n1,AAA010101AAA,"EMPRESA, S.A.",Definitivo\r\n2,BAD,X,Presunto\r\n';
    expect(parse69b(csv)).toEqual([{ rfc: "AAA010101AAA", name: "EMPRESA, S.A.", situacion: "Definitivo" }]);
  });
});
