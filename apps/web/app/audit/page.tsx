"use client";
import Link from "next/link";
import { useState } from "react";
import type { AuditFinding } from "@erp/client";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Markdown } from "@/components/Markdown";
import { Card, Empty, ErrorBox, Loading, Notice, PageHeader, useAction, useData } from "@/components/ui";

type Status = "open" | "dismissed" | "resolved" | "all";
const STATUSES: Array<{ value: Status; label: string }> = [
  { value: "open", label: "Abiertos" },
  { value: "dismissed", label: "Descartados" },
  { value: "resolved", label: "Resueltos" },
  { value: "all", label: "Todos" },
];
const SEVERITY: Record<AuditFinding["severity"], string> = { high: "Alta", medium: "Media", low: "Baja" };

/** Links from a finding's evidence to the documents it points at. */
function EvidenceLinks({ e }: { e: Record<string, unknown> }) {
  const links: Array<{ href: string; label: string }> = [];
  const ids = (v: unknown) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(Number).filter(Number.isFinite);
  for (const id of ids(e.supplierInvoiceIds ?? e.supplierInvoiceId)) links.push({ href: `/purchases/view/?id=${id}`, label: `Compra #${id}` });
  for (const id of ids(e.salesInvoiceIds ?? e.salesInvoiceId).slice(0, 5)) links.push({ href: `/invoices/view/?id=${id}`, label: `Factura #${id}` });
  if (e.thirdPartyId !== undefined) links.push({ href: "/third-parties/", label: "Ver terceros" });
  if (e.productId !== undefined) links.push({ href: "/inventory/", label: "Ver existencias" });
  if (!links.length) return null;
  return (
    <div className="actions" style={{ marginTop: 6 }}>
      {links.map((l) => <Link key={l.href} className="small" href={l.href}>{l.label}</Link>)}
    </div>
  );
}

function FindingRow({ f, onChange }: { f: AuditFinding; onChange: () => void }) {
  const action = useAction();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  async function dismiss() {
    if (await action.run(() => api().dismissFinding(f.id, note || undefined))) onChange();
  }
  async function reopen() {
    if (await action.run(() => api().reopenFinding(f.id))) onChange();
  }
  return (
    <div className="finding">
      <span className={`sev sev-${f.severity}`}>{SEVERITY[f.severity]}</span>
      <div>
        <h3>{f.title}</h3>
        <p>{f.detail}</p>
        <EvidenceLinks e={f.evidence} />
        <div className="small muted" style={{ marginTop: 4 }}>
          Detectado {dateTime(f.first_seen)}
          {f.status === "dismissed" ? <> · descartado por {f.dismissed_by_name ?? "—"}{f.note ? <>: “{f.note}”</> : null}</> : null}
          {f.status === "resolved" ? <> · ya no aparece desde {dateTime(f.last_seen)}</> : null}
        </div>
        {asking ? (
          <div className="actions" style={{ marginTop: 8 }}>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo (opcional)" aria-label="Motivo" style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={dismiss} disabled={action.busy}>Descartar</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>Cancelar</button>
          </div>
        ) : null}
        {action.error ? <ErrorBox error={action.error} /> : null}
      </div>
      <div>
        {f.status === "open" && !asking ? <button className="btn btn-ghost btn-sm" onClick={() => setAsking(true)}>Descartar</button> : null}
        {f.status === "dismissed" ? <button className="btn btn-ghost btn-sm" onClick={reopen} disabled={action.busy}>Reabrir</button> : null}
      </div>
    </div>
  );
}

export default function AuditPage() {
  const [status, setStatus] = useState<Status>("open");
  const findings = useData(() => api().auditFindings(status), [status]);
  const runs = useData(() => api().auditRuns());
  const run = useAction();
  const [done, setDone] = useState<string | null>(null);
  const last = runs.data?.find((r) => r.finished_at);

  async function runNow() {
    setDone(null);
    const r = await run.run(() => api().runAudit());
    if (r) {
      setDone(`Revisión terminada: ${r.findings} hallazgo(s) abierto(s), ${r.newFindings} nuevo(s), ${r.resolved} resuelto(s).`);
      void findings.reload();
      void runs.reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Auditor"
        subtitle="Revisa los libros en busca de duplicados, proveedores en la lista 69-B del SAT, ventas bajo costo, precios atípicos y más. Corre solo cada día; también puedes ejecutarlo ahora."
        actions={<button className="btn btn-primary" onClick={runNow} disabled={run.busy}>{run.busy ? "Revisando…" : "Ejecutar revisión"}</button>}
      />
      {done ? <Notice>{done}</Notice> : null}
      {run.error ? <ErrorBox error={run.error} /> : null}

      <Card title="Última revisión">
        {runs.error ? <ErrorBox error={runs.error} /> : !runs.data ? <Loading /> : !last ? <Empty>Aún no hay revisiones.</Empty> : (
          <>
            <div className="small muted" style={{ marginBottom: 8 }}>
              {dateTime(last.finished_at)} · {last.trigger === "schedule" ? "programada" : "manual"} · {last.findings} hallazgo(s), {last.new_findings} nuevo(s)
            </div>
            {last.error ? <ErrorBox error={new Error(last.error)} /> : last.summary ? <Markdown text={last.summary} /> : <span className="muted">Sin resumen de IA (no hay clave de Claude configurada).</span>}
          </>
        )}
      </Card>

      <Card
        title="Hallazgos"
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Estado" style={{ width: "auto" }}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        }
      >
        {findings.error ? <ErrorBox error={findings.error} /> : !findings.data ? <Loading /> : !findings.data.length ? (
          <Empty>{status === "open" ? "Sin hallazgos abiertos. Todo en orden." : "No hay hallazgos con este estado."}</Empty>
        ) : findings.data.map((f) => <FindingRow key={f.id} f={f} onChange={() => void findings.reload()} />)}
      </Card>
    </>
  );
}
