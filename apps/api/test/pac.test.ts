import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SwSapienPac } from "../src/services/pac.js";
import { call, createTestEnv, inject, type TestEnv } from "./helpers.js";

const csdFile = (name: string) => readFileSync(new URL(`../../../packages/mx/test/fixtures/csd/${name}`, import.meta.url));
const cer = csdFile("EKU9003173C9.cer");
const key = csdFile("EKU9003173C9.key");
const UUID = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";

/** A stand-in for SW Sapien's REST API that records what it receives. */
const fake = {
  server: undefined as Server | undefined,
  url: "",
  auths: [] as Array<{ user?: string; password?: string }>,
  stamped: [] as string[],
  cancels: [] as any[],
  failNextStamp: false,
};

async function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

let env: TestEnv;
const ids = { warehouse: 0, customer: 0, laptop: 0, invoice: 0 };

beforeAll(async () => {
  fake.server = createServer(async (req, res) => {
    const body = await readBody(req);
    const send = (status: number, json: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
    if (req.url === "/security/authenticate") {
      fake.auths.push({ user: req.headers.user as string, password: req.headers.password as string });
      return send(200, { status: "success", data: { token: "T0KEN", expires_in: 7200 } });
    }
    if (req.headers.authorization !== "bearer T0KEN") return send(401, { status: "error", message: "AU2000 - token inválido" });
    if (req.url === "/cfdi33/stamp/v4") {
      const form = await new Response(body, { headers: { "content-type": req.headers["content-type"]! } }).formData();
      const xml = await (form.get("xml") as Blob).text();
      if (fake.failNextStamp) {
        fake.failNextStamp = false;
        return send(400, { status: "error", message: "CFDI40102", messageDetail: "El resultado de la digestión debe ser igual al resultado de la desencripción del sello." });
      }
      fake.stamped.push(xml);
      const cfdi = xml.replace("</cfdi:Comprobante>", `<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${UUID}"/></cfdi:Complemento></cfdi:Comprobante>`);
      return send(200, { status: "success", data: { uuid: UUID.toLowerCase(), cfdi, fechaTimbrado: "2026-10-17T10:00:00" } });
    }
    if (req.url === "/cfdi33/cancel/csd") {
      const json = JSON.parse(body.toString("utf8"));
      fake.cancels.push(json);
      return send(200, { status: "success", data: { acuse: "<Acuse/>", uuid: { [json.uuid]: "201" } } });
    }
    send(404, { status: "error", message: "no encontrado" });
  });
  await new Promise<void>((r) => fake.server!.listen(0, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${(fake.server!.address() as AddressInfo).port}`;

  env = await createTestEnv({ pac: new SwSapienPac({ url: fake.url, user: "demo@empresa.mx", password: "secreto" }) });
  const { app } = env;
  ids.warehouse = (await call(app, "POST", "/warehouses", { code: "MAIN", name: "Almacén general" })).id;
  ids.customer = (await call(app, "POST", "/third-parties", {
    name: "BERENICE XIMO QUEZADA", rfc: "XIQB891116QE4", regimenFiscal: "612", codigoPostal: "06000", usoCfdi: "G03", isCustomer: true,
  })).id;
  ids.laptop = (await call(app, "POST", "/products", {
    sku: "LAP-001", name: "Laptop 14 pulgadas", claveProdServ: "43211503", claveUnidad: "H87", salePrice: 18000,
  })).id;
  await call(app, "POST", "/stock/adjustments", { productId: ids.laptop, warehouseId: ids.warehouse, qty: 10, unitCost: 11000, reason: "Inicial", initial: true });
  ids.invoice = (await call(app, "POST", "/sales-invoices", {
    thirdPartyId: ids.customer, warehouseId: ids.warehouse, metodoPago: "PUE", formaPago: "03", issueDate: "2026-01-02T09:00:00",
    lines: [{ productId: ids.laptop, qty: 2 }],
  })).id;
}, 60_000);

afterAll(async () => {
  await env?.close();
  fake.server?.close();
});

const stock = async () => (await call(env.app, "GET", `/products/${ids.laptop}`)).stock[0].qty;

describe("CSD", () => {
  it("refuses to stamp with a real PAC until the CSD is uploaded", async () => {
    const res = await inject(env.app, { method: "POST", url: `/sales-invoices/${ids.invoice}/issue` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/CSD/);
  });

  it("checks the password and stores the CSD encrypted", async () => {
    const b64 = { cer: cer.toString("base64"), key: key.toString("base64") };
    const bad = await inject(env.app, { method: "PUT", url: "/company/csd", payload: { ...b64, password: "otra" } });
    expect(bad.statusCode).toBe(400);
    const info = await call(env.app, "PUT", "/company/csd", { ...b64, password: "12345678a" });
    expect(info).toMatchObject({ rfc: "EKU9003173C9", noCertificado: "30001000000500003416" });
    const [row] = await env.sql<{ key_encrypted: Buffer; password_encrypted: Buffer }[]>`SELECT key_encrypted, password_encrypted FROM company_csd`;
    expect(row!.key_encrypted.includes(key.subarray(0, 64))).toBe(false);
    expect(row!.password_encrypted.toString("latin1")).not.toContain("12345678a");
    expect(await call(env.app, "GET", "/company/csd")).toMatchObject({ noCertificado: "30001000000500003416" });
  });
});

describe("stamping with SW Sapien", () => {
  it("rolls everything back when the PAC rejects the CFDI", async () => {
    fake.failNextStamp = true;
    const res = await inject(env.app, { method: "POST", url: `/sales-invoices/${ids.invoice}/issue` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/CFDI40102/);
    expect(await stock()).toBe("10.000000");
    expect((await call(env.app, "GET", `/sales-invoices/${ids.invoice}`)).status).toBe("draft");
  });

  it("seals with the CSD, stamps and dates the CFDI now", async () => {
    const r = await call(env.app, "POST", `/sales-invoices/${ids.invoice}/issue`);
    expect(r.uuid).toBe(UUID);
    expect(fake.auths.at(-1)).toEqual({ user: "demo@empresa.mx", password: "secreto" });
    const sent = fake.stamped.at(-1)!;
    expect(sent).toContain('NoCertificado="30001000000500003416"');
    expect(sent).toMatch(/ Sello="[A-Za-z0-9+/=]{300,}"/);
    expect(sent).toContain(` Certificado="${cer.toString("base64")}"`);
    const inv = await call(env.app, "GET", `/sales-invoices/${ids.invoice}`);
    expect(inv).toMatchObject({ status: "stamped", pac: "sw", uuid: UUID });
    // The draft was dated in January; a real CFDI must carry the stamping date.
    expect(inv.issue_date.slice(0, 10)).not.toBe("2026-01-02");
    expect(Math.abs(Date.parse(`${inv.issue_date.replace(" ", "T")}Z`) - Date.now())).toBeLessThan(26 * 3600_000);
    expect(await stock()).toBe("8.000000");
  });

  it("cancels through the PAC with the CSD", async () => {
    await call(env.app, "POST", `/sales-invoices/${ids.invoice}/cancel`, { motivo: "02" });
    const req = fake.cancels.at(-1);
    expect(req).toMatchObject({ uuid: UUID, rfc: "EKU9003173C9", motivo: "02", password: "12345678a", b64Cer: cer.toString("base64"), b64Key: key.toString("base64") });
    const [row] = await env.sql`SELECT status, cancel_acuse FROM sales_invoices WHERE id = ${ids.invoice}`;
    expect(row).toMatchObject({ status: "cancelled", cancel_acuse: "<Acuse/>" });
    expect(await stock()).toBe("10.000000");
  });
});
