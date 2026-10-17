import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "@erp/db";
import type { Role } from "./permissions.js";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

const SESSION_DAYS = 30;
export const hashToken = (token: string) => createHash("sha256").update(token).digest();

/** Create a session and return its bearer token (only its hash is stored). */
export async function createSession(sql: Sql, userId: number, userAgent?: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const [row] = await sql<{ expires_at: string }[]>`
    INSERT INTO user_sessions (token_hash, user_id, expires_at, user_agent)
    VALUES (${hashToken(token)}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}), ${userAgent?.slice(0, 300) ?? null})
    RETURNING expires_at`;
  return { token, expiresAt: row!.expires_at };
}

/** Look up the active user behind a bearer token and refresh its last use. */
export async function userForToken(sql: Sql, token: string): Promise<SessionUser | undefined> {
  const [row] = await sql<SessionUser[]>`
    UPDATE user_sessions s SET last_seen_at = now()
    FROM users u
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now() AND u.id = s.user_id AND u.active
    RETURNING u.id, u.email, u.name, u.role`;
  return row;
}

export async function deleteSession(sql: Sql, token: string): Promise<void> {
  await sql`DELETE FROM user_sessions WHERE token_hash = ${hashToken(token)}`;
}
