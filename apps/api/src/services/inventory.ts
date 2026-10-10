import { D, Decimal, round2, type Num } from "@erp/mx";
import type { Db } from "@erp/db";
import { badRequest, conflict, notFound } from "../errors.js";
import { accountFor, postEntry } from "./accounting.js";

export type MovementKind = "initial" | "purchase" | "sale" | "adjustment" | "transfer" | "inventory" | "return";

export interface MovementInput {
  productId: number;
  warehouseId: number;
  /** Positive = entrada, negative = salida. */
  qty: Num;
  /** Required for entries; exits always use the current average cost. */
  unitCost?: Num;
  kind: MovementKind;
  label?: string;
  sourceType?: string;
  sourceId?: number;
  date?: string;
}

export interface MovementResult {
  movementId: number;
  unitCost: Decimal;
  /** qty × unit cost, rounded to centavos; negative for exits. */
  value: Decimal;
  avgCostAfter: Decimal;
}

/**
 * Record a stock movement and keep the weighted average cost (costo promedio
 * ponderado / PMP) up to date. The average is global per product across
 * warehouses, like Dolibarr's PMP. Exits are valued at the current average.
 */
export async function moveStock(tx: Db, m: MovementInput): Promise<MovementResult> {
  const qty = D(m.qty);
  if (qty.isZero()) throw badRequest("La cantidad no puede ser cero");
  const [product] = await tx<{ id: number; type: string; avg_cost: string; total_qty: string; name: string }[]>`
    SELECT p.id, p.type, p.avg_cost, p.name, coalesce((SELECT sum(qty) FROM stock WHERE product_id = p.id), 0) AS total_qty
    FROM products p WHERE p.id = ${m.productId} FOR UPDATE`;
  if (!product) throw notFound("Producto");
  if (product.type !== "product") throw badRequest(`"${product.name}" es un servicio y no maneja inventario`);
  const [wh] = await tx`SELECT id FROM warehouses WHERE id = ${m.warehouseId}`;
  if (!wh) throw notFound("Almacén");

  const totalQty = D(product.total_qty);
  const avg = D(product.avg_cost);
  let unitCost: Decimal;
  let newAvg = avg;
  if (qty.gt(0)) {
    unitCost = m.unitCost !== undefined ? D(m.unitCost) : avg;
    if (unitCost.lt(0)) throw badRequest("El costo unitario no puede ser negativo");
    // Only purchases, initial loads and surpluses at a given cost move the average.
    newAvg = totalQty.lte(0)
      ? unitCost
      : totalQty.times(avg).plus(qty.times(unitCost)).dividedBy(totalQty.plus(qty)).toDecimalPlaces(6);
  } else {
    unitCost = avg;
  }

  const [stock] = await tx<{ qty: string }[]>`
    INSERT INTO stock (product_id, warehouse_id, qty) VALUES (${m.productId}, ${m.warehouseId}, ${qty.toString()})
    ON CONFLICT (product_id, warehouse_id) DO UPDATE SET qty = stock.qty + EXCLUDED.qty
    RETURNING qty`;
  if (D(stock!.qty).lt(0)) {
    const [company] = await tx<{ allow_negative_stock: boolean }[]>`SELECT allow_negative_stock FROM company WHERE id = 1`;
    if (!company?.allow_negative_stock) throw conflict(`Existencia insuficiente de "${product.name}" en el almacén`);
  }
  await tx`UPDATE products SET avg_cost = ${newAvg.toString()} WHERE id = ${m.productId}`;
  const [mov] = await tx<{ id: number }[]>`
    INSERT INTO stock_movements (product_id, warehouse_id, qty, unit_cost, kind, label, source_type, source_id, avg_cost_after, moved_at)
    VALUES (${m.productId}, ${m.warehouseId}, ${qty.toString()}, ${unitCost.toString()}, ${m.kind}, ${m.label ?? null},
            ${m.sourceType ?? null}, ${m.sourceId ?? null}, ${newAvg.toString()}, ${m.date ?? new Date().toISOString().slice(0, 10)})
    RETURNING id`;
  return { movementId: mov!.id, unitCost, value: round2(qty.times(unitCost)), avgCostAfter: newAvg };
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Manual adjustment (merma, sobrante, carga inicial). Posts the accounting
 * side: inventory against cost (adjustment) or equity (initial load).
 */
export async function adjustStock(
  tx: Db,
  input: { productId: number; warehouseId: number; qty: Num; unitCost?: Num; reason: string; initial?: boolean; date?: string },
) {
  const kind: MovementKind = input.initial ? "initial" : "adjustment";
  if (input.initial && D(input.qty).lt(0)) throw badRequest("La carga inicial debe ser positiva");
  const date = input.date ?? today();
  const mov = await moveStock(tx, { ...input, kind, label: input.reason, date });
  const inventory = await accountFor(tx, "inventory");
  const counter = await accountFor(tx, input.initial ? "opening_equity" : "inventory_adjustment");
  const value = mov.value;
  const entryId = value.isZero()
    ? null
    : await postEntry(tx, {
        journal: "IN",
        date,
        concept: `${input.initial ? "Inventario inicial" : "Ajuste de inventario"}: ${input.reason}`,
        sourceType: "stock_movement",
        sourceId: mov.movementId,
        lines: [
          { accountId: inventory, debit: value.gt(0) ? value : 0, credit: value.lt(0) ? value.abs() : 0 },
          { accountId: counter, debit: value.lt(0) ? value.abs() : 0, credit: value.gt(0) ? value : 0 },
        ],
      });
  return { ...mov, journalEntryId: entryId };
}

/** Move units between warehouses at average cost; no accounting impact. */
export async function transferStock(
  tx: Db,
  input: { productId: number; fromWarehouseId: number; toWarehouseId: number; qty: Num; label?: string; date?: string },
) {
  if (input.fromWarehouseId === input.toWarehouseId) throw badRequest("Los almacenes deben ser distintos");
  if (!D(input.qty).gt(0)) throw badRequest("La cantidad debe ser positiva");
  const label = input.label ?? "Transferencia entre almacenes";
  const out = await moveStock(tx, { productId: input.productId, warehouseId: input.fromWarehouseId, qty: D(input.qty).negated(), kind: "transfer", label, date: input.date });
  const inn = await moveStock(tx, { productId: input.productId, warehouseId: input.toWarehouseId, qty: input.qty, unitCost: out.unitCost, kind: "transfer", label, date: input.date });
  return { out: out.movementId, in: inn.movementId };
}

/** Start a physical count: snapshot the expected quantity of every stocked product in the warehouse. */
export async function createInventoryCount(tx: Db, warehouseId: number, label: string) {
  const [count] = await tx<{ id: number }[]>`INSERT INTO inventory_counts (warehouse_id, label) VALUES (${warehouseId}, ${label}) RETURNING id`;
  await tx`
    INSERT INTO inventory_count_lines (count_id, product_id, qty_expected)
    SELECT ${count!.id}, p.id, coalesce(s.qty, 0)
    FROM products p LEFT JOIN stock s ON s.product_id = p.id AND s.warehouse_id = ${warehouseId}
    WHERE p.type = 'product' AND p.active`;
  return count!.id;
}

/** Validate a count: post an adjustment for each line whose counted qty differs. */
export async function validateInventoryCount(tx: Db, countId: number) {
  const [count] = await tx<{ id: number; warehouse_id: number; status: string; label: string }[]>`
    SELECT id, warehouse_id, status, label FROM inventory_counts WHERE id = ${countId} FOR UPDATE`;
  if (!count) throw notFound("Inventario físico");
  if (count.status !== "draft") throw conflict("El inventario ya fue validado");
  const lines = await tx<{ product_id: number; qty_counted: string | null }[]>`
    SELECT l.product_id, l.qty_counted FROM inventory_count_lines l WHERE l.count_id = ${countId} AND l.qty_counted IS NOT NULL`;
  const adjustments: number[] = [];
  for (const l of lines) {
    // Compare with the live quantity, in case stock moved since the count started.
    const [s] = await tx<{ qty: string }[]>`SELECT qty FROM stock WHERE product_id = ${l.product_id} AND warehouse_id = ${count.warehouse_id}`;
    const diff = D(l.qty_counted!).minus(s?.qty ?? 0);
    if (diff.isZero()) continue;
    const r = await adjustStock(tx, { productId: l.product_id, warehouseId: count.warehouse_id, qty: diff, reason: `Inventario físico: ${count.label}` });
    adjustments.push(r.movementId);
  }
  await tx`UPDATE inventory_counts SET status = 'validated', validated_at = now() WHERE id = ${countId}`;
  return { adjustments };
}
