import { createDb } from "@erp/db";
import { adjustStock } from "../services/inventory.js";
import { SandboxPac } from "../services/pac.js";
import { registerCustomerPayment, registerSupplierPayment } from "../services/payments.js";
import { createSupplierInvoice, validateSupplierInvoice } from "../services/purchases.js";
import { createSalesInvoice, issueSalesInvoice } from "../services/sales.js";

/**
 * Demo data for trying the ERP and the AI queries: customers, suppliers,
 * products, three months of purchases, sales and payments. Run once on a
 * freshly migrated and seeded database.
 */
const sql = createDb();
const pac = new SandboxPac();
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
};

try {
  const [existing] = await sql`SELECT count(*)::int AS n FROM products`;
  if (existing!.n > 0) {
    console.log("The database already has products; demo data not loaded.");
    process.exit(0);
  }
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
        await tx.savepoint(() => issueSalesInvoice(tx, id, pac));
      } catch {
        // Not enough stock for this random order: drop the draft.
        await tx`DELETE FROM sales_invoices WHERE id = ${id}`;
        continue;
      }
      const [inv] = await tx`SELECT total FROM sales_invoices WHERE id = ${id}`;
      if (!ppd || offset > 30) {
        await registerCustomerPayment(tx, { invoiceId: id, bankAccountId: bank!.id, amount: inv!.total, paidOn: day(Math.max(0, offset - (ppd ? 20 : 0))) });
      }
    }
  });
  const [s] = await sql`SELECT count(*)::int AS invoices, coalesce(sum(total), 0) AS total FROM sales_invoices WHERE status = 'stamped'`;
  console.log(`Demo data loaded: ${s!.invoices} stamped invoices for ${s!.total} MXN`);
} finally {
  await sql.end();
}
