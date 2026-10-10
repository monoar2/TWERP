"use client";
import Link from "next/link";
import { api } from "@/lib/api";
import { money, qty } from "@/lib/format";
import { Card, Empty, ErrorBox, Kpi, Loading, PageHeader, useData } from "@/components/ui";

export default function DashboardPage() {
  const dash = useData(() => api().dashboard());
  const low = useData(() => api().stock({ lowOnly: true }));
  const company = useData(() => api().company());
  const d = dash.data;
  const name = company.data ? String(company.data.razon_social ?? "") : "";

  return (
    <>
      <PageHeader
        title="Inicio"
        subtitle={name ? `${name} · RFC ${String(company.data?.rfc ?? "")}` : "Resumen de tu empresa"}
        actions={<>
          <Link className="btn" href="/inventory/adjust/">Ajustar inventario</Link>
          <Link className="btn btn-primary" href="/invoices/new/">Nueva factura</Link>
        </>}
      />
      <ErrorBox error={dash.error} />
      {dash.loading && !d ? <Loading /> : null}
      {d ? (
        <div className="kpis">
          <Kpi label="Ventas del mes" value={money(d.sales_this_month)} hint="Subtotal timbrado" href="/invoices/" />
          <Kpi label="Por cobrar" value={money(d.receivables)} hint="Clientes" href="/invoices/" />
          <Kpi label="Por pagar" value={money(d.payables)} hint="Proveedores" href="/purchases/" />
          <Kpi label="Valor del inventario" value={money(d.inventory_value)} hint="Costo promedio" href="/inventory/" />
          <Kpi label="Bajo mínimo" value={d.low_stock_items} hint="Productos" href="/inventory/?low=1" tone={d.low_stock_items > 0 ? "warning" : undefined} />
          <Kpi label="Facturas en borrador" value={d.draft_invoices} hint="Sin timbrar" href="/invoices/?status=draft" />
        </div>
      ) : null}
      <div className="grid grid-2">
        <Card title="Productos más vendidos">
          {d && d.topProducts.length === 0 ? <Empty>Aún no hay ventas.</Empty> : null}
          {d && d.topProducts.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>SKU</th><th>Producto</th><th className="num">Cantidad</th><th className="num">Ventas</th></tr></thead>
                <tbody>
                  {d.topProducts.map((p) => (
                    <tr key={p.sku}><td className="mono">{p.sku}</td><td>{p.name}</td><td className="num">{qty(p.qty)}</td><td className="num">{money(p.sales)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
        <Card title="Existencias bajo mínimo" actions={<Link href="/inventory/?low=1">Ver todo</Link>}>
          <ErrorBox error={low.error} />
          {low.loading && !low.data ? <Loading /> : null}
          {low.data && low.data.length === 0 ? <Empty>Todo el inventario está por encima del mínimo.</Empty> : null}
          {low.data && low.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>SKU</th><th>Producto</th><th>Almacén</th><th className="num">Existencia</th><th className="num">Mínimo</th></tr></thead>
                <tbody>
                  {low.data.slice(0, 10).map((r) => (
                    <tr key={`${r.product_id}-${r.warehouse_id}`}>
                      <td className="mono">{r.sku}</td><td>{r.name}</td><td>{r.warehouse_code}</td>
                      <td className="num tone-warning">{qty(r.qty)}</td><td className="num">{qty(r.min_stock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
