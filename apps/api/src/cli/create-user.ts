import { randomBytes } from "node:crypto";
import { createDb } from "@erp/db";
import { ROLES, type Role } from "../auth/permissions.js";
import { createUser } from "../services/users.js";

/**
 * Create a user, typically the first administrator:
 *   pnpm --filter @erp/api user:create admin@empresa.mx "Nombre Apellido" [rol]
 * Uses ERP_USER_PASSWORD if set, otherwise generates a password and prints it.
 */
const [email, name, role = "admin"] = process.argv.slice(2);
if (!email || !name || !ROLES.includes(role as Role)) {
  console.error(`Uso: user:create <correo> <nombre> [${ROLES.join("|")}]`);
  process.exit(1);
}
const password = process.env.ERP_USER_PASSWORD || randomBytes(9).toString("base64url");
const sql = createDb();
try {
  const user = await sql.begin((tx) => createUser(tx, { email, name, role: role as Role, password }));
  console.log(`Usuario ${user.email} (${user.role}) creado.`);
  if (!process.env.ERP_USER_PASSWORD) console.log(`Contraseña: ${password}\nCámbiala después de iniciar sesión.`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
