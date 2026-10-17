import type { Db } from "@erp/db";

/** Gap-free counter (folios, póliza numbers). Must run inside a transaction. */
export async function nextSequence(tx: Db, name: string): Promise<number> {
  const [row] = await tx<{ value: number }[]>`
    INSERT INTO sequences (name, next_value) VALUES (${name}, 2)
    ON CONFLICT (name) DO UPDATE SET next_value = sequences.next_value + 1
    RETURNING next_value - 1 AS value`;
  return row!.value;
}
