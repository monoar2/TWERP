import { D, Decimal, round2, type Num } from "@erp/mx";
import type { Db } from "@erp/db";
import { badRequest, notFound } from "../errors.js";
import { nextSequence } from "./sequences.js";

export type JournalCode = "VT" | "AC" | "CO" | "PA" | "IN" | "OD";

export interface EntryLineInput {
  accountId: number;
  debit?: Num;
  credit?: Num;
  description?: string;
  cfdiUuid?: string | null;
  rfc?: string | null;
  cfdiTotal?: Num | null;
}

export interface EntryInput {
  journal: JournalCode;
  date: string;
  concept: string;
  sourceType?: string;
  sourceId?: number;
  lines: EntryLineInput[];
}

/** Resolve a default account by its settings key (see account_settings). */
export async function accountFor(tx: Db, key: string): Promise<number> {
  const [row] = await tx<{ account_id: number }[]>`SELECT account_id FROM account_settings WHERE key = ${key}`;
  if (!row) throw badRequest(`Falta configurar la cuenta contable "${key}"`);
  return row.account_id;
}

/**
 * Create and post a balanced journal entry. Zero lines are dropped and
 * same-account/same-side lines are kept separate so CFDI references survive.
 * The database trigger re-checks balance, postable accounts and open period.
 */
export async function postEntry(tx: Db, input: EntryInput): Promise<number> {
  const lines = input.lines
    .map((l) => ({ ...l, debit: round2(l.debit ?? 0), credit: round2(l.credit ?? 0) }))
    .filter((l) => !l.debit.isZero() || !l.credit.isZero())
    .map((l) => {
      // Normalize negative amounts onto the opposite side.
      const net = l.debit.minus(l.credit);
      return { ...l, debit: net.gt(0) ? net : D(0), credit: net.lt(0) ? net.abs() : D(0) };
    })
    .filter((l) => !l.debit.isZero() || !l.credit.isZero());

  const debit = lines.reduce((a, l) => a.plus(l.debit), D(0));
  const credit = lines.reduce((a, l) => a.plus(l.credit), D(0));
  if (!debit.equals(credit)) throw badRequest(`La póliza no cuadra: cargos ${debit.toFixed(2)} abonos ${credit.toFixed(2)}`);
  if (lines.length < 2) throw badRequest("La póliza requiere al menos dos movimientos");

  const year = Number(input.date.slice(0, 4));
  const [entry] = await tx<{ id: number }[]>`
    INSERT INTO journal_entries (journal_code, entry_date, concept, source_type, source_id)
    VALUES (${input.journal}, ${input.date}, ${input.concept}, ${input.sourceType ?? null}, ${input.sourceId ?? null})
    RETURNING id`;
  let n = 1;
  for (const l of lines) {
    await tx`INSERT INTO journal_lines (entry_id, line_no, account_id, debit, credit, description, cfdi_uuid, rfc, cfdi_total)
             VALUES (${entry!.id}, ${n++}, ${l.accountId}, ${l.debit.toFixed(2)}, ${l.credit.toFixed(2)},
                     ${l.description ?? input.concept}, ${l.cfdiUuid ?? null}, ${l.rfc ?? null},
                     ${l.cfdiTotal == null ? null : round2(l.cfdiTotal).toFixed(2)})`;
  }
  const number = await nextSequence(tx, `poliza:${input.journal}:${year}`);
  // Store the yearly number as journal-year-number to stay unique across years.
  await tx`UPDATE journal_entries SET number = ${year * 100000 + number}, status = 'posted' WHERE id = ${entry!.id}`;
  return entry!.id;
}

