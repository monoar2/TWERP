import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FORMAS_PAGO, METODOS_PAGO, OBJETOS_IMPUESTO, REGIMENES_FISCALES, USOS_CFDI, validateRfc } from "@erp/mx";
import type { AppContext } from "../context.js";
import { badRequest, notFound } from "../errors.js";
import { idParam, num, parse } from "../validate.js";

const partySchema = z.object({
  name: z.string().min(1),
  rfc: z.string().min(12).max(13),
  regimenFiscal: z.string().regex(/^\d{3}$/),
  codigoPostal: z.string().regex(/^\d{5}$/),
  usoCfdi: z.string().default("G03"),
  isCustomer: z.boolean().default(false),
  isSupplier: z.boolean().default(false),
  email: z.email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  creditDays: z.number().int().min(0).default(0),
});

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["product", "service"]).default("product"),
  claveProdServ: z.string().regex(/^\d{8}$/),
  claveUnidad: z.string().min(2),
  unitName: z.string().default("Pieza"),
  salePrice: num.default(0),
  purchasePrice: num.default(0),
  objetoImp: z.string().default("02"),
  ivaFactor: z.enum(["Tasa", "Exento"]).default("Tasa"),
  ivaRate: num.default("0.16"),
  minStock: num.default(0),
  incomeAccountId: z.number().int().optional(),
  expenseAccountId: z.number().int().optional(),
});

