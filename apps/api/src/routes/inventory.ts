import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { adjustStock, createInventoryCount, transferStock, validateInventoryCount } from "../services/inventory.js";
import { date, id, idParam, num, parse } from "../validate.js";

export async function inventoryRoutes(app: FastifyInstance, { sql }: AppContext) {
  app.get("/stock", async (req) => {
    const q = parse(z.object({ warehouseId: id.optional(), lowOnly: z.coerce.boolean().optional() }), req.query);
    return sql`
      SELECT s.product_id, p.sku, p.name, s.warehouse_id, w.code AS warehouse_code, s.qty, p.avg_cost,
             round(s.qty * p.avg_cost, 2) AS value, p.min_stock, s.qty < p.min_stock AS below_min
      FROM stock s JOIN products p ON p.id = s.product_id JOIN warehouses w ON w.id = s.warehouse_id
      WHERE true ${q.warehouseId ? sql`AND s.warehouse_id = ${q.warehouseId}` : sql``}
      ${q.lowOnly ? sql`AND s.qty < p.min_stock` : sql``}
      ORDER BY p.name, w.code`;
  });

  app.get("/stock/movements", async (req) => {
    const q = parse(z.object({ productId: id.optional(), from: date.optional(), to: date.optional(), limit: z.coerce.number().int().max(1000).default(200) }), req.query);
    return sql`
      SELECT m.*, p.sku, p.name AS product_name, w.code AS warehouse_code
      FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id
      WHERE true ${q.productId ? sql`AND m.product_id = ${q.productId}` : sql``}
      ${q.from ? sql`AND m.moved_at >= ${q.from}` : sql``} ${q.to ? sql`AND m.moved_at <= ${q.to}` : sql``}
      ORDER BY m.moved_at DESC, m.id DESC LIMIT ${q.limit}`;
  });

  app.post("/stock/adjustments", async (req, reply) => {
    const b = parse(z.object({ productId: id, warehouseId: id, qty: num, unitCost: num.optional(), reason: z.string().min(1), initial: z.boolean().default(false), date: date.optional() }), req.body);
    const r = await sql.begin((tx) => adjustStock(tx, b));
    return reply.code(201).send(r);
  });

  app.post("/stock/transfers", async (req, reply) => {
    const b = parse(z.object({ productId: id, fromWarehouseId: id, toWarehouseId: id, qty: num, label: z.string().optional(), date: date.optional() }), req.body);
    return reply.code(201).send(await sql.begin((tx) => transferStock(tx, b)));
  });

  app.get("/inventory-counts", async () => sql`SELECT c.*, w.code AS warehouse_code FROM inventory_counts c JOIN warehouses w ON w.id = c.warehouse_id ORDER BY c.id DESC`);
  app.post("/inventory-counts", async (req, reply) => {
    const b = parse(z.object({ warehouseId: id, label: z.string().min(1) }), req.body);
    const countId = await sql.begin((tx) => createInventoryCount(tx, b.warehouseId, b.label));
    return reply.code(201).send({ id: countId });
  });
  app.get("/inventory-counts/:id", async (req) => {
    const { id: countId } = parse(idParam, req.params);
    const [count] = await sql`SELECT * FROM inventory_counts WHERE id = ${countId}`;
    const lines = await sql`SELECT l.*, p.sku, p.name FROM inventory_count_lines l JOIN products p ON p.id = l.product_id WHERE l.count_id = ${countId} ORDER BY p.name`;
    return { ...count, lines };
  });
  app.put("/inventory-counts/:id/lines", async (req) => {
    const { id: countId } = parse(idParam, req.params);
    const b = parse(z.array(z.object({ productId: id, qtyCounted: num.nullable() })), req.body);
    await sql.begin(async (tx) => {
      for (const l of b) {
        await tx`UPDATE inventory_count_lines SET qty_counted = ${l.qtyCounted === null ? null : String(l.qtyCounted)}
                 WHERE count_id = ${countId} AND product_id = ${l.productId}
                 AND (SELECT status FROM inventory_counts WHERE id = ${countId}) = 'draft'`;
      }
    });
    return { ok: true };
  });
  app.post("/inventory-counts/:id/validate", async (req) => {
    const { id: countId } = parse(idParam, req.params);
    return sql.begin((tx) => validateInventoryCount(tx, countId));
  });
}