/** Post the mirror image of an entry (used when cancelling documents). */
export async function reverseEntry(tx: Db, entryId: number, date: string, concept: string): Promise<number> {
  const [entry] = await tx<{ journal_code: JournalCode; source_type: string | null; source_id: number | null }[]>`
    SELECT journal_code, source_type, source_id FROM journal_entries WHERE id = ${entryId}`;
  if (!entry) throw notFound("Póliza");
  const lines = await tx<{ account_id: number; debit: string; credit: string; description: string; cfdi_uuid: string | null; rfc: string | null; cfdi_total: string | null }[]>`
    SELECT account_id, debit, credit, description, cfdi_uuid, rfc, cfdi_total FROM journal_lines WHERE entry_id = ${entryId} ORDER BY line_no`;
  return postEntry(tx, {
    journal: entry.journal_code,
    date,
    concept,
    sourceType: entry.source_type ?? undefined,
    sourceId: entry.source_id ?? undefined,
    lines: lines.map((l) => ({
      accountId: l.account_id,
      debit: l.credit,
      credit: l.debit,
      description: `Cancelación: ${l.description}`,
      cfdiUuid: l.cfdi_uuid,
      rfc: l.rfc,
      cfdiTotal: l.cfdi_total,
    })),
  });
}

export interface TrialBalanceRow {
  accountId: number;
  code: string;
  name: string;
  satCode: string;
  level: number;
  nature: "D" | "A";
  parentId: number | null;
  saldoIni: Decimal;
  debe: Decimal;
  haber: Decimal;
  saldoFin: Decimal;
}

/**
 * Balanza de comprobación for one month. Balances follow each account's
 * nature (deudora: debe − haber, acreedora: haber − debe) and parent
 * accounts aggregate their children, as Anexo 24 expects.
 */
