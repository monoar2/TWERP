"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { money, qty } from "@/lib/format";
import { Card, Empty, ErrorBox, Field, Loading, PageHeader, useData } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";

function StockInner() {
  const params = useSearchParams();
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [lowOnly, setLowOnly] = useState(params.get("low") === "1");
  const warehouses = useData(() => api().warehouses());
  const stock = useData(() => api().stock({ warehouseId: warehouseId || undefined, lowOnly: lowOnly || undefined }), [warehouseId, lowOnly]);
  const total = (stock.data ?? []).reduce((s, r) => s + Number(r.value), 0);

  return (
    <Card>
      <div className="inline-fields" style={{ marginBottom: 12 }}>
        <Field label="Almacén">
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Todos</option>
            {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
        </Field>
        <label className="checkbox" style={{ paddingBottom: 8 }}>
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Solo bajo mínimo
        </label>
      </div>
      <ErrorBox error={stock.error ?? warehouses.error} />
      {stock.loading && !stock.data ? <Loading /> : null}
      {stock.data && stock.data.length === 0 ? <Empty>Sin existencias para este filtro.</Empty> : null}
      {stock.data && stock.data.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>Producto</th><th>Almacén</th><th className="num">Existencia</th><th className="num">Mínimo</th><th className="num">Costo promedio</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {stock.data.map((r) => (
                <tr key={`${r.product_id}-${r.warehouse_id}`} className={r.below_min ? "row-warning" : ""}>
                  <td className="mono">{r.sku}</td><td>{r.name}</td><td>{r.warehouse_code}</td>
                  <td className="num">{qty(r.qty, 4)}</td><td className="num">{qty(r.min_stock)}</td>
                  <td className="num">{money(r.avg_cost)}</td><td className="num">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={6}>Valor total</td><td className="num">{money(total)}</td></tr></tfoot>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

export default function StockPage() {
  return (
    <>
      <PageHeader title="Inventario" subtitle="Existencias por almacén valuadas a costo promedio ponderado" />
      <InventoryNav />
      <Suspense fallback={<Loading />}><StockInner /></Suspense>
    </>
  );
}
