"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { useEffect, useState, type ReactNode } from "react";

interface NavItem { href: string; label: string; icon: string; match: string[]; children?: Array<{ href: string; label: string }> }

export const NAV: NavItem[] = [
  { href: "/", label: "Inicio", icon: "home", match: ["/"] },
  { href: "/third-parties/", label: "Terceros", icon: "users", match: ["/third-parties"] },
  { href: "/products/", label: "Productos", icon: "box", match: ["/products"] },
  {
    href: "/inventory/", label: "Inventario", icon: "warehouse", match: ["/inventory"],
    children: [
      { href: "/inventory/", label: "Existencias" },
      { href: "/inventory/movements/", label: "Kárdex" },
      { href: "/inventory/adjust/", label: "Ajustes y traspasos" },
      { href: "/inventory/counts/", label: "Inventario físico" },
    ],
  },
  {
    href: "/invoices/", label: "Facturación", icon: "invoice", match: ["/invoices"],
    children: [
      { href: "/invoices/", label: "Facturas" },
      { href: "/invoices/new/", label: "Nueva factura" },
    ],
  },
  {
    href: "/purchases/", label: "Compras", icon: "cart", match: ["/purchases"],
    children: [
      { href: "/purchases/", label: "Facturas de proveedor" },
      { href: "/purchases/new/", label: "Nueva compra" },
    ],
  },
  {
    href: "/accounting/", label: "Contabilidad", icon: "book", match: ["/accounting"],
    children: [
      { href: "/accounting/", label: "Catálogo de cuentas" },
      { href: "/accounting/entries/", label: "Pólizas" },
      { href: "/accounting/trial-balance/", label: "Balanza" },
      { href: "/accounting/ledger/", label: "Auxiliar" },
      { href: "/accounting/income-statement/", label: "Estado de resultados" },
    ],
  },
  {
    href: "/taxes/", label: "Impuestos", icon: "bank", match: ["/taxes"],
    children: [
      { href: "/taxes/", label: "IVA mensual" },
      { href: "/taxes/sat-export/", label: "Contabilidad electrónica" },
    ],
  },
  { href: "/ai/", label: "Pregúntale a la IA", icon: "sparkles", match: ["/ai"] },
  { href: "/settings/", label: "Configuración", icon: "settings", match: ["/settings"] },
];

const norm = (p: string) => p.replace(/\/$/, "") || "/";

function isActive(item: NavItem, pathname: string) {
  const p = norm(pathname);
  return item.match.some((m) => (m === "/" ? p === "/" : p === m || p.startsWith(`${m}/`)));
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand"><span className="brand-mark">E</span> ERP</Link>
        <button className="btn btn-ghost menu-toggle" aria-expanded={open} aria-label="Menú" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "close" : "menu"} /> Menú
        </button>
      </header>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link href="/" className="brand brand-side"><span className="brand-mark">E</span> ERP <small>México</small></Link>
        <nav>
          {NAV.map((item) => {
            const active = isActive(item, pathname);
            return (
              <div key={item.href} className={`nav-group ${active ? "active" : ""}`}>
                <Link href={item.href} className="nav-item">
                  <span className="nav-icon"><Icon name={item.icon} /></span>
                  {item.label}
                </Link>
                {active && item.children ? (
                  <div className="nav-children">
                    {item.children.map((c) => (
                      <Link key={c.href} href={c.href} className={norm(pathname) === norm(c.href) ? "current" : ""}>
                        {c.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
