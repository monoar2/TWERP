"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { canAccess, type Area, type AuthProfile } from "@erp/client";
import { Icon } from "./Icon";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, loadSession, loginHref, logout, onSessionChange, updateProfile, type Session } from "@/lib/api";

interface NavChild { href: string; label: string; area?: Area }
interface NavItem { href: string; label: string; icon: string; match: string[]; area: Area; children?: NavChild[] }

export const NAV: NavItem[] = [
  { href: "/", label: "Inicio", icon: "home", match: ["/"], area: "common" },
  { href: "/third-parties/", label: "Terceros", icon: "users", match: ["/third-parties"], area: "parties" },
  { href: "/products/", label: "Productos", icon: "box", match: ["/products"], area: "products" },
  {
    href: "/inventory/", label: "Inventario", icon: "warehouse", match: ["/inventory"], area: "inventory",
    children: [
      { href: "/inventory/", label: "Existencias" },
      { href: "/inventory/movements/", label: "Kárdex" },
      { href: "/inventory/adjust/", label: "Ajustes y traspasos" },
      { href: "/inventory/counts/", label: "Inventario físico" },
    ],
  },
  {
    href: "/invoices/", label: "Facturación", icon: "invoice", match: ["/invoices"], area: "sales",
    children: [
      { href: "/invoices/", label: "Facturas" },
      { href: "/invoices/new/", label: "Nueva factura" },
    ],
  },
  {
    href: "/purchases/", label: "Compras", icon: "cart", match: ["/purchases"], area: "purchases",
    children: [
      { href: "/purchases/", label: "Facturas de proveedor" },
      { href: "/purchases/new/", label: "Nueva compra" },
      { href: "/purchases/intake/", label: "Subir factura (IA)" },
    ],
  },
  {
    href: "/accounting/", label: "Contabilidad", icon: "book", match: ["/accounting"], area: "accounting",
    children: [
      { href: "/accounting/", label: "Catálogo de cuentas" },
      { href: "/accounting/entries/", label: "Pólizas" },
      { href: "/accounting/trial-balance/", label: "Balanza" },
      { href: "/accounting/ledger/", label: "Auxiliar" },
      { href: "/accounting/income-statement/", label: "Estado de resultados" },
    ],
  },
  {
    href: "/taxes/", label: "Impuestos", icon: "bank", match: ["/taxes"], area: "accounting",
    children: [
      { href: "/taxes/", label: "IVA mensual" },
      { href: "/taxes/sat-export/", label: "Contabilidad electrónica" },
    ],
  },
  { href: "/audit/", label: "Auditor", icon: "shield", match: ["/audit"], area: "accounting" },
  { href: "/ai/", label: "Pregúntale a la IA", icon: "sparkles", match: ["/ai"], area: "ai" },
  {
    href: "/settings/", label: "Configuración", icon: "settings", match: ["/settings"], area: "common",
    children: [
      { href: "/settings/", label: "General" },
      { href: "/settings/users/", label: "Usuarios", area: "users" },
    ],
  },
];

const norm = (p: string) => p.replace(/\/$/, "") || "/";

function isActive(item: NavItem, pathname: string) {
  const p = norm(pathname);
  return item.match.some((m) => (m === "/" ? p === "/" : p === m || p.startsWith(`${m}/`)));
}

const SessionContext = createContext<AuthProfile | null>(null);

/** The signed-in user's profile (role and permissions). Only null on the login page. */
export function useProfile(): AuthProfile | null {
  return useContext(SessionContext);
}

function routeItem(pathname: string): NavItem | undefined {
  return NAV.find((item) => item.href !== "/" && isActive(item, pathname)) ?? (norm(pathname) === "/" ? NAV[0] : undefined);
}

function routeArea(pathname: string): Area | undefined {
  const item = routeItem(pathname);
  const child = item?.children?.find((c) => norm(c.href) === norm(pathname));
  return child?.area ?? item?.area;
}

/** App frame plus the auth gate: every page but /login/ needs a session. */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isLogin = norm(pathname) === "/login";
  if (isLogin) return <>{children}</>;
  return <AuthedShell pathname={pathname}>{children}</AuthedShell>;
}

function AuthedShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // undefined = not read yet (first render, also during static prerender); null = signed out.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);
  const signingOut = useRef(false);
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    setSession(loadSession());
    const off = onSessionChange(setSession);
    // Role or permissions may have changed since login: refresh the profile. A 401 clears the session via onUnauthorized.
    if (loadSession()) api().me().then(updateProfile).catch(() => { /* offline: keep the stored profile */ });
    // Logging in or out in another tab of the same app.
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === "erp.session") setSession(loadSession()); };
    window.addEventListener("storage", onStorage);
    return () => { off(); window.removeEventListener("storage", onStorage); };
  }, []);

  useEffect(() => {
    // After "Cerrar sesión" go to a plain /login/; otherwise (expired, signed out in another tab) come back here afterwards.
    if (session === null) router.replace(signingOut.current ? "/login/" : loginHref());
  }, [session, router]);

  if (!session) {
    return <div className="auth-wait"><span className="spinner" /></div>;
  }

  const profile = session.profile;
  const area = routeArea(pathname);
  const allowed = !area || canAccess(profile, area);
  const nav = NAV.filter((item) => canAccess(profile, item.area));

  async function signOut() {
    setLoggingOut(true);
    signingOut.current = true;
    await logout();
  }

  return (
    <SessionContext.Provider value={profile}>
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
            {nav.map((item) => {
              const active = isActive(item, pathname);
              const kids = item.children?.filter((c) => !c.area || canAccess(profile, c.area));
              return (
                <div key={item.href} className={`nav-group ${active ? "active" : ""}`}>
                  <Link href={item.href} className="nav-item">
                    <span className="nav-icon"><Icon name={item.icon} /></span>
                    {item.label}
                  </Link>
                  {active && kids && kids.length > 1 ? (
                    <div className="nav-children">
                      {kids.map((c) => (
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
          <div className="user-box">
            <div className="user-name" title={profile.user.email}>{profile.user.name}</div>
            <div className="user-role">{profile.roleLabel}</div>
            <button className="nav-item user-logout" onClick={signOut} disabled={loggingOut}>
              <span className="nav-icon"><Icon name="logout" /></span>
              {loggingOut ? "Cerrando…" : "Cerrar sesión"}
            </button>
          </div>
        </aside>
        <main className="content">
          {allowed ? children : (
            <div className="alert alert-warning" role="alert">
              <strong>Tu rol ({profile.roleLabel}) no tiene acceso a esta sección.</strong>{" "}
              <Link href="/">Volver al inicio</Link>
            </div>
          )}
        </main>
      </div>
    </SessionContext.Provider>
  );
}
