import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../auth/password.js";
import { permissionsOf, ROLE_LABELS, ROLES, type Role } from "../auth/permissions.js";
import { createSession, deleteSession, hashToken, type SessionUser } from "../auth/sessions.js";
import type { AppContext } from "../context.js";
import { AppError } from "../errors.js";
import { saveCsd, csdInfo } from "../services/csd.js";
import { checkPassword, createUser, listUsers, updateUser } from "../services/users.js";
import { idParam, parse } from "../validate.js";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

const role = z.enum(ROLES);
const bearer = (header?: string) => /^Bearer (.+)$/i.exec(header ?? "")?.[1];
const profile = (u: SessionUser) => ({ user: u, roleLabel: ROLE_LABELS[u.role], permissions: permissionsOf(u.role) });

/** Login, sessions, user management and the company's CSD. */
export async function authRoutes(app: FastifyInstance, { sql, secretKey }: AppContext) {
  app.post("/auth/login", async (req) => {
    const b = parse(z.object({ email: z.string().min(1), password: z.string().min(1) }), req.body);
    const [u] = await sql<(SessionUser & { password_hash: string; active: boolean; locked: boolean })[]>`
      SELECT id, email, name, role, password_hash, active, coalesce(locked_until > now(), false) AS locked
      FROM users WHERE lower(email) = lower(${b.email.trim()})`;
    // Verify against a dummy hash for unknown users so timing doesn't reveal which emails exist.
    const ok = await verifyPassword(b.password, u?.password_hash ?? DUMMY_HASH);
    if (u?.locked) throw new AppError(429, `Demasiados intentos fallidos; espera ${LOCK_MINUTES} minutos o pide a un administrador que cambie tu contraseña`);
    if (!u || !ok || !u.active) {
      if (u) {
        await sql`UPDATE users SET failed_logins = failed_logins + 1,
                  locked_until = CASE WHEN failed_logins + 1 >= ${MAX_FAILED_LOGINS} THEN now() + make_interval(mins => ${LOCK_MINUTES}) END
                  WHERE id = ${u.id}`;
      }
      throw new AppError(401, "Correo o contraseña incorrectos");
    }
    await sql`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = ${u.id}`;
    const session = await createSession(sql, u.id, req.headers["user-agent"]);
    const user: SessionUser = { id: u.id, email: u.email, name: u.name, role: u.role };
    req.user = user;
    return { token: session.token, expiresAt: session.expiresAt, ...profile(user) };
  });

  app.post("/auth/logout", async (req) => {
    const token = bearer(req.headers.authorization);
    if (token) await deleteSession(sql, token);
    return { ok: true };
  });

  app.get("/auth/me", async (req) => profile(req.user!));

  app.post("/auth/password", async (req) => {
    const b = parse(z.object({ currentPassword: z.string(), newPassword: z.string() }), req.body);
    const [u] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${req.user!.id}`;
    if (!u || !(await verifyPassword(b.currentPassword, u.password_hash))) throw new AppError(400, "La contraseña actual no es correcta");
    checkPassword(b.newPassword);
    await sql.begin(async (tx) => {
      await tx`UPDATE users SET password_hash = ${await hashPassword(b.newPassword)} WHERE id = ${req.user!.id}`;
      // Sign out every other device.
      await tx`DELETE FROM user_sessions WHERE user_id = ${req.user!.id} AND token_hash <> ${hashToken(bearer(req.headers.authorization) ?? "")}`;
    });
    return { ok: true };
  });

  app.get("/users/roles", async () => ROLES.map((r: Role) => ({ code: r, label: ROLE_LABELS[r], permissions: permissionsOf(r) })));
  app.get("/users", async () => listUsers(sql));
  app.post("/users", async (req, reply) => {
    const b = parse(z.object({ email: z.email(), name: z.string().min(1), role, password: z.string() }), req.body);
    return reply.code(201).send(await sql.begin((tx) => createUser(tx, b)));
  });
  app.patch("/users/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ name: z.string().min(1).optional(), role: role.optional(), active: z.boolean().optional(), password: z.string().optional() }), req.body);
    if (id === req.user!.id && (b.active === false || (b.role && b.role !== "admin")))
      throw new AppError(409, "No puedes desactivar ni quitarte el rol de administrador a ti mismo");
    return sql.begin((tx) => updateUser(tx, id, b));
  });

  app.get("/company/csd", async () => csdInfo(sql));
  app.put("/company/csd", async (req) => {
    const b64 = z.string().min(1).transform((s) => Buffer.from(s.replace(/^data:[^,]*,/, ""), "base64"));
    const b = parse(z.object({ cer: b64, key: b64, password: z.string().min(1) }), req.body);
    return sql.begin((tx) => saveCsd(tx, secretKey, b, req.user?.id));
  });
}
