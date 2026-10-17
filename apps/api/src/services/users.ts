import type { Db } from "@erp/db";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../auth/password.js";
import type { Role } from "../auth/permissions.js";
import { badRequest, conflict, notFound } from "../errors.js";

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
}

const COLUMNS = "id, email, name, role, active, last_login_at, created_at";

export function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw badRequest(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
}

export async function listUsers(tx: Db): Promise<UserRow[]> {
  return tx.unsafe<UserRow[]>(`SELECT ${COLUMNS} FROM users ORDER BY lower(email)`);
}

export async function createUser(tx: Db, u: { email: string; name: string; role: Role; password: string }): Promise<UserRow> {
  checkPassword(u.password);
  const [existing] = await tx`SELECT 1 FROM users WHERE lower(email) = lower(${u.email})`;
  if (existing) throw conflict("Ya existe un usuario con ese correo");
  const [row] = await tx.unsafe<UserRow[]>(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [u.email.trim(), u.name.trim(), u.role, await hashPassword(u.password)],
  );
  return row!;
}

/** Update a user. Deactivating or changing the password ends their sessions. */
export async function updateUser(
  tx: Db, id: number, u: { name?: string; role?: Role; active?: boolean; password?: string },
): Promise<UserRow> {
  const [current] = await tx<{ role: Role; active: boolean }[]>`SELECT role, active FROM users WHERE id = ${id} FOR UPDATE`;
  if (!current) throw notFound("Usuario");
  const losesAdmin = current.role === "admin" && current.active && ((u.role && u.role !== "admin") || u.active === false);
  if (losesAdmin) {
    const [others] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> ${id}`;
    if (!others?.n) throw conflict("Debe quedar al menos un administrador activo");
  }
  if (u.password !== undefined) checkPassword(u.password);
  const hash = u.password !== undefined ? await hashPassword(u.password) : null;
  const [row] = await tx.unsafe<UserRow[]>(
    `UPDATE users SET name = coalesce($2, name), role = coalesce($3::user_role, role), active = coalesce($4, active),
       password_hash = coalesce($5, password_hash), failed_logins = CASE WHEN $5 IS NULL THEN failed_logins ELSE 0 END,
       locked_until = CASE WHEN $5 IS NULL THEN locked_until END
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, u.name?.trim() ?? null, u.role ?? null, u.active ?? null, hash],
  );
  if (u.active === false || hash) await tx`DELETE FROM user_sessions WHERE user_id = ${id}`;
  return row!;
}
