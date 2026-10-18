import type { Sql } from "@erp/db";
import { adjustStock } from "./inventory.js";
import { SandboxPac } from "./pac.js";
import { registerCustomerPayment, registerSupplierPayment } from "./payments.js";
import { createSupplierInvoice, validateSupplierInvoice } from "./purchases.js";
import { createSalesInvoice, issueSalesInvoice } from "./sales.js";
import { createUser } from "./users.js";

/**
 * Demo data for trying the ERP and the AI features: customers, suppliers,
 * products, three months of purchases, sales and payments, plus a few planted
 * problems for the auditor to find. Run once on a freshly migrated and seeded
 * database. Random choices use a fixed seed so every run builds the same books.
 */
export async function seedDemo(sql: Sql, opts: { createAdmin?: boolean } = {}) {
  const pac = new SandboxPac();
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };

  const [existing] = await sql`SELECT count(*)::int AS n FROM products`;
  if (existing!.n > 0) return { loaded: false as const };
  await sql.begin(async (tx) => {
    const [main] = await tx`INSERT INTO warehouses (code, name, address) VALUES ('MAIN', 'Almacén general', 'Pachuca, Hgo.') RETURNING id`;
    const [shop] = await tx`INSERT INTO warehouses (code, name, address) VALUES ('TDA', 'Tienda Centro', 'Ciudad de México') RETURNING id`;
    const [bankAcc] = await tx`SELECT id FROM accounts WHERE code = '102.01'`;
    const [bank] = await tx`INSERT INTO bank_accounts (name, bank, clabe, account_id) VALUES ('BBVA Operativa', 'BBVA', '012180001234567891', ${bankAcc!.id}) RETURNING id`;

    const customers = await tx`
      INSERT INTO third_parties (name, rfc, regimen_fiscal, codigo_postal, uso_cfdi, is_customer, email, credit_days) VALUES
        ('BERENICE XIMO QUEZADA', 'XIQB891116QE4', '612', '06000', 'G03', true, 'berenice@example.mx', 0),
        ('COMERCIALIZADORA DEL BAJIO', 'CBA0505129K3', '601', '37000', 'G01', true, 'compras@bajio.example.mx', 30),
        ('INNOVACION EDUCATIVA', 'IED1203145T2', '601', '64000', 'G03', true, 'admin@innova.example.mx', 15),
        ('HOSPITAL SAN RAFAEL', 'HSR990801AB4', '603', '44100', 'G03', true, 'pagos@hsr.example.mx', 30)
      RETURNING id`;
    const suppliers = await tx`
      INSERT INTO third_parties (name, rfc, regimen_fiscal, codigo_postal, is_supplier, email) VALUES
        ('DISTRIBUIDORA TECNOLOGICA', 'DTE0101011A1', '601', '03100', true, 'ventas@dtec.example.mx'),
        ('PAPELERIA MAYORISTA', 'PMA0808088B2', '601', '15900', true, 'pedidos@pmay.example.mx')
      RETURNING id`;
    const products = await tx`
      INSERT INTO products (sku, name, type, clave_prod_serv, clave_unidad, unit_name, sale_price, purchase_price, min_stock) VALUES
        ('LAP-14', 'Laptop 14" 16GB', 'product', '43211503', 'H87', 'Pieza', 18999, 13500, 5),
        ('MON-27', 'Monitor 27" 4K', 'product', '43211902', 'H87', 'Pieza', 7499, 5200, 4),
        ('MOU-01', 'Mouse inalámbrico', 'product', '43211708', 'H87', 'Pieza', 349, 180, 20),
        ('TEC-01', 'Teclado mecánico', 'product', '43211706', 'H87', 'Pieza', 1299, 760, 10),
        ('PAP-CJ', 'Papel bond carta (caja 5000 hojas)', 'product', '14111507', 'XBX', 'Caja', 899, 610, 15)
      RETURNING id, purchase_price, sale_price`;
    const [service] = await tx`
      INSERT INTO products (sku, name, type, clave_prod_serv, clave_unidad, unit_name, sale_price)
      VALUES ('SRV-SOP', 'Soporte técnico (hora)', 'service', '81111812', 'HUR', 'Hora', 650) RETURNING id`;

    // Opening stock in the shop warehouse.
    for (const p of products.slice(0, 3)) {
      await adjustStock(tx, { productId: p.id, warehouseId: shop!.id, qty: 3, unitCost: p.purchase_price, reason: "Inventario inicial", initial: true, date: day(95) });
    }

    // Purchases every ~2 weeks.
    for (let offset = 90, i = 0; offset >= 0; offset -= 14, i++) {
      const supplier = i % 2 === 1 ? suppliers[1]! : suppliers[0]!;
      const lines = (supplier === suppliers[1] ? products.slice(4) : products.slice(0, 4)).map((p) => ({
        productId: p.id as number,
        qty: Math.round(6 + rand() * 14),
        unitPrice: (Number(p.purchase_price) * (0.95 + rand() * 0.1)).toFixed(2),
      }));
      const id = await createSupplierInvoice(tx, {
        thirdPartyId: supplier.id, warehouseId: main!.id, issueDate: day(offset), metodoPago: "PPD",
        supplierRef: `F-${1000 + offset}`, uuid: crypto.randomUUID(), lines,
      });
      await validateSupplierInvoice(tx, id);
      if (offset > 20) {
        const [inv] = await tx`SELECT total FROM supplier_invoices WHERE id = ${id}`;
        await registerSupplierPayment(tx, { invoiceId: id, bankAccountId: bank!.id, amount: inv!.total, paidOn: day(offset - 10) });
      }
    }

    // Sales a few times a week.
    for (let offset = 88; offset >= 0; offset -= 2 + Math.floor(rand() * 3)) {
      const customer = pick(customers);
      const items = products.slice(0, 5).filter(() => rand() < 0.45);
      if (!items.length) items.push(products[2]!);
      const lines = items.map((p) => ({ productId: p.id as number, qty: 1 + Math.floor(rand() * 3) }));
      if (rand() < 0.3) lines.push({ productId: service!.id, qty: 1 + Math.floor(rand() * 4) });
      const ppd = customer.id !== customers[0]!.id;
      const id = await createSalesInvoice(tx, {
        thirdPartyId: customer.id, warehouseId: main!.id, metodoPago: ppd ? "PPD" : "PUE", formaPago: ppd ? undefined : "03",
        issueDate: `${day(offset)} 11:30:00`, lines,
      });
      try {
        await tx.savepoint(() => issueSalesInvoice(tx, id, { pac, timezone: "America/Mexico_City" }));
      } catch {
        // Not enough stock for this random order: drop the draft.
        await tx`DELETE FROM sales_invoices WHERE id = ${id}`;
        continue;
      }
      const [inv] = await tx`SELECT total FROM sales_invoices WHERE id = ${id}`;
      if (!ppd || offset > 15) {
        await registerCustomerPayment(tx, { invoiceId: id, bankAccountId: bank!.id, amount: inv!.total, paidOn: day(Math.max(0, offset - (ppd ? 12 : 0))) });
      }
    }

    // Planted problems for the auditor and the 69-B check to find.
    const [lastPurchase] = await tx<{ id: number }[]>`
      SELECT id FROM supplier_invoices WHERE third_party_id = ${suppliers[0]!.id} ORDER BY issue_date DESC, id DESC LIMIT 1`;
    const dupLines = await tx<{ product_id: number; qty: string; unit_price: string }[]>`
      SELECT product_id, qty, unit_price FROM supplier_invoice_lines WHERE invoice_id = ${lastPurchase!.id} ORDER BY line_no`;
    const dup = await createSupplierInvoice(tx, {
      thirdPartyId: suppliers[0]!.id, warehouseId: main!.id, issueDate: day(3), metodoPago: "PPD", supplierRef: "F-2001",
      uuid: crypto.randomUUID(), lines: dupLines.map((l) => ({ productId: l.product_id, qty: l.qty, unitPrice: l.unit_price })),
    });
    await validateSupplierInvoice(tx, dup);
    const spike = await createSupplierInvoice(tx, {
      thirdPartyId: suppliers[0]!.id, warehouseId: main!.id, issueDate: day(1), metodoPago: "PPD", supplierRef: "F-2002",
      uuid: crypto.randomUUID(), lines: [{ productId: products[1]!.id, qty: 2, unitPrice: (Number(products[1]!.purchase_price) * 1.6).toFixed(2) }],
    });
    await validateSupplierInvoice(tx, spike);
    const [ghost] = await tx`
      INSERT INTO third_parties (name, rfc, regimen_fiscal, codigo_postal, is_supplier)
      VALUES ('SERVICIOS CORPORATIVOS DEL VALLE', 'SCV150401KJ3', '601', '54000', true) RETURNING id`;
    await tx`INSERT INTO sat_69b (rfc, name, situacion) VALUES ('SCV150401KJ3', 'SERVICIOS CORPORATIVOS DEL VALLE SA DE CV', 'Definitivo')
             ON CONFLICT (rfc) DO NOTHING`;
    const consulting = await createSupplierInvoice(tx, {
      thirdPartyId: ghost!.id, issueDate: day(15), supplierRef: "A-88", uuid: crypto.randomUUID(),
      lines: [{ description: "Asesoría administrativa", qty: 1, unitPrice: "45000" }],
    });
    await validateSupplierInvoice(tx, consulting);
  });
  const [s] = await sql<{ invoices: number; total: string }[]>`SELECT count(*)::int AS invoices, coalesce(sum(total), 0)::text AS total FROM sales_invoices WHERE status = 'stamped'`;
  let demoLogin: string | null = null;
  const [users] = await sql`SELECT count(*)::int AS n FROM users`;
  if (opts.createAdmin !== false && users!.n === 0) {
    // Fixed demo password: only for a demo database, never for real data.
    await createUser(sql, { email: "admin@demo.mx", name: "Administrador demo", role: "admin", password: "demo-erp-2026" });
    demoLogin = "admin@demo.mx / demo-erp-2026";
  }
  return { loaded: true as const, invoices: s!.invoices, total: s!.total, demoLogin };
}
