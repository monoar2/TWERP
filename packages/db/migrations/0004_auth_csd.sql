-- Users, roles and sessions; the company's CSD for sealing CFDIs; audit trail.

CREATE TYPE user_role AS ENUM ('admin', 'contador', 'ventas', 'almacen', 'consulta');

CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  role          user_role NOT NULL,
  -- scrypt$N$r$p$salt$hash (base64); see apps/api/src/auth/password.ts
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Only a SHA-256 of each bearer token is stored.
CREATE TABLE user_sessions (
  token_hash   bytea PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text
);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);

-- Every write request, who made it and how it ended.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    integer REFERENCES users ON DELETE SET NULL,
  method     text NOT NULL,
  path       text NOT NULL,
  status     smallint NOT NULL,
  ip         text
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- Certificado de Sello Digital. The private key and its password are stored
-- encrypted with AES-256-GCM under ERP_SECRET_KEY; only one CSD is active.
CREATE TABLE company_csd (
  id              serial PRIMARY KEY,
  rfc             text NOT NULL,
  no_certificado  text NOT NULL UNIQUE,
  certificate     bytea NOT NULL,
  key_encrypted   bytea NOT NULL,
  password_encrypted bytea NOT NULL,
  valid_from      timestamptz NOT NULL,
  valid_to        timestamptz NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  uploaded_by     integer REFERENCES users ON DELETE SET NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX company_csd_one_active ON company_csd (active) WHERE active;

ALTER TABLE sales_invoices ADD COLUMN cancel_acuse text;