/** Third parties, products, warehouses, bank accounts and SAT catalogs. */
export async function catalogRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sql } = ctx;

  app.get("/sat/catalogs", async () => ({
    regimenesFiscales: REGIMENES_FISCALES,
    usosCfdi: USOS_CFDI,
    formasPago: FORMAS_PAGO,
    metodosPago: METODOS_PAGO,
    objetosImpuesto: OBJETOS_IMPUESTO,
    clavesUnidad: await sql`SELECT code, name FROM sat_clave_unidad ORDER BY code`,
  }));

  app.get("/sat/prodserv", async (req) => {
    const { q } = parse(z.object({ q: z.string().min(2) }), req.query);
    return sql`SELECT code, description FROM sat_clave_prod_serv WHERE code LIKE ${q + "%"} OR description ILIKE ${"%" + q + "%"} ORDER BY code LIMIT 30`;
  });

  app.get("/company", async () => (await sql`SELECT * FROM company WHERE id = 1`)[0] ?? null);
  app.put("/company", async (req) => {
    const b = parse(z.object({ rfc: z.string(), razonSocial: z.string().min(1), regimenFiscal: z.string(), codigoPostal: z.string().regex(/^\d{5}$/), invoiceSerie: z.string().default("A"), allowNegativeStock: z.boolean().default(false) }), req.body);
    if (!validateRfc(b.rfc).valid) throw badRequest("RFC inválido");
    const [row] = await sql`
      INSERT INTO company (id, rfc, razon_social, regimen_fiscal, codigo_postal, invoice_serie, allow_negative_stock)
      VALUES (1, ${b.rfc.toUpperCase()}, ${b.razonSocial}, ${b.regimenFiscal}, ${b.codigoPostal}, ${b.invoiceSerie}, ${b.allowNegativeStock})
      ON CONFLICT (id) DO UPDATE SET rfc = EXCLUDED.rfc, razon_social = EXCLUDED.razon_social, regimen_fiscal = EXCLUDED.regimen_fiscal,
        codigo_postal = EXCLUDED.codigo_postal, invoice_serie = EXCLUDED.invoice_serie, allow_negative_stock = EXCLUDED.allow_negative_stock
      RETURNING *`;
    return row;
  });

  app.get("/third-parties", async (req) => {
    const { role, q } = parse(z.object({ role: z.enum(["customer", "supplier"]).optional(), q: z.string().optional() }), req.query);
    return sql`SELECT * FROM third_parties WHERE active
      ${role === "customer" ? sql`AND is_customer` : role === "supplier" ? sql`AND is_supplier` : sql``}
      ${q ? sql`AND (name ILIKE ${"%" + q + "%"} OR rfc ILIKE ${q + "%"})` : sql``}
      ORDER BY name`;
  });
  app.post("/third-parties", async (req, reply) => {
    const b = parse(partySchema, req.body);
    const rfc = validateRfc(b.rfc);
    if (!rfc.valid) throw badRequest(rfc.error ?? "RFC inválido");
    if (!b.isCustomer && !b.isSupplier) throw badRequest("Marca el tercero como cliente, proveedor o ambos");
    const [row] = await sql`
      INSERT INTO third_parties (name, rfc, regimen_fiscal, codigo_postal, uso_cfdi, is_customer, is_supplier, email, phone, address, credit_days)
      VALUES (${b.name}, ${b.rfc.toUpperCase()}, ${b.regimenFiscal}, ${b.codigoPostal}, ${b.usoCfdi}, ${b.isCustomer}, ${b.isSupplier},
              ${b.email ?? null}, ${b.phone ?? null}, ${b.address ?? null}, ${b.creditDays})
      RETURNING *`;
    return reply.code(201).send(row);
  });
  app.get("/third-parties/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await sql`SELECT * FROM third_parties WHERE id = ${id}`;
    if (!row) throw notFound("Tercero");
    return row;
  });

  app.get("/products", async (req) => {
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    return sql`SELECT p.*, coalesce((SELECT sum(qty) FROM stock s WHERE s.product_id = p.id), 0) AS total_qty
      FROM products p WHERE p.active ${q ? sql`AND (p.name ILIKE ${"%" + q + "%"} OR p.sku ILIKE ${q + "%"})` : sql``} ORDER BY p.name`;
  });
  app.post("/products", async (req, reply) => {
    const b = parse(productSchema, req.body);
    const [row] = await sql`
      INSERT INTO products (sku, name, description, type, clave_prod_serv, clave_unidad, unit_name, sale_price, purchase_price,
        objeto_imp, iva_factor, iva_rate, min_stock, income_account_id, expense_account_id)
      VALUES (${b.sku}, ${b.name}, ${b.description ?? null}, ${b.type}, ${b.claveProdServ}, ${b.claveUnidad}, ${b.unitName},
        ${String(b.salePrice)}, ${String(b.purchasePrice)}, ${b.objetoImp}, ${b.ivaFactor}, ${String(b.ivaRate)}, ${String(b.minStock)},
        ${b.incomeAccountId ?? null}, ${b.expenseAccountId ?? null})
      RETURNING *`;
    return reply.code(201).send(row);
  });
  app.get("/products/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await sql`SELECT * FROM products WHERE id = ${id}`;
    if (!row) throw notFound("Producto");
    const stock = await sql`SELECT s.warehouse_id, w.code, w.name, s.qty FROM stock s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.product_id = ${id}`;
    return { ...row, stock };
  });

  app.get("/warehouses", async () => sql`SELECT * FROM warehouses WHERE active ORDER BY code`);
  app.post("/warehouses", async (req, reply) => {
    const b = parse(z.object({ code: z.string().min(1), name: z.string().min(1), address: z.string().optional() }), req.body);
    const [row] = await sql`INSERT INTO warehouses (code, name, address) VALUES (${b.code}, ${b.name}, ${b.address ?? null}) RETURNING *`;
    return reply.code(201).send(row);
  });

  app.get("/bank-accounts", async () => sql`SELECT b.*, a.code AS account_code FROM bank_accounts b JOIN accounts a ON a.id = b.account_id WHERE b.active ORDER BY b.name`);
  app.post("/bank-accounts", async (req, reply) => {
    const b = parse(z.object({ name: z.string().min(1), bank: z.string().optional(), clabe: z.string().regex(/^\d{18}$/).optional(), accountCode: z.string().default("102.01") }), req.body);
    const [acc] = await sql`SELECT id FROM accounts WHERE code = ${b.accountCode} AND postable`;
    if (!acc) throw badRequest("La cuenta contable no existe o no es de detalle");
    const [row] = await sql`INSERT INTO bank_accounts (name, bank, clabe, account_id) VALUES (${b.name}, ${b.bank ?? null}, ${b.clabe ?? null}, ${acc.id}) RETURNING *`;
    return reply.code(201).send(row);
  });
}
