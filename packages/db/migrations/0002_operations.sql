-- Third parties, banks, products, stock and invoicing (modelled after the
-- Dolibarr modules: Tiers, Banques, Produits, Stocks, Factures).

CREATE TABLE third_parties (
  id              serial PRIMARY KEY,
  name            text NOT NULL,
  rfc             text NOT NULL,
  regimen_fiscal  text NOT NULL,
  codigo_postal   text NOT NULL CHECK (codigo_postal ~ '^\d{5}$'),
  uso_cfdi        text NOT NULL DEFAULT 'G03',
  is_customer     boolean NOT NULL DEFAULT false,
  is_supplier     boolean NOT NULL DEFAULT false,
  email           text,
  phone           text,
  address         text,
  credit_days     int NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (is_customer OR is_supplier)
);
CREATE INDEX third_parties_rfc_idx ON third_parties (rfc);

CREATE TABLE bank_accounts (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  bank       text,
  clabe      text CHECK (clabe IS NULL OR clabe ~ '^\d{18}$'),
  currency   text NOT NULL DEFAULT 'MXN',
  account_id int NOT NULL REFERENCES accounts(id),
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE warehouses (
  id      serial PRIMARY KEY,
  code    text NOT NULL UNIQUE,
  name    text NOT NULL,
  address text,
  active  boolean NOT NULL DEFAULT true
);

CREATE TABLE products (
  id              serial PRIMARY KEY,
  sku             text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  type            text NOT NULL DEFAULT 'product' CHECK (type IN ('product', 'service')),
  clave_prod_serv text NOT NULL CHECK (clave_prod_serv ~ '^\d{8}$'),
  clave_unidad    text NOT NULL,
  unit_name       text NOT NULL DEFAULT 'Pieza',
  sale_price      numeric(18,6) NOT NULL DEFAULT 0,
  purchase_price  numeric(18,6) NOT NULL DEFAULT 0,
  -- c_ObjetoImp and IVA treatment used as invoice line defaults.
  objeto_imp      text NOT NULL DEFAULT '02',
  iva_factor      text NOT NULL DEFAULT 'Tasa' CHECK (iva_factor IN ('Tasa', 'Exento')),
  iva_rate        numeric(8,6) NOT NULL DEFAULT 0.16,
  -- Optional account binding; falls back to account_settings defaults.
  income_account_id  int REFERENCES accounts(id),
  expense_account_id int REFERENCES accounts(id),
  -- Weighted average cost (PMP), recalculated on every receipt.
  avg_cost        numeric(18,6) NOT NULL DEFAULT 0,
  min_stock       numeric(18,6) NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock (
  product_id   int NOT NULL REFERENCES products(id),
  warehouse_id int NOT NULL REFERENCES warehouses(id),
  qty          numeric(18,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE stock_movements (
  id             serial PRIMARY KEY,
  product_id     int NOT NULL REFERENCES products(id),
  warehouse_id   int NOT NULL REFERENCES warehouses(id),
  qty            numeric(18,6) NOT NULL CHECK (qty <> 0),
  unit_cost      numeric(18,6) NOT NULL DEFAULT 0,
  kind           text NOT NULL CHECK (kind IN ('initial', 'purchase', 'sale', 'adjustment', 'transfer', 'inventory', 'return')),
  label          text,
  source_type    text,
  source_id      int,
  avg_cost_after numeric(18,6) NOT NULL,
  moved_at       date NOT NULL DEFAULT current_date,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id, moved_at);

CREATE TABLE inventory_counts (
  id           serial PRIMARY KEY,
  warehouse_id int NOT NULL REFERENCES warehouses(id),
  label        text NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz
);

CREATE TABLE inventory_count_lines (
  count_id     int NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id   int NOT NULL REFERENCES products(id),
  qty_expected numeric(18,6) NOT NULL,
  qty_counted  numeric(18,6),
  PRIMARY KEY (count_id, product_id)
);

CREATE TABLE sales_invoices (
  id                serial PRIMARY KEY,
  serie             text NOT NULL,
  folio             int,
  issue_date        timestamp NOT NULL DEFAULT date_trunc('second', localtimestamp),
  third_party_id    int NOT NULL REFERENCES third_parties(id),
  warehouse_id      int REFERENCES warehouses(id),
  tipo_comprobante  char(1) NOT NULL DEFAULT 'I' CHECK (tipo_comprobante IN ('I', 'E')),
  uso_cfdi          text NOT NULL,
  metodo_pago       text NOT NULL CHECK (metodo_pago IN ('PUE', 'PPD')),
  forma_pago        text NOT NULL,
  moneda            text NOT NULL DEFAULT 'MXN',
  tipo_cambio       numeric(18,6),
  subtotal          numeric(18,2) NOT NULL DEFAULT 0,
  discount          numeric(18,2) NOT NULL DEFAULT 0,
  total_traslados   numeric(18,2) NOT NULL DEFAULT 0,
  total_retenciones numeric(18,2) NOT NULL DEFAULT 0,
  total             numeric(18,2) NOT NULL DEFAULT 0,
  paid_amount       numeric(18,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'stamped', 'cancelled')),
  uuid              text UNIQUE,
  xml               text,
  stamped_at        timestamptz,
  pac               text,
  journal_entry_id  int REFERENCES journal_entries(id),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (serie, folio)
);

CREATE TABLE sales_invoice_lines (
  id              serial PRIMARY KEY,
  invoice_id      int NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  line_no         int NOT NULL,
  product_id      int REFERENCES products(id),
  description     text NOT NULL,
  clave_prod_serv text NOT NULL,
  clave_unidad    text NOT NULL,
  unit_name       text,
  qty             numeric(18,6) NOT NULL CHECK (qty > 0),
  unit_price      numeric(18,6) NOT NULL CHECK (unit_price >= 0),
  discount        numeric(18,2) NOT NULL DEFAULT 0,
  objeto_imp      text NOT NULL DEFAULT '02',
  iva_factor      text NOT NULL DEFAULT 'Tasa',
  iva_rate        numeric(8,6) NOT NULL DEFAULT 0.16,
  ret_iva_rate    numeric(8,6) NOT NULL DEFAULT 0,
  ret_isr_rate    numeric(8,6) NOT NULL DEFAULT 0,
  base            numeric(18,2) NOT NULL DEFAULT 0,
  iva_amount      numeric(18,2) NOT NULL DEFAULT 0,
  ret_iva_amount  numeric(18,2) NOT NULL DEFAULT 0,
  ret_isr_amount  numeric(18,2) NOT NULL DEFAULT 0,
  total           numeric(18,2) NOT NULL DEFAULT 0,
  unit_cost       numeric(18,6)
);

CREATE TABLE supplier_invoices (
  id               serial PRIMARY KEY,
  third_party_id   int NOT NULL REFERENCES third_parties(id),
  warehouse_id     int REFERENCES warehouses(id),
  supplier_ref     text,
  -- UUID of the CFDI received from the supplier (needed for IVA acreditable).
  uuid             text,
  issue_date       date NOT NULL DEFAULT current_date,
  metodo_pago      text NOT NULL DEFAULT 'PUE' CHECK (metodo_pago IN ('PUE', 'PPD')),
  subtotal         numeric(18,2) NOT NULL DEFAULT 0,
  discount         numeric(18,2) NOT NULL DEFAULT 0,
  iva              numeric(18,2) NOT NULL DEFAULT 0,
  ret_iva          numeric(18,2) NOT NULL DEFAULT 0,
  ret_isr          numeric(18,2) NOT NULL DEFAULT 0,
  total            numeric(18,2) NOT NULL DEFAULT 0,
  paid_amount      numeric(18,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'cancelled')),
  journal_entry_id int REFERENCES journal_entries(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE supplier_invoice_lines (
  id           serial PRIMARY KEY,
  invoice_id   int NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  line_no      int NOT NULL,
  -- Either a stocked product or an expense account.
  product_id   int REFERENCES products(id),
  account_id   int REFERENCES accounts(id),
  description  text NOT NULL,
  qty          numeric(18,6) NOT NULL CHECK (qty > 0),
  unit_price   numeric(18,6) NOT NULL CHECK (unit_price >= 0),
  discount     numeric(18,2) NOT NULL DEFAULT 0,
  iva_rate     numeric(8,6) NOT NULL DEFAULT 0.16,
  ret_iva_rate numeric(8,6) NOT NULL DEFAULT 0,
  ret_isr_rate numeric(8,6) NOT NULL DEFAULT 0,
  base         numeric(18,2) NOT NULL DEFAULT 0,
  iva_amount   numeric(18,2) NOT NULL DEFAULT 0,
  ret_iva_amount numeric(18,2) NOT NULL DEFAULT 0,
  ret_isr_amount numeric(18,2) NOT NULL DEFAULT 0,
  total        numeric(18,2) NOT NULL DEFAULT 0,
  CHECK (product_id IS NOT NULL OR account_id IS NOT NULL)
);

CREATE TABLE payments (
  id               serial PRIMARY KEY,
  direction        text NOT NULL CHECK (direction IN ('in', 'out')),
  third_party_id   int NOT NULL REFERENCES third_parties(id),
  bank_account_id  int NOT NULL REFERENCES bank_accounts(id),
  paid_on          date NOT NULL DEFAULT current_date,
  amount           numeric(18,2) NOT NULL CHECK (amount > 0),
  forma_pago       text NOT NULL DEFAULT '03',
  sales_invoice_id    int REFERENCES sales_invoices(id),
  supplier_invoice_id int REFERENCES supplier_invoices(id),
  reference        text,
  journal_entry_id int REFERENCES journal_entries(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((direction = 'in' AND sales_invoice_id IS NOT NULL) OR (direction = 'out' AND supplier_invoice_id IS NOT NULL))
);
