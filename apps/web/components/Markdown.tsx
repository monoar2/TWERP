import type { ReactNode } from "react";

/** Inline formatting: **bold**, *italic*, `code`. Returns React nodes (no raw HTML). */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${keyBase}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const splitRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const numeric = (s: string) => /^[-+$]?\s?[\d.,]+\s?%?$/.test(s);

/** A deliberately small Markdown renderer for AI answers: headings, lists, tables, code blocks, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const key = `b${k++}`;
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) code.push(lines[i++]!);
      i++;
      blocks.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(h[1]!.length <= 2 ? <h3 key={key}>{inline(h[2]!, key)}</h3> : <h4 key={key}>{inline(h[2]!, key)}</h4>);
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isSeparator(lines[i + 1]!)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(splitRow(lines[i++]!));
      blocks.push(
        <div className="table-wrap" key={key}>
          <table>
            <thead><tr>{header.map((c, j) => <th key={j}>{inline(c, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className={numeric(c) ? "num" : ""}>{inline(c, `${key}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const lis = items.map((it, j) => <li key={j}>{inline(it, `${key}l${j}`)}</li>);
      blocks.push(ordered ? <ol key={key}>{lis}</ol> : <ul key={key}>{lis}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|\s*([-*•]|\d+[.)])\s+)/.test(lines[i]!) && !(lines[i]!.includes("|") && i + 1 < lines.length && isSeparator(lines[i + 1]!))) {
      para.push(lines[i++]!);
    }
    blocks.push(
      <p key={key}>
        {para.map((p, j) => <span key={j}>{j > 0 ? <br /> : null}{inline(p, `${key}p${j}`)}</span>)}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
