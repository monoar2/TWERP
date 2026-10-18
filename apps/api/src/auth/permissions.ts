export const ROLES = ["admin", "contador", "ventas", "almacen", "consulta"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  contador: "Contador",
  ventas: "Ventas",
  almacen: "Almacén",
  consulta: "Sólo consulta",
};

type Area = "accounting" | "sales" | "purchases" | "parties" | "inventory" | "products" | "banks" | "company" | "users" | "ai" | "common";

/** Which area each API path belongs to; first matching prefix wins. */
const AREAS: Array<[string, Area]> = [
  ["/users", "users"],
  ["/company", "company"],
  ["/bank-accounts", "banks"],
  ["/sales-invoices", "sales"],
  ["/supplier-invoices", "purchases"],
  ["/intake", "purchases"],
  ["/third-parties", "parties"],
  ["/stock", "inventory"],
  ["/inventory-counts", "inventory"],
  ["/warehouses", "inventory"],
  ["/products", "products"],
  ["/accounts", "accounting"],
  ["/account-settings", "accounting"],
  ["/journal-entries", "accounting"],
  ["/reports", "accounting"],
  ["/periods", "accounting"],
  ["/sat/electronic-accounting", "accounting"],
  ["/audit", "accounting"],
  ["/ai", "ai"],
  ["/mcp", "ai"],
  ["/sat", "common"],
  ["/dashboard", "common"],
];

const ALL: Area[] = ["accounting", "sales", "purchases", "parties", "inventory", "products", "banks", "company", "ai", "common"];

/** Areas each role may read and write. Admin can do everything, including managing users. */
const GRANTS: Record<Role, { read: Area[]; write: Area[] }> = {
  admin: { read: [...ALL, "users"], write: [...ALL, "users"] },
  contador: { read: ALL, write: ["accounting", "sales", "purchases", "parties", "banks", "products"] },
  ventas: { read: ["sales", "parties", "products", "inventory", "common", "banks"], write: ["sales", "parties"] },
  almacen: { read: ["inventory", "products", "purchases", "parties", "common"], write: ["inventory", "products", "purchases"] },
  consulta: { read: ALL, write: [] },
};

export function areaOf(path: string): Area | undefined {
  const p = path.split("?")[0]!;
  return AREAS.find(([prefix]) => p === prefix || p.startsWith(`${prefix}/`))?.[1];
}

/** AI questions only read, so any role allowed to read the area may ask. */
export function can(role: Role, method: string, path: string): boolean {
  const area = areaOf(path);
  if (!area) return role === "admin";
  const write = !(method === "GET" || method === "HEAD") && area !== "ai";
  return (write ? GRANTS[role].write : GRANTS[role].read).includes(area);
}

/** Areas the role can open, for the apps to hide what the user can't use. */
export function permissionsOf(role: Role): { read: Area[]; write: Area[] } {
  return GRANTS[role];
}
