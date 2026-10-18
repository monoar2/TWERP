-- AI features: document intake, actions proposed by the assistant, pinned
-- dashboard widgets, the auditor and the SAT 69-B list it checks against.

-- A received CFDI (or PDF / photo of a ticket) read by the intake and the
-- supplier invoice it became.
CREATE TABLE document_intakes (
  id                  serial PRIMARY KEY,
  file_name           text NOT NULL,
  media_type          text NOT NULL,
  -- cfdi_xml: parsed exactly; pdf / image: read by Claude.
  source              text NOT NULL CHECK (source IN ('cfdi_xml', 'pdf', 'image')),
  content             bytea NOT NULL,
  status              text NOT NULL DEFAULT 'extracted' CHECK (status IN ('extracted', 'posted', 'discarded')),
  extracted           jsonb NOT NULL,
  suggestion          jsonb NOT NULL,
  warnings            jsonb NOT NULL DEFAULT '[]',
  model               text,
  supplier_invoice_id int REFERENCES supplier_invoices(id),
  created_by          int REFERENCES users ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_intakes_created_idx ON document_intakes (created_at DESC);

-- A CFDI received from a supplier can only be registered once.
CREATE UNIQUE INDEX supplier_invoices_uuid_key ON supplier_invoices (upper(uuid)) WHERE uuid IS NOT NULL AND status <> 'cancelled';

-- Writes the assistant drafted; nothing changes until a user applies one.
CREATE TABLE ai_proposals (
  id          serial PRIMARY KEY,
  user_id     int REFERENCES users ON DELETE SET NULL,
  kind        text NOT NULL,
  summary     text NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
  result      jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  decided_by  int REFERENCES users ON DELETE SET NULL
);
CREATE INDEX ai_proposals_user_idx ON ai_proposals (user_id, created_at DESC);

-- AI answers pinned to a user's dashboard; the SQL re-runs on each view.
CREATE TABLE ai_widgets (
  id          serial PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users ON DELETE CASCADE,
  title       text NOT NULL,
  question    text,
  sql         text NOT NULL,
  chart       jsonb NOT NULL,
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_widgets_user_idx ON ai_widgets (user_id, position);

-- SAT list of taxpayers presumed to issue simulated invoices (artículo 69-B CFF).
CREATE TABLE sat_69b (
  rfc        text PRIMARY KEY,
  name       text NOT NULL,
  situacion  text NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_runs (
  id          serial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  trigger     text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule')),
  findings    int NOT NULL DEFAULT 0,
  new_findings int NOT NULL DEFAULT 0,
  summary     text,
  model       text,
  error       text
);

-- One row per distinct problem; the fingerprint keeps re-runs from duplicating it.
CREATE TABLE audit_findings (
  id           serial PRIMARY KEY,
  fingerprint  text NOT NULL UNIQUE,
  check_code   text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  title        text NOT NULL,
  detail       text NOT NULL,
  evidence     jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'resolved')),
  first_run_id int REFERENCES audit_runs(id),
  last_run_id  int REFERENCES audit_runs(id),
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  dismissed_by int REFERENCES users ON DELETE SET NULL,
  note         text
);
CREATE INDEX audit_findings_status_idx ON audit_findings (status, severity);

CREATE VIEW ai.audit_findings AS
SELECT id, check_code, severity, title, detail, evidence, status, first_seen, last_seen FROM audit_findings;
COMMENT ON VIEW ai.audit_findings IS 'Hallazgos del auditor automático (facturas duplicadas, proveedores en lista 69-B del SAT, ventas bajo costo, existencias negativas, cobranza vencida, pólizas en borrador). status: open, dismissed, resolved.';

CREATE VIEW ai.sat_69b AS SELECT rfc, name, situacion FROM sat_69b;
COMMENT ON VIEW ai.sat_69b IS 'Lista del SAT de contribuyentes que facturan operaciones simuladas (69-B). situacion: Definitivo, Presunto, Desvirtuado, Sentencia Favorable.';

GRANT SELECT ON ai.audit_findings, ai.sat_69b TO erp_ai_reader;
