-- Read-only surface for the AI query feature. The model can only see the
-- views in schema "ai", through a role that has no other privileges. Views
-- run with the owner's rights, so the reader never touches base tables.

CREATE SCHEMA ai;

CREATE VIEW ai.products AS
SELECT p.id, p.sku, p.name, p.description, p.type, p.clave_prod_serv, p.clave_unidad, p.unit_name,
       p.sale_price, p.purchase_price, p.avg_cost, p.iva_factor, p.iva_rate, p.min_stock, p.active,
       coalesce((SELECT sum(s.qty) FROM stock s WHERE s.product_id = p.id), 0) AS total_qty
FROM products p;
COMMENT ON VIEW ai.products IS 'Catálogo de productos y servicios. avg_cost es el costo promedio ponderado (PMP). total_qty es la existencia total en todos los almacenes.';

CREATE VIEW ai.warehouses AS SELECT id, code, name, address, active FROM warehouses;
COMMENT ON VIEW ai.warehouses IS 'Almacenes.';

CREATE VIEW ai.stock_levels AS
SELECT s.product_id, p.sku, p.name AS product_name, s.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
       s.qty, p.avg_cost, round(s.qty * p.avg_cost, 2) AS stock_value, p.min_stock, (s.qty < p.min_stock) AS below_min_stock
FROM stock s JOIN products p ON p.id = s.product_id JOIN warehouses w ON w.id = s.warehouse_id;
COMMENT ON VIEW ai.stock_levels IS 'Existencias por producto y almacén, valuadas a costo promedio. below_min_stock indica que está por debajo del mínimo.';

CREATE VIEW ai.stock_movements AS
SELECT m.id, m.moved_at, m.product_id, p.sku, p.name AS product_name, m.warehouse_id, w.code AS warehouse_code,
       m.kind, m.qty, m.unit_cost, round(m.qty * m.unit_cost, 2) AS value, m.avg_cost_after, m.label, m.source_type, m.source_id
FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id;
COMMENT ON VIEW ai.stock_movements IS 'Kardex: movimientos de inventario. qty positiva = entrada, negativa = salida. kind: initial, purchase, sale, adjustment, transfer, inventory, return.';

CREATE VIEW ai.third_parties AS
SELECT id, name, rfc, regimen_fiscal, codigo_postal, uso_cfdi, is_customer, is_supplier, email, phone, credit_days, active, created_at
FROM third_parties;
COMMENT ON VIEW ai.third_parties IS 'Terceros: clientes (is_customer) y proveedores (is_supplier).';

CREATE VIEW ai.sales_invoices AS
SELECT i.id, i.serie, i.folio, i.serie || '-' || coalesce(i.folio::text, 'borrador') AS invoice_number, i.issue_date,
       i.third_party_id AS customer_id, t.name AS customer_name, t.rfc AS customer_rfc,
       i.tipo_comprobante, i.uso_cfdi, i.metodo_pago, i.forma_pago, i.moneda,
       i.subtotal, i.discount, i.total_traslados AS iva, i.total_retenciones AS retenciones, i.total,
       i.paid_amount, i.total - i.paid_amount AS balance_due, i.status, i.uuid, i.stamped_at
FROM sales_invoices i JOIN third_parties t ON t.id = i.third_party_id;
COMMENT ON VIEW ai.sales_invoices IS 'Facturas de venta (CFDI emitidos). status: draft, validated, stamped (timbrada), cancelled. Las ventas reales excluyen draft y cancelled.';

CREATE VIEW ai.sales_invoice_lines AS
SELECT l.id, l.invoice_id, i.issue_date, i.status AS invoice_status, l.product_id, p.sku, l.description, l.qty, l.unit_price,
       l.discount, l.base, l.iva_rate, l.iva_amount, l.ret_iva_amount, l.ret_isr_amount, l.total, l.unit_cost,
       round(l.base - l.qty * coalesce(l.unit_cost, 0), 2) AS gross_margin
FROM sales_invoice_lines l JOIN sales_invoices i ON i.id = l.invoice_id LEFT JOIN products p ON p.id = l.product_id;
COMMENT ON VIEW ai.sales_invoice_lines IS 'Conceptos de facturas de venta. base = importe neto sin IVA. gross_margin = base menos costo.';

CREATE VIEW ai.supplier_invoices AS
SELECT s.id, s.supplier_ref, s.uuid, s.issue_date, s.third_party_id AS supplier_id, t.name AS supplier_name, t.rfc AS supplier_rfc,
       s.metodo_pago, s.subtotal, s.discount, s.iva, s.ret_iva, s.ret_isr, s.total, s.paid_amount, s.total - s.paid_amount AS balance_due, s.status
