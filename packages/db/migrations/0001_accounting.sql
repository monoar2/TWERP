-- Core company data and double-entry accounting aligned with the SAT
-- electronic accounting rules (Anexo 24 RMF, código agrupador).

CREATE TABLE company (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rfc           text NOT NULL,
  razon_social  text NOT NULL,
  regimen_fiscal text NOT NULL,
  codigo_postal text NOT NULL CHECK (codigo_postal ~ '^\d{5}$'),
  invoice_serie text NOT NULL DEFAULT 'A',
  allow_negative_stock boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sat_codigo_agrupador (
  code        text PRIMARY KEY,
  description text NOT NULL,
  level       smallint NOT NULL,
  nature      char(1) NOT NULL CHECK (nature IN ('D', 'A'))
);

-- Optional full SAT catalogs, loaded from the official spreadsheet.
CREATE TABLE sat_clave_prod_serv (code text PRIMARY KEY, description text NOT NULL);
CREATE TABLE sat_clave_unidad (code text PRIMARY KEY, name text NOT NULL);

CREATE TYPE account_kind AS ENUM ('asset', 'liability', 'equity', 'income', 'cost', 'expense', 'memo');

CREATE TABLE accounts (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  parent_id  int REFERENCES accounts(id),
  level      smallint NOT NULL DEFAULT 1,
  nature     char(1) NOT NULL CHECK (nature IN ('D', 'A')),
  kind       account_kind NOT NULL,
  sat_code   text NOT NULL REFERENCES sat_codigo_agrupador(code),
  -- Only leaf accounts receive journal lines; parents aggregate.
  postable   boolean NOT NULL DEFAULT true,
  active     boolean NOT NULL DEFAULT true
);

-- Default account per purpose (like Dolibarr's accounting setup): the
-- posting engine looks accounts up by key, so the chart stays editable.
CREATE TABLE account_settings (
  key        text PRIMARY KEY,
  account_id int NOT NULL REFERENCES accounts(id),
  description text NOT NULL
);

-- Journals group entries by origin (Dolibarr: VT, AC, BQ, OD). sat_type maps
-- them to SAT póliza types: I ingreso, E egreso, D diario.
CREATE TABLE journals (
  code      text PRIMARY KEY,
  name      text NOT NULL,
  sat_type  char(1) NOT NULL CHECK (sat_type IN ('I', 'E', 'D'))
);

CREATE TABLE fiscal_periods (
  year   int NOT NULL,
  month  int NOT NULL CHECK (month BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  PRIMARY KEY (year, month)
);

CREATE TABLE journal_entries (
  id           serial PRIMARY KEY,
  journal_code text NOT NULL REFERENCES journals(code),
  number       int,
  entry_date   date NOT NULL,
  concept      text NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  source_type  text,
  source_id    int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  posted_at    timestamptz,
  UNIQUE (journal_code, number)
);
CREATE INDEX journal_entries_date_idx ON journal_entries (entry_date);
CREATE INDEX journal_entries_source_idx ON journal_entries (source_type, source_id);

CREATE TABLE journal_lines (
  id          serial PRIMARY KEY,
  entry_id    int NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no     int NOT NULL,
  account_id  int NOT NULL REFERENCES accounts(id),
  debit       numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text,
  -- CFDI backing this line (required by SAT when the operation has one).
  cfdi_uuid   text,
  rfc         text,
  cfdi_total  numeric(18,2),
  CHECK (NOT (debit > 0 AND credit > 0)),
  CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX journal_lines_account_idx ON journal_lines (account_id);

-- Posted entries are immutable, must balance, must hit postable accounts and
-- must fall in an open period.
CREATE FUNCTION check_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  d numeric; c numeric; n int; bad int; period_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
    RAISE EXCEPTION 'La póliza % ya está contabilizada y no puede modificarse', OLD.id;
  END IF;
  IF NEW.status = 'posted' THEN
    SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) INTO d, c, n
      FROM journal_lines WHERE entry_id = NEW.id;
    IF n < 2 THEN RAISE EXCEPTION 'La póliza % requiere al menos dos movimientos', NEW.id; END IF;
    IF d <> c THEN RAISE EXCEPTION 'La póliza % no cuadra: cargos % abonos %', NEW.id, d, c; END IF;
    SELECT count(*) INTO bad FROM journal_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.entry_id = NEW.id AND NOT a.postable;
    IF bad > 0 THEN RAISE EXCEPTION 'La póliza % usa cuentas acumulativas', NEW.id; END IF;
    SELECT status INTO period_status FROM fiscal_periods
      WHERE year = extract(year FROM NEW.entry_date) AND month = extract(month FROM NEW.entry_date);
    IF period_status = 'closed' THEN RAISE EXCEPTION 'El periodo de la póliza % está cerrado', NEW.id; END IF;
    IF NEW.posted_at IS NULL THEN NEW.posted_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER journal_entries_check BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION check_journal_entry();

CREATE FUNCTION protect_posted_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM journal_entries WHERE id = coalesce(NEW.entry_id, OLD.entry_id);
  IF s = 'posted' THEN RAISE EXCEPTION 'No se pueden modificar movimientos de una póliza contabilizada'; END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE TRIGGER journal_lines_protect BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION protect_posted_lines();

CREATE TABLE sequences (
  name text PRIMARY KEY,
  next_value int NOT NULL DEFAULT 1
);
