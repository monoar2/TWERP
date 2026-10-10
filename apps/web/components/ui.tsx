"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@erp/client";
import { STATUS_LABELS } from "@/lib/format";

/** Loads data on mount and whenever deps change; exposes reload(). */
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await loaderRef.current();
      if (id === seq.current) setData(d);
    } catch (e) {
      if (id === seq.current) setError(e);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData };
}

/** Wraps an async action with busy/error state for forms and buttons. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

function isFieldErrors(d: unknown): d is Array<{ field?: string; path?: string; message: string }> {
  return Array.isArray(d) && d.every((x) => x && typeof x === "object" && "message" in x);
}

function isZodFlatten(d: unknown): d is { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> } {
  return !!d && typeof d === "object" && Array.isArray((d as { formErrors?: unknown }).formErrors) && typeof (d as { fieldErrors?: unknown }).fieldErrors === "object";
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  let message = "Error desconocido";
  let details: ReactNode = null;
  if (error instanceof ApiError) {
    message = error.message;
    if (isFieldErrors(error.details)) {
      details = (
        <ul>
          {error.details.map((d, i) => (
            <li key={i}>
              {(d.field ?? d.path) ? <code>{String(d.field ?? d.path)}</code> : null} {d.message}
            </li>
          ))}
        </ul>
      );
    } else if (isZodFlatten(error.details)) {
      const { formErrors, fieldErrors } = error.details;
      details = (
        <ul>
          {formErrors.map((m, i) => <li key={`f${i}`}>{m}</li>)}
          {Object.entries(fieldErrors).map(([field, msgs]) => (
            <li key={field}><code>{field}</code> {(msgs ?? []).join("; ")}</li>
          ))}
        </ul>
      );
    } else if (error.details && typeof error.details === "object") {
      details = <pre className="mono small">{JSON.stringify(error.details, null, 2)}</pre>;
    }
  } else if (error instanceof TypeError) {
    message = `No se pudo conectar con la API (${error.message}). Revisa la URL en Configuración.`;
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return (
    <div className="alert alert-error" role="alert">
      <strong>{message}</strong>
      {details}
    </div>
  );
}

export function Notice({ children, kind = "success" }: { children: ReactNode; kind?: "success" | "info" | "warning" }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return <div className="loading"><span className="spinner" /> {label}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

export function SubNav({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  const norm = (p: string) => p.replace(/\/$/, "") || "/";
  return (
    <nav className="subnav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={norm(pathname) === norm(i.href) ? "active" : ""}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

const CHIP_KIND: Record<string, string> = {
  draft: "neutral",
  stamped: "success",
  validated: "success",
  posted: "success",
  cancelled: "danger",
  paid: "success",
  partial: "warning",
  unpaid: "warning",
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  return <span className={`chip chip-${CHIP_KIND[status] ?? "neutral"}`}>{label ?? STATUS_LABELS[status] ?? status}</span>;
}

export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {title || actions ? (
        <div className="card-header">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Kpi({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "warning" | "danger" }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone ? `tone-${tone}` : ""}`}>{value}</span>
      {hint ? <span className="kpi-hint">{hint}</span> : null}
    </>
  );
  return href ? <Link className="kpi" href={href}>{body}</Link> : <div className="kpi">{body}</div>;
}

/** Simple modal dialog. */
export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function YearMonthPicker({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const current = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => current - 4 + i);
  return (
    <div className="inline-fields">
      <Field label="Año">
        <select value={year} onChange={(e) => onChange(Number(e.target.value), month)}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </Field>
      <Field label="Mes">
        <select value={month} onChange={(e) => onChange(year, Number(e.target.value))}>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
      </Field>
    </div>
  );
}

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