FROM supplier_invoices s JOIN third_parties t ON t.id = s.third_party_id;
COMMENT ON VIEW ai.supplier_invoices IS 'Facturas de proveedores (CFDI recibidos / compras y gastos).';

CREATE VIEW ai.supplier_invoice_lines AS
SELECT l.id, l.invoice_id, l.product_id, p.sku, a.code AS account_code, l.description, l.qty, l.unit_price, l.discount,
       l.base, l.iva_rate, l.iva_amount, l.ret_iva_amount, l.ret_isr_amount, l.total
FROM supplier_invoice_lines l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN accounts a ON a.id = l.account_id;
COMMENT ON VIEW ai.supplier_invoice_lines IS 'Conceptos de facturas de proveedores. Producto inventariable o cuenta de gasto.';

CREATE VIEW ai.payments AS
SELECT y.id, y.direction, y.paid_on, y.amount, y.forma_pago, y.third_party_id, t.name AS third_party_name,
       b.name AS bank_account, y.sales_invoice_id, y.supplier_invoice_id, y.reference
FROM payments y JOIN third_parties t ON t.id = y.third_party_id JOIN bank_accounts b ON b.id = y.bank_account_id;
COMMENT ON VIEW ai.payments IS 'Cobros (direction=in) y pagos (direction=out).';

CREATE VIEW ai.bank_accounts AS SELECT b.id, b.name, b.bank, b.currency, a.code AS account_code FROM bank_accounts b JOIN accounts a ON a.id = b.account_id;
COMMENT ON VIEW ai.bank_accounts IS 'Cuentas bancarias y su cuenta contable.';

CREATE VIEW ai.accounts AS
SELECT a.id, a.code, a.name, pa.code AS parent_code, a.level, a.nature, a.kind, a.sat_code, s.description AS sat_description, a.postable, a.active
FROM accounts a LEFT JOIN accounts pa ON pa.id = a.parent_id JOIN sat_codigo_agrupador s ON s.code = a.sat_code;
COMMENT ON VIEW ai.accounts IS 'Catálogo de cuentas contables con su código agrupador SAT. nature D = deudora, A = acreedora. kind: asset, liability, equity, income, cost, expense, memo.';

CREATE VIEW ai.journal_entries AS
SELECT e.id, e.journal_code, j.name AS journal_name, j.sat_type, e.number, e.entry_date, e.concept, e.status, e.source_type, e.source_id
FROM journal_entries e JOIN journals j ON j.code = e.journal_code;
COMMENT ON VIEW ai.journal_entries IS 'Pólizas contables. sat_type: I ingreso, E egreso, D diario. Sólo status=posted afecta saldos.';

CREATE VIEW ai.journal_lines AS
SELECT l.id, l.entry_id, e.entry_date, e.journal_code, e.status AS entry_status, a.code AS account_code, a.name AS account_name, a.kind AS account_kind,
       l.debit, l.credit, l.description, l.cfdi_uuid, l.rfc
FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id;
COMMENT ON VIEW ai.journal_lines IS 'Movimientos (cargos=debit, abonos=credit) de las pólizas.';

CREATE VIEW ai.account_balances_monthly AS
SELECT extract(year FROM e.entry_date)::int AS year, extract(month FROM e.entry_date)::int AS month,
       a.code AS account_code, a.name AS account_name, a.kind AS account_kind, a.nature,
       sum(l.debit) AS debit, sum(l.credit) AS credit,
       CASE WHEN a.nature = 'D' THEN sum(l.debit - l.credit) ELSE sum(l.credit - l.debit) END AS net_movement
FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
WHERE e.status = 'posted'
GROUP BY 1, 2, a.code, a.name, a.kind, a.nature;
COMMENT ON VIEW ai.account_balances_monthly IS 'Movimientos contabilizados por cuenta y mes. net_movement va en el sentido de la naturaleza de la cuenta (ingresos positivos en cuentas acreedoras).';

CREATE TABLE ai_query_log (
  id            serial PRIMARY KEY,
  question      text NOT NULL,
  answer        text,
  queries       jsonb NOT NULL DEFAULT '[]',
  model         text,
  input_tokens  int,
  output_tokens int,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_ai_reader') THEN
    CREATE ROLE erp_ai_reader NOLOGIN;
  END IF;
END $$;
ALTER ROLE erp_ai_reader SET default_transaction_read_only = on;
ALTER ROLE erp_ai_reader SET statement_timeout = '5s';
ALTER ROLE erp_ai_reader SET search_path = ai;
GRANT USAGE ON SCHEMA ai TO erp_ai_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA ai TO erp_ai_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT SELECT ON TABLES TO erp_ai_reader;
