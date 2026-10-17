import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createTestEnv, inject, type TestEnv } from "./helpers.js";

let env: TestEnv;
const ids = { warehouse: 0, bank: 0, customer: 0, supplier: 0, laptop: 0, service: 0, invoice: 0, purchase1: 0 };
const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;
const today = now.toISOString().slice(0, 10);

beforeAll(async () => {
  env = await createTestEnv();
  const { app } = env;
  ids.warehouse = (await call(app, "POST", "/warehouses", { code: "MAIN", name: "Almacén general" })).id;
  ids.bank = (await call(app, "POST", "/bank-accounts", { name: "BBVA Operativa", bank: "BBVA" })).id;
  ids.customer = (await call(app, "POST", "/third-parties", {
    name: "BERENICE XIMO QUEZADA", rfc: "XIQB891116QE4", regimenFiscal: "612", codigoPostal: "06000", usoCfdi: "G03", isCustomer: true,
  })).id;
  ids.supplier = (await call(app, "POST", "/third-parties", {
    name: "PROVEEDORA DEL CENTRO", rfc: "PCE010101AB1", regimenFiscal: "601", codigoPostal: "42501", isSupplier: true,
  })).id;
  ids.laptop = (await call(app, "POST", "/products", {
    sku: "LAP-001", name: "Laptop 14 pulgadas", claveProdServ: "43211503", claveUnidad: "H87", salePrice: 18000, minStock: 5,
  })).id;
  ids.service = (await call(app, "POST", "/products", {
    sku: "SRV-INST", name: "Instalación", type: "service", claveProdServ: "81111500", claveUnidad: "E48", unitName: "Servicio", salePrice: 1000,
  })).id;
}, 60_000);

afterAll(async () => env?.close());

describe("purchases and weighted average cost", () => {
  it("receives stock and recalculates PMP", async () => {
    const { app } = env;
    for (const [qty, price] of [[10, 10000], [10, 12000]] as const) {
      const { id } = await call(app, "POST", "/supplier-invoices", {
        thirdPartyId: ids.supplier, warehouseId: ids.warehouse, uuid: "5FB2822E-396D-4725-8521-CDC4BDD20CCF".replace("5FB", `${qty}${price}`.slice(0, 3)),
        lines: [{ productId: ids.laptop, qty, unitPrice: price }],
      });
      ids.purchase1 ||= id;
      await call(app, "POST", `/supplier-invoices/${id}/validate`);
    }
    const product = await call(app, "GET", `/products/${ids.laptop}`);
    expect(product.avg_cost).toBe("11000.000000");
    expect(product.stock[0].qty).toBe("20.000000");

    const entry = await call(app, "GET", `/journal-entries?journal=AC`);
    expect(entry).toHaveLength(2);
    const detail = await call(app, "GET", `/journal-entries/${entry[1].id}`);
    const byCode = Object.fromEntries(detail.lines.map((l: any) => [l.code, l]));
    expect(byCode["115.01"].debit).toBe("100000.00");
    expect(byCode["119.01"].debit).toBe("16000.00");
    expect(byCode["201.01"].credit).toBe("116000.00");
  });
});

describe("sales invoice (CFDI 4.0)", () => {
  it("rejects issuing without stock", async () => {
    const { app } = env;
    const { id } = await call(app, "POST", "/sales-invoices", {
      thirdPartyId: ids.customer, warehouseId: ids.warehouse, metodoPago: "PUE", formaPago: "03",
      lines: [{ productId: ids.laptop, qty: 999 }],
    });
    const res = await inject(app, { method: "POST", url: `/sales-invoices/${id}/issue` });
    expect(res.statusCode).toBe(409);
    // The failed attempt must not consume a folio or leave stock moved.
    const product = await call(app, "GET", `/products/${ids.laptop}`);
    expect(product.stock[0].qty).toBe("20.000000");
    await call(app, "POST", `/sales-invoices/${id}/cancel`, {});
  });

  it("issues, stamps, moves stock and posts entries", async () => {
    const { app } = env;
    const { id } = await call(app, "POST", "/sales-invoices", {
      thirdPartyId: ids.customer, warehouseId: ids.warehouse, metodoPago: "PPD",
      lines: [{ productId: ids.laptop, qty: 3 }, { productId: ids.service, qty: 1 }],
    });
    ids.invoice = id;
    const issued = await call(app, "POST", `/sales-invoices/${id}/issue`);
    expect(issued.folio).toBe(1);
    expect(issued.uuid).toMatch(/^[0-9A-F-]{36}$/);

    const inv = await call(app, "GET", `/sales-invoices/${id}`);
    expect(inv.status).toBe("stamped");
    expect(inv.forma_pago).toBe("99");
    expect(inv.total).toBe("63800.00"); // (54000 + 1000) * 1.16
    expect(inv.lines[0].unit_cost).toBe("11000.000000");

    const xml = await call<string>(app, "GET", `/sales-invoices/${id}/xml`);
    expect(xml).toContain('Version="4.0"');
    expect(xml).toContain('MetodoPago="PPD"');
    expect(xml).toContain('FormaPago="99"');
    expect(xml).toContain('Total="63800.00"');
    expect(xml).toContain(`UUID="${issued.uuid}"`);

    const product = await call(app, "GET", `/products/${ids.laptop}`);
    expect(product.stock[0].qty).toBe("17.000000");
  });

  it("collects a partial payment and moves IVA to cobrado", async () => {
    const { app } = env;
    const pay = await call(app, "POST", `/sales-invoices/${ids.invoice}/payments`, { bankAccountId: ids.bank, amount: "31900.00" });
    expect(pay.ivaCollected).toBe("4400.00");
    const tb = await call<any[]>(app, "GET", `/reports/trial-balance?year=${year}&month=${month}`);
    const bal = Object.fromEntries(tb.map((r) => [r.code, r.saldoFin]));
    expect(bal["105.01"]).toBe("31900.00");
    expect(bal["209.01"]).toBe("4400.00");
    expect(bal["208.01"]).toBe("4400.00");
    expect(bal["501.01"]).toBe("33000.00");
    expect(bal["115.01"]).toBe("187000.00");
    expect(bal["401.01"]).toBe("55000.00");
    // Parents roll up their children.
    expect(bal["105"]).toBe("31900.00");
  });

  it("refuses to cancel an invoice that has payments", async () => {
    const res = await inject(env.app, { method: "POST", url: `/sales-invoices/${ids.invoice}/cancel`, payload: { motivo: "02" } });
    expect(res.statusCode).toBe(409);
  });
});