export async function trialBalance(db: Db, year: number, month: number): Promise<TrialBalanceRow[]> {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const rows = await db<{ id: number; code: string; name: string; sat_code: string; level: number; nature: "D" | "A"; parent_id: number | null; before_d: string; before_c: string; per_d: string; per_c: string }[]>`
    SELECT a.id, a.code, a.name, a.sat_code, a.level, a.nature, a.parent_id,
      coalesce(sum(l.debit)  FILTER (WHERE e.entry_date <  ${start}::date), 0) AS before_d,
      coalesce(sum(l.credit) FILTER (WHERE e.entry_date <  ${start}::date), 0) AS before_c,
      coalesce(sum(l.debit)  FILTER (WHERE e.entry_date >= ${start}::date AND e.entry_date < (${start}::date + interval '1 month')), 0) AS per_d,
      coalesce(sum(l.credit) FILTER (WHERE e.entry_date >= ${start}::date AND e.entry_date < (${start}::date + interval '1 month')), 0) AS per_c
    FROM accounts a
    LEFT JOIN journal_lines l ON l.account_id = a.id
    LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
    WHERE a.active
    GROUP BY a.id ORDER BY a.code`;

  const byId = new Map<number, TrialBalanceRow & { bd: Decimal; bc: Decimal }>();
  for (const r of rows) {
    byId.set(r.id, {
      accountId: r.id, code: r.code, name: r.name, satCode: r.sat_code, level: r.level, nature: r.nature, parentId: r.parent_id,
      bd: D(r.before_d), bc: D(r.before_c), debe: D(r.per_d), haber: D(r.per_c),
      saldoIni: D(0), saldoFin: D(0),
    });
  }
  // Roll leaf amounts up the tree (deepest levels first).
  const ordered = [...byId.values()].sort((a, b) => b.level - a.level);
  for (const acc of ordered) {
    if (acc.parentId == null) continue;
    const parent = byId.get(acc.parentId);
    if (!parent) continue;
    parent.bd = parent.bd.plus(acc.bd);
    parent.bc = parent.bc.plus(acc.bc);
    parent.debe = parent.debe.plus(acc.debe);
    parent.haber = parent.haber.plus(acc.haber);
  }
  return [...byId.values()]
    .map(({ bd, bc, ...acc }) => {
      const sign = (d: Decimal, c: Decimal) => (acc.nature === "D" ? d.minus(c) : c.minus(d));
      const saldoIni = sign(bd, bc);
      return { ...acc, saldoIni, saldoFin: saldoIni.plus(sign(acc.debe, acc.haber)) };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Net movement of the accounts behind settings keys in a date range, in the account's natural direction. */
export async function movementByKey(db: Db, keys: string[], from: string, to: string): Promise<Record<string, Decimal>> {
  const rows = await db<{ key: string; net: string }[]>`
    SELECT s.key,
      coalesce(sum(CASE WHEN a.nature = 'D' THEN l.debit - l.credit ELSE l.credit - l.debit END), 0) AS net
    FROM account_settings s
    JOIN accounts a ON a.id = s.account_id
    LEFT JOIN journal_lines l ON l.account_id = a.id
      AND l.entry_id IN (SELECT id FROM journal_entries WHERE status = 'posted' AND entry_date BETWEEN ${from}::date AND ${to}::date)
    WHERE s.key IN ${db(keys)}
    GROUP BY s.key`;
  return Object.fromEntries(rows.map((r) => [r.key, D(r.net)]));
}

export interface LedgerLine {
  entryId: number;
  date: string;
  journal: string;
  number: number | null;
  concept: string;
  debit: string;
  credit: string;
  balance: string;
  cfdiUuid: string | null;
}

/** Auxiliar de cuenta (general ledger detail) with a running balance. */
export async function ledger(db: Db, accountCode: string, from: string, to: string) {
  const [account] = await db<{ id: number; code: string; name: string; nature: "D" | "A" }[]>`
    SELECT id, code, name, nature FROM accounts WHERE code = ${accountCode}`;
  if (!account) throw notFound("Cuenta");
  const sign = (d: Num, c: Num) => (account.nature === "D" ? D(d).minus(c) : D(c).minus(d));
  const [opening] = await db<{ d: string; c: string }[]>`
    SELECT coalesce(sum(l.debit),0) AS d, coalesce(sum(l.credit),0) AS c
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = ${account.id} AND e.status = 'posted' AND e.entry_date < ${from}::date`;
  let balance = sign(opening!.d, opening!.c);
  const openingBalance = balance;
  const rows = await db<{ entry_id: number; entry_date: Date; journal_code: string; number: number | null; description: string; debit: string; credit: string; cfdi_uuid: string | null }[]>`
    SELECT l.entry_id, e.entry_date, e.journal_code, e.number, l.description, l.debit, l.credit, l.cfdi_uuid
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = ${account.id} AND e.status = 'posted' AND e.entry_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY e.entry_date, e.id, l.line_no`;
  const lines: LedgerLine[] = rows.map((r) => {
    balance = balance.plus(sign(r.debit, r.credit));
    return {
      entryId: r.entry_id,
      date: isoDate(r.entry_date),
      journal: r.journal_code,
      number: r.number,
      concept: r.description,
      debit: r.debit,
      credit: r.credit,
      balance: balance.toFixed(2),
      cfdiUuid: r.cfdi_uuid,
    };
  });
  return { account, openingBalance: openingBalance.toFixed(2), closingBalance: balance.toFixed(2), lines };
}

/** Estado de resultados for a date range, grouped by account kind. */
export async function incomeStatement(db: Db, from: string, to: string) {
  const rows = await db<{ code: string; name: string; kind: string; amount: string }[]>`
    SELECT a.code, a.name, a.kind,
      sum(CASE WHEN a.nature = 'A' THEN l.credit - l.debit ELSE l.debit - l.credit END) AS amount
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND e.entry_date BETWEEN ${from}::date AND ${to}::date
      AND a.kind IN ('income', 'cost', 'expense')
    GROUP BY a.code, a.name, a.kind, a.nature ORDER BY a.code`;
  const total = (kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s.plus(r.amount), D(0));
  // Contra-income accounts (402 devoluciones) have deudora nature, so they come out positive; subtract them.
  const income = rows.filter((r) => r.kind === "income" && !r.code.startsWith("402")).reduce((s, r) => s.plus(r.amount), D(0));
  const returns = rows.filter((r) => r.code.startsWith("402")).reduce((s, r) => s.plus(r.amount), D(0));
  const netIncome = income.minus(returns);
  const costs = total("cost");
  const expenses = total("expense");
  return {
    from,
    to,
    accounts: rows,
    income: netIncome.toFixed(2),
    costs: costs.toFixed(2),
    grossProfit: netIncome.minus(costs).toFixed(2),
    expenses: expenses.toFixed(2),
    netProfit: netIncome.minus(costs).minus(expenses).toFixed(2),
  };
}

export function isoDate(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  // Dates come back as local midnight; format without timezone shifts.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}
