"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { dateTime, today } from "@/lib/format";
import { Card, Empty, ErrorBox, Field, Loading, PageHeader, StatusChip, useAction, useData } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";

export default function CountsPage() {
  const router = useRouter();
  const counts = useData(() => api().inventoryCounts());
  const warehouses = useData(() => api().warehouses());
  const [warehouseId, setWarehouseId] = useState("");
  const [label, setLabel] = useState(`Inventario físico ${today()}`);
  const action = useAction();

  async function create(e: FormEvent) {
    e.preventDefault();
    const res = await action.run(() => api().createInventoryCount({ warehouseId: Number(warehouseId), label }));
    if (res) router.push(`/inventory/counts/view/?id=${res.id}`);
  }

  return (
    <>
      <PageHeader title="Inventario físico" subtitle="Conteos por almacén: captura lo contado y al validar se generan los ajustes" />
      <InventoryNav />
      <Card title="Nuevo conteo">
        <form onSubmit={create} className="inline-fields">
          <Field label="Almacén">
            <select required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Selecciona…</option>
              {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </Field>
          <Field label="Descripción"><input required value={label} onChange={(e) => setLabel(e.target.value)} style={{ minWidth: 260 }} /></Field>
          <button className="btn btn-primary" disabled={action.busy}>Crear conteo</button>
        </form>
        <ErrorBox error={action.error ?? warehouses.error} />
      </Card>
      <Card title="Conteos">
        <ErrorBox error={counts.error} />
        {counts.loading && !counts.data ? <Loading /> : null}
        {counts.data && counts.data.length === 0 ? <Empty>No hay conteos.</Empty> : null}
        {counts.data && counts.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Descripción</th><th>Almacén</th><th>Creado</th><th>Estado</th></tr></thead>
              <tbody>
                {counts.data.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/inventory/counts/view/?id=${c.id}`}>{c.id}</Link></td>
                    <td><Link href={`/inventory/counts/view/?id=${c.id}`}>{c.label}</Link></td>
                    <td>{c.warehouse_code}</td><td>{dateTime(c.created_at)}</td><td><StatusChip status={c.status} /></td>
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
