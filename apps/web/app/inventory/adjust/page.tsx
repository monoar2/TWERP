"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Card, ErrorBox, Field, Notice, PageHeader, useAction, useData } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";

export default function AdjustPage() {
  const products = useData(() => api().products());
  const warehouses = useData(() => api().warehouses());
  const stockable = (products.data ?? []).filter((p) => p.type === "product");

  const [adj, setAdj] = useState({ productId: "", warehouseId: "", qty: "", unitCost: "", reason: "", initial: false });
  const [tr, setTr] = useState({ productId: "", fromWarehouseId: "", toWarehouseId: "", qty: "", label: "" });
  const [notice, setNotice] = useState("");
  const adjAction = useAction();
  const trAction = useAction();

  async function submitAdj(e: FormEvent) {
    e.preventDefault();
    const ok = await adjAction.run(() => api().adjustStock({
      productId: Number(adj.productId), warehouseId: Number(adj.warehouseId), qty: adj.qty,
      unitCost: adj.unitCost || undefined, reason: adj.reason || (adj.initial ? "Carga inicial" : "Ajuste"), initial: adj.initial,
    }));
    if (ok !== undefined) {
      setNotice(adj.initial ? "Carga inicial registrada (con su póliza contable)." : "Ajuste registrado (con su póliza contable).");
      setAdj((a) => ({ ...a, qty: "", unitCost: "", reason: "" }));
    }
  }
  async function submitTr(e: FormEvent) {
    e.preventDefault();
    const ok = await trAction.run(() => api().transferStock({
      productId: Number(tr.productId), fromWarehouseId: Number(tr.fromWarehouseId), toWarehouseId: Number(tr.toWarehouseId), qty: tr.qty, label: tr.label || undefined,
    }));
    if (ok !== undefined) {
      setNotice("Traspaso registrado.");
      setTr((t) => ({ ...t, qty: "", label: "" }));
    }
  }

  const productSelect = (value: string, onChange: (v: string) => void) => (
    <select required value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Selecciona…</option>
      {stockable.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
    </select>
  );
  const warehouseSelect = (value: string, onChange: (v: string) => void) => (
    <select required value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Selecciona…</option>
      {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
    </select>
  );

  return (
    <>
      <PageHeader title="Ajustes y traspasos" subtitle="Cada ajuste genera su póliza; las entradas recalculan el costo promedio" />
      <InventoryNav />
      <Notice>{notice}</Notice>
      <ErrorBox error={products.error ?? warehouses.error} />
      <div className="grid grid-2">
        <Card title="Ajuste de inventario">
          <form onSubmit={submitAdj}>
            <div className="form-grid">
              <Field label="Producto" wide>{productSelect(adj.productId, (v) => setAdj({ ...adj, productId: v }))}</Field>
              <Field label="Almacén">{warehouseSelect(adj.warehouseId, (v) => setAdj({ ...adj, warehouseId: v }))}</Field>
              <Field label="Cantidad" hint="Positiva = entrada, negativa = salida">
                <input required type="number" step="any" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} />
              </Field>
              <Field label="Costo unitario" hint="Requerido en entradas; las salidas usan el costo promedio">
                <input type="number" step="0.0001" min="0" value={adj.unitCost} onChange={(e) => setAdj({ ...adj, unitCost: e.target.value })} />
              </Field>
              <Field label="Motivo"><input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder={adj.initial ? "Carga inicial" : "Merma, donación, error de captura…"} /></Field>
              <Field label="Opciones" wide>
                <label className="checkbox"><input type="checkbox" checked={adj.initial} onChange={(e) => setAdj({ ...adj, initial: e.target.checked })} /> Carga inicial (saldo de apertura contra capital)</label>
              </Field>
            </div>
            <ErrorBox error={adjAction.error} />
            <div className="form-actions"><button className="btn btn-primary" disabled={adjAction.busy}>{adjAction.busy ? "Registrando…" : "Registrar ajuste"}</button></div>
          </form>
        </Card>
        <Card title="Traspaso entre almacenes">
          <form onSubmit={submitTr}>
            <div className="form-grid">
              <Field label="Producto" wide>{productSelect(tr.productId, (v) => setTr({ ...tr, productId: v }))}</Field>
              <Field label="Almacén origen">{warehouseSelect(tr.fromWarehouseId, (v) => setTr({ ...tr, fromWarehouseId: v }))}</Field>
              <Field label="Almacén destino">{warehouseSelect(tr.toWarehouseId, (v) => setTr({ ...tr, toWarehouseId: v }))}</Field>
              <Field label="Cantidad"><input required type="number" step="any" min="0" value={tr.qty} onChange={(e) => setTr({ ...tr, qty: e.target.value })} /></Field>
              <Field label="Referencia"><input value={tr.label} onChange={(e) => setTr({ ...tr, label: e.target.value })} /></Field>
            </div>
            <ErrorBox error={trAction.error} />
            <div className="form-actions"><button className="btn btn-primary" disabled={trAction.busy}>{trAction.busy ? "Registrando…" : "Registrar traspaso"}</button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
