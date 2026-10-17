"use client";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AiAnswer, AiQuery } from "@erp/client";
import { api } from "@/lib/api";
import { ErrorBox, PageHeader, useAction } from "@/components/ui";
import { Markdown } from "@/components/Markdown";

type Turn = { role: "user"; content: string } | { role: "assistant"; content: string; answer: AiAnswer };

const SUGGESTIONS = [
  "¿Cuánto vendí este mes y quiénes fueron mis 5 mejores clientes?",
  "¿Qué productos están por debajo de su existencia mínima?",
  "¿Cuánto me deben mis clientes y cuáles facturas están vencidas?",
  "¿Cuál es mi IVA a cargo del mes pasado?",
];

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
      <PageHeader title="Pregúntale a la IA" subtitle="Consulta tus datos en lenguaje natural. La IA solo tiene acceso de lectura."
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
