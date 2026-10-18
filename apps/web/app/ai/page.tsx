"use client";
import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import type { AiAnswer, AiChart, AiProposal, AiQuery } from "@erp/client";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { ErrorBox, PageHeader, StatusChip, useAction } from "@/components/ui";
import { Chart } from "@/components/Chart";
import { Markdown } from "@/components/Markdown";

type Turn = { role: "user"; content: string } | { role: "assistant"; content: string; answer: AiAnswer };

const SUGGESTIONS = [
  "¿Cuánto vendí este mes y quiénes fueron mis 5 mejores clientes?",
  "Grafica mis ventas por semana de los últimos 3 meses",
  "¿Qué productos están por debajo de su existencia mínima?",
  "¿Cuánto me deben mis clientes y cuáles facturas están vencidas?",
  "¿Qué encontró el auditor y qué debo atender primero?",
  "Prepara una factura de 2 monitores para Comercializadora del Bajío",
];

const PREVIEW_LABELS: Record<string, string> = {
  customer: "Cliente", subtotal: "Subtotal", iva: "IVA", total: "Total", amount: "Importe", value: "Valor",
  fromQtyAfter: "Existencia origen después", toQtyAfter: "Existencia destino después",
};
const MONEY_KEYS = new Set(["subtotal", "iva", "total", "amount", "value"]);

function ChartBlock({ chart, question }: { chart: AiChart; question: string }) {
  const [pinned, setPinned] = useState(false);
  const action = useAction();
  async function pin() {
    const r = await action.run(() => api().pinWidget({ title: chart.title, question, sql: chart.sql, chart: { type: chart.type, x: chart.x, y: chart.y } }));
    if (r) setPinned(true);
  }
  return (
    <div>
      <Chart spec={chart} rows={chart.rows} title={chart.title} />
      <div className="proposal-actions" style={{ marginTop: 6 }}>
        {pinned ? <span className="small muted">Fijada en tu <Link href="/">tablero</Link>; se actualiza con datos nuevos.</span>
          : <button className="btn btn-sm" onClick={pin} disabled={action.busy}>📌 Fijar en el tablero</button>}
      </div>
      <ErrorBox error={action.error} />
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: AiProposal }) {
  const [status, setStatus] = useState(proposal.status);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const action = useAction();
  async function apply() {
    const r = await action.run(() => api().applyProposal(proposal.id));
    if (r) { setStatus("applied"); setResult(r.result); }
  }
  async function reject() {
    const r = await action.run(() => api().rejectProposal(proposal.id));
    if (r) setStatus("rejected");
  }
  const preview = Object.entries(proposal.preview).filter(([k]) => PREVIEW_LABELS[k]);
  const link = result?.salesInvoiceId ? `/invoices/view/?id=${result.salesInvoiceId}` : result?.journalEntryId ? `/accounting/entries/view/?id=${result.journalEntryId}` : null;
  return (
    <div className="proposal">
      <div className="proposal-head">
        <strong>{proposal.label}</strong>
        <StatusChip status={status === "applied" ? "posted" : status === "rejected" ? "cancelled" : "draft"}
          label={status === "applied" ? "Aplicada" : status === "rejected" ? "Descartada" : "Pendiente"} />
      </div>
      <div>{proposal.summary}</div>
      {preview.length ? (
        <dl>{preview.map(([k, v]) => <Fragment key={k}><dt>{PREVIEW_LABELS[k]}</dt><dd>{MONEY_KEYS.has(k) ? money(String(v)) : String(v)}</dd></Fragment>)}</dl>
      ) : null}
      {status === "pending" ? (
        <div className="proposal-actions">
          <button className="btn btn-primary btn-sm" onClick={apply} disabled={action.busy}>Aplicar</button>
          <button className="btn btn-sm" onClick={reject} disabled={action.busy}>Descartar</button>
          <span className="small muted">Nada cambia hasta que lo apliques.</span>
        </div>
      ) : null}
      {status === "applied" && link ? <div className="small"><Link href={link}>Abrir el documento creado</Link></div> : null}
      <ErrorBox error={action.error} />
    </div>
  );
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function QueryBlock({ q, n }: { q: AiQuery; n: number }) {
  return (
    <div className="query">
      <div><strong>Consulta {n}</strong>{q.purpose ? <span className="muted"> — {q.purpose}</span> : null}</div>
      <pre>{q.sql}</pre>
      {q.error ? <div className="alert alert-error" style={{ margin: "6px 0" }}>{q.error}</div> : (
        <div className="small muted">{q.rowCount} fila(s){q.truncated ? " (truncado)" : ""}</div>
      )}
      {q.rows.length > 0 ? (
        <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto", marginTop: 6 }}>
          <table>
            <thead><tr>{q.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {q.rows.slice(0, 50).map((r, i) => <tr key={i}>{q.columns.map((c) => <td key={c}>{cell(r[c])}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      ) : null}
      {q.rows.length > 50 ? <div className="small muted">Mostrando 50 de {q.rows.length} filas.</div> : null}
    </div>
  );
}

export default function AiPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const action = useAction();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns, action.busy]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || action.busy) return;
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((ts) => [...ts, { role: "user", content: q }]);
    setQuestion("");
    const answer = await action.run(() => api().askAi(q, history));
    if (answer) setTurns((ts) => [...ts, { role: "assistant", content: answer.answer, answer }]);
    else setTurns((ts) => ts.slice(0, -1)); // drop the unanswered question from history
    if (!answer) setQuestion(q);
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(question); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(question); }
  };

  return (
    <>
      <PageHeader title="Pregúntale a la IA" subtitle="Consulta tus datos en lenguaje natural, pide gráficas o que te prepare facturas y pólizas. La IA sólo lee; tú confirmas cualquier cambio."
        actions={turns.length ? <button className="btn" onClick={() => { setTurns([]); action.setError(null); }}>Nueva conversación</button> : null} />
      <div className="chat">
        {turns.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ marginTop: 0 }}>Prueba con alguna de estas preguntas:</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => <button key={s} className="btn btn-sm" onClick={() => void ask(s)}>{s}</button>)}
            </div>
          </div>
        ) : null}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="msg msg-user">{t.content}</div>
          ) : (
            <div key={i} className="msg msg-assistant">
              <Markdown text={t.answer.answer} />
              {(t.answer.charts ?? []).map((c, j) => <ChartBlock key={j} chart={c} question={String((turns[i - 1] as { content?: string } | undefined)?.content ?? "")} />)}
              {(t.answer.proposals ?? []).map((p) => <ProposalCard key={p.id} proposal={p} />)}
              {t.answer.queries.length > 0 ? (
                <details className="queries">
                  <summary>Consultas SQL ({t.answer.queries.length})</summary>
                  {t.answer.queries.map((q, j) => <QueryBlock key={j} q={q} n={j + 1} />)}
                </details>
              ) : null}
              <div className="msg-meta">{t.answer.model} · {t.answer.usage.inputTokens + t.answer.usage.outputTokens} tokens</div>
            </div>
          ),
        )}
        {action.busy ? <div className="msg msg-assistant"><span className="spinner" /> Analizando tus datos…</div> : null}
        <ErrorBox error={action.error} />
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={onKey} rows={2}
          placeholder={turns.length ? "Pregunta de seguimiento…" : "Escribe tu pregunta (Enter para enviar, Shift+Enter para salto de línea)"} />
        <button className="btn btn-primary" disabled={action.busy || !question.trim()}>Preguntar</button>
      </form>
    </>
  );
}
