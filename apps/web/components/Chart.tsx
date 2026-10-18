"use client";
import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { AiChartSpec } from "@erp/client";

/**
 * Small dependency-free SVG charts for AI answers and dashboard widgets:
 * bar (vertical), line and donut ("pie"). Series colors come from the
 * --series-N tokens in globals.css (fixed order, validated for color vision
 * deficiency in light and dark); text stays in text tokens.
 */

const W = 640, H = 260, PAD = { top: 12, right: 12, bottom: 44, left: 64 };
const MAX_POINTS = 60;

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const compact = (n: number) => new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const full = (n: number) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(n);
const label = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // ISO dates/timestamps: show the date part.
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
};
const color = (i: number) => `var(--series-${(i % 8) + 1})`;

function niceTicks(max: number, min: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

interface Tip { x: number; y: number; title: string; lines: Array<{ name: string; value: string; i: number }> }

export function Chart({ spec, rows, title }: { spec: AiChartSpec; rows: Record<string, unknown>[]; title?: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [table, setTable] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const data = useMemo(() => rows.slice(0, MAX_POINTS), [rows]);
  const series = spec.y;

  const place = (e: MouseEvent, t: Omit<Tip, "x" | "y">) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ ...t, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  if (!data.length) return <div className="empty">La consulta no devolvió filas.</div>;

  let body: ReactNode;
  if (spec.type === "pie") {
    const key = series[0]!;
    const values = data.map((r) => Math.max(0, num(r[key])));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    // Fold everything past 7 slices into "Otros" so hues never cycle.
    const slices = values.length > 8
      ? [...values.slice(0, 7).map((v, i) => ({ name: label(data[i]![spec.x]), v })), { name: "Otros", v: values.slice(7).reduce((a, b) => a + b, 0) }]
      : values.map((v, i) => ({ name: label(data[i]![spec.x]), v }));
    const cx = 130, cy = 130, r = 110, inner = 66;
    let a0 = -Math.PI / 2;
    body = (
      <div className="chart-pie">
        <svg viewBox="0 0 260 260" role="img" aria-label={title ?? "Gráfica"} className="chart-svg chart-svg-pie">
          {slices.map((s, i) => {
            const a1 = a0 + (s.v / total) * Math.PI * 2;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)} ${cy + rr * Math.sin(a)}`;
            const d = slices.length === 1
              ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 M ${cx - inner} ${cy} a ${inner} ${inner} 0 1 1 ${2 * inner} 0 a ${inner} ${inner} 0 1 1 ${-2 * inner} 0`
              : `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(a0, inner)} Z`;
            const el = (
              <path key={i} d={d} fill={color(i)} stroke="var(--surface)" strokeWidth={2} fillRule="evenodd"
                onMouseMove={(e) => place(e, { title: s.name, lines: [{ name: key, value: `${full(s.v)} (${Math.round((s.v / total) * 100)}%)`, i }] })}
                onMouseLeave={() => setTip(null)} />
            );
            a0 = a1;
            return el;
          })}
        </svg>
        <ul className="chart-legend chart-legend-col">
          {slices.map((s, i) => (
            <li key={i}><span className="swatch" style={{ background: color(i) }} />{s.name}<span className="muted"> · {Math.round((s.v / total) * 100)}%</span></li>
          ))}
        </ul>
      </div>
    );
  } else {
    const all = data.flatMap((r) => series.map((k) => num(r[k])));
    const ticks = niceTicks(Math.max(0, ...all), Math.min(0, ...all));
    const lo = ticks[0]!, hi = ticks[ticks.length - 1]!;
    const iw = W - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
    const y = (v: number) => PAD.top + ih - ((v - lo) / (hi - lo || 1)) * ih;
    const band = iw / data.length;
    const xMid = (i: number) => PAD.left + band * i + band / 2;
    const every = Math.ceil(data.length / 8);
    const tipFor = (i: number) => ({ title: label(data[i]![spec.x]), lines: series.map((k, j) => ({ name: k, value: full(num(data[i]![k])), i: j })) });
    const hover = tip ? data.findIndex((r) => label(r[spec.x]) === tip.title) : -1;

    body = (
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title ?? "Gráfica"} className="chart-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-axis" : "chart-grid"} />
            <text x={PAD.left - 8} y={y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">{compact(t)}</text>
          </g>
        ))}
        {data.map((r, i) => i % every === 0 ? (
          <text key={i} x={xMid(i)} y={H - PAD.bottom + 16} className="chart-tick" textAnchor="middle">
            {label(r[spec.x]).length > 12 ? `${label(r[spec.x]).slice(0, 11)}…` : label(r[spec.x])}
          </text>
        ) : null)}
        {spec.type === "bar" ? data.map((r, i) => {
          const gap = 2;
          const groupW = Math.min(band * 0.72, 28 * series.length + gap * (series.length - 1));
          const bw = (groupW - gap * (series.length - 1)) / series.length;
          return (
            <g key={i}>
              {series.map((k, j) => {
                const v = num(r[k]);
                const x = xMid(i) - groupW / 2 + j * (bw + gap);
                const top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0));
                const h = Math.max(1, bottom - top);
                const rad = Math.min(4, bw / 2, h);
                // Rounded on the data end only, square on the baseline.
                const d = v >= 0
                  ? `M ${x} ${bottom} V ${top + rad} Q ${x} ${top} ${x + rad} ${top} H ${x + bw - rad} Q ${x + bw} ${top} ${x + bw} ${top + rad} V ${bottom} Z`
                  : `M ${x} ${top} V ${bottom - rad} Q ${x} ${bottom} ${x + rad} ${bottom} H ${x + bw - rad} Q ${x + bw} ${bottom} ${x + bw} ${bottom - rad} V ${top} Z`;
                return <path key={k} d={d} fill={color(j)} opacity={hover >= 0 && hover !== i ? 0.55 : 1} />;
              })}
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={ih} fill="transparent"
                onMouseMove={(e) => place(e, tipFor(i))} onMouseLeave={() => setTip(null)} />
            </g>
          );
        }) : (
          <>
            {series.map((k, j) => (
              <polyline key={k} fill="none" stroke={color(j)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                points={data.map((r, i) => `${xMid(i)},${y(num(r[k]))}`).join(" ")} />
            ))}
            {hover >= 0 ? (
              <>
                <line x1={xMid(hover)} x2={xMid(hover)} y1={PAD.top} y2={PAD.top + ih} className="chart-crosshair" />
                {series.map((k, j) => <circle key={k} cx={xMid(hover)} cy={y(num(data[hover]![k]))} r={4.5} fill={color(j)} stroke="var(--surface)" strokeWidth={2} />)}
              </>
            ) : null}
            {data.map((_, i) => (
              <rect key={i} x={PAD.left + band * i} y={PAD.top} width={band} height={ih} fill="transparent"
                onMouseMove={(e) => place(e, tipFor(i))} onMouseLeave={() => setTip(null)} />
            ))}
          </>
        )}
      </svg>
    );
  }

  return (
    <figure className="chart" ref={box}>
      <div className="chart-head">
        {title ? <figcaption>{title}</figcaption> : <span />}
        <button className="btn btn-ghost btn-sm" onClick={() => setTable((t) => !t)}>{table ? "Ver gráfica" : "Ver tabla"}</button>
      </div>
      {spec.type !== "pie" && series.length > 1 && !table ? (
        <ul className="chart-legend">
          {series.map((k, j) => <li key={k}><span className="swatch" style={{ background: color(j) }} />{k}</li>)}
        </ul>
      ) : null}
      {table ? (
        <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
          <table>
            <thead><tr><th>{spec.x}</th>{series.map((k) => <th key={k} className="num">{k}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}><td>{label(r[spec.x])}</td>{series.map((k) => <td key={k} className="num">{full(num(r[k]))}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : body}
      {rows.length > MAX_POINTS && !table ? <div className="small muted">Mostrando {MAX_POINTS} de {rows.length} filas.</div> : null}
      {tip && !table ? (
        <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          <strong>{tip.title}</strong>
          {tip.lines.map((l) => (
            <div key={l.name}><span className="swatch" style={{ background: color(l.i) }} />{l.name}: <span className="mono">{l.value}</span></div>
          ))}
        </div>
      ) : null}
    </figure>
  );
}
