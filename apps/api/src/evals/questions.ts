import type { GradeSpec } from "./grade.js";

/**
 * Benchmark questions for the AI assistant over the demo dataset
 * (services/demo.ts). Each truth query runs with the owner connection
 * against base tables, independently of the ai.* views the model uses, so a
 * wrong view or a wrong join in the model's SQL shows up as a failure.
 */
export interface EvalQuestion extends GradeSpec {
  id: string;
  category: "ventas" | "cobranza" | "compras" | "inventario" | "contabilidad" | "auditoría";
  question: string;
  truth: string;
}

export const QUESTIONS: EvalQuestion[] = [
  {
    id: "customers_count", category: "ventas",
    question: "¿Cuántos clientes tengo registrados?",
    truth: "SELECT count(*) AS n FROM third_parties WHERE is_customer", numbers: ["n"],
  },
  {
    id: "stamped_invoice_count", category: "ventas",
    question: "¿Cuántas facturas de venta timbradas hay en total?",
    truth: "SELECT count(*) AS n FROM sales_invoices WHERE status = 'stamped'", numbers: ["n"],
  },
  {
    id: "top_customer", category: "ventas",
    question: "¿Quién es mi mejor cliente por importe facturado (facturas timbradas, total con IVA) y cuánto le he facturado?",
    truth: `SELECT t.name, sum(i.total) AS total FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id
            WHERE i.status = 'stamped' GROUP BY t.name ORDER BY total DESC LIMIT 1`,
    texts: ["name"], numbers: ["total"],
  },
  {
    id: "sales_last_month", category: "ventas",
    question: "¿Cuánto facturé el mes calendario pasado, total con IVA, sólo facturas timbradas?",
    truth: `SELECT coalesce(sum(total), 0) AS total FROM sales_invoices WHERE status = 'stamped'
            AND issue_date >= date_trunc('month', current_date) - interval '1 month' AND issue_date < date_trunc('month', current_date)`,
    numbers: ["total"],
  },
  {
    id: "largest_invoice", category: "ventas",
    question: "¿Cuál fue la factura de venta timbrada de mayor importe, de qué cliente y por cuánto?",
    truth: `SELECT t.name, i.total FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id
            WHERE i.status = 'stamped' ORDER BY i.total DESC, i.id LIMIT 1`,
    texts: ["name"], numbers: ["total"],
  },
  {
    id: "best_product_units", category: "ventas",
    question: "¿Cuál es el producto (no servicio) más vendido en unidades en facturas timbradas? Dame su SKU.",
    truth: `SELECT p.sku FROM sales_invoice_lines l JOIN sales_invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id
            WHERE i.status = 'stamped' AND p.type = 'product' GROUP BY p.sku ORDER BY sum(l.qty) DESC LIMIT 1`,
    texts: ["sku"],
  },
  {
    id: "support_hours", category: "ventas",
    question: "¿Cuántas horas de soporte técnico (SRV-SOP) he facturado en facturas timbradas?",
    truth: `SELECT coalesce(sum(l.qty), 0)::int AS hours FROM sales_invoice_lines l JOIN sales_invoices i ON i.id = l.invoice_id
            JOIN products p ON p.id = l.product_id WHERE i.status = 'stamped' AND p.sku = 'SRV-SOP'`,
    numbers: ["hours"],
  },
  {
    id: "iva_trasladado", category: "contabilidad",
    question: "¿Cuánto IVA trasladado suman todas mis facturas de venta timbradas?",
    truth: "SELECT sum(total_traslados) AS iva FROM sales_invoices WHERE status = 'stamped'", numbers: ["iva"],
  },
  {
    id: "gross_margin", category: "ventas",
    question: "¿Cuál es el margen bruto total (importe sin IVA menos costo) de las ventas timbradas?",
    truth: `SELECT round(sum(l.base - l.qty * coalesce(l.unit_cost, 0)), 2) AS margin FROM sales_invoice_lines l
            JOIN sales_invoices i ON i.id = l.invoice_id WHERE i.status = 'stamped'`,
    numbers: ["margin"],
  },
  {
    id: "receivables", category: "cobranza",
    question: "¿Cuánto me deben en total mis clientes por facturas timbradas no pagadas?",
    truth: "SELECT sum(total - paid_amount) AS due FROM sales_invoices WHERE status = 'stamped'", numbers: ["due"],
  },
  {
    id: "unpaid_invoice_count", category: "cobranza",
    question: "¿Cuántas facturas de venta timbradas tienen saldo pendiente de cobro?",
    truth: "SELECT count(*) AS n FROM sales_invoices WHERE status = 'stamped' AND total - paid_amount > 0.005", numbers: ["n"],
  },
  {
    id: "payables", category: "compras",
    question: "¿Cuánto les debo en total a mis proveedores por facturas validadas?",
    truth: "SELECT sum(total - paid_amount) AS due FROM supplier_invoices WHERE status = 'validated'", numbers: ["due"],
  },
  {
    id: "top_supplier", category: "compras",
    question: "¿A qué proveedor le he comprado más en total (facturas de proveedor validadas)?",
    truth: `SELECT t.name FROM supplier_invoices s JOIN third_parties t ON t.id = s.third_party_id
            WHERE s.status = 'validated' GROUP BY t.name ORDER BY sum(s.total) DESC LIMIT 1`,
    texts: ["name"],
  },
  {
    id: "inventory_value", category: "inventario",
    question: "¿Cuál es el valor total de mi inventario a costo promedio?",
    truth: "SELECT round(sum(s.qty * p.avg_cost), 2) AS value FROM stock s JOIN products p ON p.id = s.product_id", numbers: ["value"],
  },
  {
    id: "laptop_stock", category: "inventario",
    question: "¿Cuántas laptops LAP-14 tengo en existencia sumando todos los almacenes?",
    truth: "SELECT coalesce(sum(s.qty), 0)::int AS qty FROM stock s JOIN products p ON p.id = s.product_id WHERE p.sku = 'LAP-14'",
    numbers: ["qty"],
  },
  {
    id: "mouse_shop_stock", category: "inventario",
    question: "¿Cuántos mouse MOU-01 hay en el almacén Tienda Centro (TDA)?",
    truth: `SELECT coalesce(sum(s.qty), 0)::int AS qty FROM stock s JOIN products p ON p.id = s.product_id JOIN warehouses w ON w.id = s.warehouse_id
            WHERE p.sku = 'MOU-01' AND w.code = 'TDA'`,
    numbers: ["qty"],
  },
  {
    id: "monitor_avg_cost", category: "inventario",
    question: "¿Cuál es el costo promedio actual del monitor MON-27?",
    truth: "SELECT round(avg_cost, 2) AS cost FROM products WHERE sku = 'MON-27'", numbers: ["cost"],
  },
  {
    id: "below_min", category: "inventario",
    question: "¿Qué productos están por debajo de su existencia mínima? Dame sus SKU.",
    truth: `SELECT p.sku FROM products p LEFT JOIN stock s ON s.product_id = p.id
            WHERE p.type = 'product' AND p.min_stock > 0 GROUP BY p.id HAVING coalesce(sum(s.qty), 0) < p.min_stock ORDER BY p.sku`,
    allTexts: "sku",
  },
  {
    id: "bank_balance", category: "contabilidad",
    question: "¿Cuál es el saldo contable de la cuenta 102.01 (bancos) con todas las pólizas contabilizadas?",
    truth: `SELECT sum(l.debit - l.credit) AS balance FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
            JOIN accounts a ON a.id = l.account_id WHERE e.status = 'posted' AND a.code = '102.01'`,
    numbers: ["balance"],
  },
  {
    id: "audit_high", category: "auditoría",
    question: "¿Cuántos hallazgos de severidad alta tiene abiertos el auditor?",
    truth: "SELECT count(*) AS n FROM audit_findings WHERE status = 'open' AND severity = 'high'", numbers: ["n"],
  },
  {
    id: "supplier_69b", category: "auditoría",
    question: "¿Alguno de mis proveedores aparece en la lista 69-B del SAT? ¿Cuál?",
    truth: "SELECT t.name FROM third_parties t JOIN sat_69b l ON l.rfc = upper(t.rfc) WHERE t.is_supplier ORDER BY t.name LIMIT 1",
    texts: ["name"],
  },
];
