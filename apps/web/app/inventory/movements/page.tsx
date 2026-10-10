"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { MOVEMENT_KINDS, dateTime, firstOfMonth, money, qty, today } from "@/lib/format";
import { Card, Empty, ErrorBox, Field, Loading, PageHeader, useData } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";

export default function MovementsPage() {
  const [productId, setProductId] = useState<number | "">("");
  const [from, setFrom] = useState(firstOfMonth().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(today());
  const products = useData(() => api().products());
  const moves = useData(() => api().movements({ productId: productId || undefined, from: from || undefined, to: to || undefined, limit: 500 }), [productId, from, to]);

  return (
    <>
      <PageHeader title="Kárdex" subtitle="Movimientos de inventario con costo unitario y costo promedio resultante" />
      <InventoryNav />
      <Card>
        <div className="inline-fields" style={{ marginBottom: 12 }}>
          <Field label="Producto">
            <select value={productId} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Todos</option>
              {(products.data ?? []).filter((p) => p.type === "product").map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </Field>
          <Field label="Desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <ErrorBox error={moves.error ?? products.error} />
        {moves.loading && !moves.data ? <Loading /> : null}
        {moves.data && moves.data.length === 0 ? <Empty>Sin movimientos en el periodo.</Empty> : null}
        {moves.data && moves.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>SKU</th><th>Producto</th><th>Almacén</th><th>Tipo</th><th className="num">Cantidad</th><th className="num">Costo unitario</th><th className="num">Costo prom. después</th><th>Referencia</th></tr></thead>
              <tbody>
                {moves.data.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{dateTime(m.moved_at)}</td><td className="mono">{m.sku}</td><td>{m.product_name}</td><td>{m.warehouse_code}</td>
                    <td>{MOVEMENT_KINDS[m.kind] ?? m.kind}</td>
                    <td className={`num ${Number(m.qty) < 0 ? "tone-danger" : "tone-success"}`}>{Number(m.qty) > 0 ? "+" : ""}{qty(m.qty, 4)}</td>
                    <td className="num">{money(m.unit_cost)}</td><td className="num">{money(m.avg_cost_after)}</td>
                    <td className="small">{m.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}
