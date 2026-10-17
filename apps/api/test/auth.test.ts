import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, callAs, createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv;
const login = (email: string, password: string) =>
  env.app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });

beforeAll(async () => {
  env = await createTestEnv();
  await call(env.app, "POST", "/users", { email: "ventas@test.mx", name: "Vendedora", role: "ventas", password: "ventas-1234" });
  await call(env.app, "POST", "/users", { email: "lectura@test.mx", name: "Auditor", role: "consulta", password: "consulta-1234" });
}, 60_000);

afterAll(async () => env?.close());

describe("login", () => {
  it("requires a session on every route except health and login", async () => {
    expect((await env.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await env.app.inject({ method: "GET", url: "/products" })).statusCode).toBe(401);
    expect((await env.app.inject({ method: "GET", url: "/products", headers: { authorization: "Bearer inventado" } })).statusCode).toBe(401);
  });

  it("signs in with email and password and signs out", async () => {
    const res = await login("VENTAS@test.mx", "ventas-1234");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ email: "ventas@test.mx", role: "ventas" });
    expect(body.permissions.write).toContain("sales");
    const me = await callAs(env.app, body.token, "GET", "/auth/me");
    expect(me.user.name).toBe("Vendedora");
    await callAs(env.app, body.token, "POST", "/auth/logout");
    await callAs(env.app, body.token, "GET", "/auth/me", undefined, [401]);
  });

  it("gives the same answer for a wrong password and an unknown email, and locks after 5 failures", async () => {
    const wrong = await login("lectura@test.mx", "incorrecta");
    const unknown = await login("nadie@test.mx", "incorrecta");
    expect([wrong.statusCode, unknown.statusCode]).toEqual([401, 401]);
    expect(wrong.json().error).toBe(unknown.json().error);
    for (let i = 0; i < 4; i++) await login("lectura@test.mx", "incorrecta");
    expect((await login("lectura@test.mx", "consulta-1234")).statusCode).toBe(429);
    // An administrator resetting the password unlocks the account.
    const [u] = await env.sql`SELECT id FROM users WHERE email = 'lectura@test.mx'`;
    await call(env.app, "PATCH", `/users/${u!.id}`, { password: "consulta-5678" });
    expect((await login("lectura@test.mx", "consulta-5678")).statusCode).toBe(200);
  });
});

describe("roles", () => {
  it("lets each role do only its own work", async () => {
    const ventas = (await login("ventas@test.mx", "ventas-1234")).json().token;
    const consulta = (await login("lectura@test.mx", "consulta-5678")).json().token;
    await callAs(env.app, ventas, "GET", "/products");
    await callAs(env.app, ventas, "GET", "/journal-entries", undefined, [403]);
    await callAs(env.app, ventas, "POST", "/warehouses", { code: "X", name: "X" }, [403]);
    await callAs(env.app, ventas, "GET", "/users", undefined, [403]);
    await callAs(env.app, consulta, "GET", "/journal-entries");
    await callAs(env.app, consulta, "POST", "/third-parties", { name: "X" }, [403]);
    await callAs(env.app, consulta, "PUT", "/company/csd", { cer: "AA==", key: "AA==", password: "x" }, [403]);
  });

  it("records who made each write", async () => {
    await call(env.app, "POST", "/warehouses", { code: "AUD", name: "Auditoría" });
    const [row] = await env.sql`SELECT u.email, a.method, a.path, a.status FROM audit_log a JOIN users u ON u.id = a.user_id
                                WHERE a.path = '/warehouses' ORDER BY a.id DESC LIMIT 1`;
    expect(row).toMatchObject({ email: "admin@test.mx", method: "POST", status: 201 });
  });

  it("keeps at least one active administrator", async () => {
    const [admin] = await env.sql`SELECT id FROM users WHERE email = 'admin@test.mx'`;
    await call(env.app, "PATCH", `/users/${admin!.id}`, { role: "contador" }, [409]);
  });
});

describe("passwords", () => {
  it("changes the password and signs out the other devices", async () => {
    const first = (await login("ventas@test.mx", "ventas-1234")).json().token;
    const second = (await login("ventas@test.mx", "ventas-1234")).json().token;
    await callAs(env.app, first, "POST", "/auth/password", { currentPassword: "ventas-1234", newPassword: "corta" }, [400]);
    await callAs(env.app, first, "POST", "/auth/password", { currentPassword: "ventas-1234", newPassword: "nueva-clave-segura" });
    await callAs(env.app, first, "GET", "/auth/me");
    await callAs(env.app, second, "GET", "/auth/me", undefined, [401]);
    expect((await login("ventas@test.mx", "nueva-clave-segura")).statusCode).toBe(200);
  });
});
