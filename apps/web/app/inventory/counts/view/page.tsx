"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { qty } from "@/lib/format";
import { Card, ErrorBox, Loading, Notice, PageHeader, StatusChip, useAction, useData } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";

function CountInner() {
  const id = Number(useSearchParams().get("id"));
  const count = useData(() => api().inventoryCount(id), [id]);
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState("");
  const action = useAction();

  useEffect(() => {
    if (count.data) setCounted(Object.fromEntries(count.data.lines.map((l) => [l.product_id, l.qty_counted ?? ""])));
  }, [count.data]);

  if (!id) return <ErrorBox error={new Error("Falta el parámetro id")} />;
  if (count.loading && !count.data) return <Loading />;
  if (!count.data) return <ErrorBox error={count.error} />;
  const c = count.data;
  const editable = c.status === "draft";

  async function save() {
    const lines = c.lines.map((l) => ({ productId: l.product_id, qtyCounted: counted[l.product_id] === "" || counted[l.product_id] === undefined ? null : counted[l.product_id]! }));
    const ok = await action.run(() => api().setCountLines(id, lines));
    if (ok !== undefined) { setNotice("Cantidades guardadas."); void count.reload(); }
  }
  async function validate() {
    if (!window.confirm("¿Validar el conteo? Se generarán ajustes de inventario y pólizas por las diferencias.")) return;
    const saved = await action.run(async () => {
      await api().setCountLines(id, c.lines.map((l) => ({ productId: l.product_id, qtyCounted: counted[l.product_id] === "" || counted[l.product_id] === undefined ? null : counted[l.product_id]! })));
      return api().validateCount(id);
    });
    if (saved) { setNotice(`Conteo validado: ${saved.adjustments.length} ajuste(s) generados.`); void count.reload(); }
  }
  const pending = c.lines.filter((l) => (counted[l.product_id] ?? "") === "").length;

  return (
    <>
      <PageHeader title={c.label} subtitle={<>Conteo #{c.id} · <StatusChip status={c.status} /></>}
        actions={editable ? <>
          <button className="btn" onClick={save} disabled={action.busy}>Guardar cantidades</button>
          <button className="btn btn-primary" onClick={validate} disabled={action.busy}>Validar conteo</button>
        </> : <Link className="btn" href="/inventory/movements/">Ver kárdex</Link>} />
      <Notice>{notice}</Notice>
      <ErrorBox error={action.error ?? count.error} />
      <Card title="Productos" actions={editable ? <span className="muted small">{pending} sin capturar (se ignoran al validar)</span> : null}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>Producto</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferencia</th></tr></thead>
            <tbody>
              {c.lines.map((l) => {
                const v = counted[l.product_id] ?? "";
                const diff = v === "" ? null : Number(v) - Number(l.qty_expected);
                return (
                  <tr key={l.product_id}>
                    <td className="mono">{l.sku}</td><td>{l.name}</td><td className="num">{qty(l.qty_expected, 4)}</td>
                    <td className="num">
                      {editable ? (
                        <input type="number" step="any" min="0" value={v} style={{ maxWidth: 120, textAlign: "right" }}
                          onChange={(e) => setCounted((s) => ({ ...s, [l.product_id]: e.target.value }))} />
                      ) : (l.qty_counted == null ? "—" : qty(l.qty_counted, 4))}
                    </td>
                    <td className={`num ${diff && diff < 0 ? "tone-danger" : diff && diff > 0 ? "tone-success" : ""}`}>{diff == null ? "" : qty(diff, 4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export default function CountViewPage() {
  return (
    <>
      <InventoryNav />
      <Suspense fallback={<Loading />}><CountInner /></Suspense>
    </>
  );
}