describe("tax reports and SAT electronic accounting", () => {
  it("computes monthly IVA from the ledger", async () => {
    const { app } = env;
    await call(app, "POST", `/supplier-invoices/${ids.purchase1}/payments`, { bankAccountId: ids.bank, amount: "116000.00" });
    const iva = await call(app, "GET", `/reports/iva?year=${year}&month=${month}`);
    expect(iva.ivaCausado).toBe("4400.00");
    expect(iva.ivaAcreditable).toBe("16000.00");
    expect(iva.ivaAFavor).toBe("11600.00");
  });

  it("exports catálogo, balanza and pólizas XML", async () => {
    const { app } = env;
    const catalogo = await call<string>(app, "GET", `/sat/electronic-accounting/catalogo?year=${year}&month=${month}`);
    expect(catalogo).toContain('CodAgrup="105.01"');
    const balanza = await call<string>(app, "GET", `/sat/electronic-accounting/balanza?year=${year}&month=${month}`);
    expect(balanza).toContain('NumCta="105.01"');
    const polizas = await call<string>(app, "GET", `/sat/electronic-accounting/polizas?year=${year}&month=${month}&tipoSolicitud=AF&numOrden=ABC6912345/12`);
    expect(polizas).toContain("<PLZ:CompNal");
    const missing = await inject(app, { method: "GET", url: `/sat/electronic-accounting/polizas?year=${year}&month=${month}&tipoSolicitud=AF` });
    expect(missing.statusCode).toBe(400);
  });

  it("produces an income statement", async () => {
    const r = await call(env.app, "GET", `/reports/income-statement?from=${year}-01-01&to=${year}-12-31`);
    expect(r.income).toBe("55000.00");
    expect(r.grossProfit).toBe("22000.00");
  });
});

describe("accounting integrity", () => {
  it("rejects unbalanced manual entries", async () => {
    const res = await inject(env.app, {
      method: "POST", url: "/journal-entries",
      payload: { date: today, concept: "Descuadre", lines: [{ accountCode: "601.84", debit: 100 }, { accountCode: "102.01", credit: 90 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects postings to summary accounts", async () => {
    const res = await inject(env.app, {
      method: "POST", url: "/journal-entries",
      payload: { date: today, concept: "Cuenta de mayor", lines: [{ accountCode: "601", debit: 100 }, { accountCode: "102.01", credit: 100 }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it("blocks postings in closed periods", async () => {
    const { app } = env;
    await call(app, "POST", `/periods/2020/1/close`);
    const res = await inject(app, {
      method: "POST", url: "/journal-entries",
      payload: { date: "2020-01-15", concept: "Periodo cerrado", lines: [{ accountCode: "601.84", debit: 100 }, { accountCode: "102.01", credit: 100 }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it("keeps posted entries immutable", async () => {
    await expect(env.sql`UPDATE journal_entries SET concept = 'x' WHERE status = 'posted'`).rejects.toThrow(/contabilizada/);
    await expect(env.sql`DELETE FROM journal_lines`).rejects.toThrow(/contabilizada/);
  });
});

describe("inventory counts and adjustments", () => {
  it("posts shrinkage from a physical count", async () => {
    const { app } = env;
    const { id } = await call(app, "POST", "/inventory-counts", { warehouseId: ids.warehouse, label: "Conteo mensual" });
    await call(app, "PUT", `/inventory-counts/${id}/lines`, [{ productId: ids.laptop, qtyCounted: 16 }]);
    const r = await call(app, "POST", `/inventory-counts/${id}/validate`);
    expect(r.adjustments).toHaveLength(1);
    const product = await call(app, "GET", `/products/${ids.laptop}`);
    expect(product.stock[0].qty).toBe("16.000000");
    const tb = await call<any[]>(app, "GET", `/reports/trial-balance?year=${year}&month=${month}`);
    expect(tb.find((r) => r.code === "115.01").saldoFin).toBe("176000.00");
  });
});
