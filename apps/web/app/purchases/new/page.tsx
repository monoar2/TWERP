"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { money, today } from "@/lib/format";
import { Card, ErrorBox, Field, PageHeader, useAction, useData } from "@/components/ui";

interface Line { key: number; kind: "product" | "account"; productId: string; accountId: string; description: string; qty: string; unitPrice: string; ivaRate: string; retIvaRate: string; retIsrRate: string }
let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, kind: "product", productId: "", accountId: "", description: "", qty: "1", unitPrice: "", ivaRate: "0.16", retIvaRate: "0", retIsrRate: "0" });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function NewPurchasePage() {
  const router = useRouter();
  const suppliers = useData(() => api().thirdParties({ role: "supplier" }));
  const products = useData(() => api().products());
  const accounts = useData(() => api().accounts());
  const warehouses = useData(() => api().warehouses());
  const [head, setHead] = useState({ thirdPartyId: "", warehouseId: "", supplierRef: "", uuid: "", issueDate: today(), metodoPago: "PUE" as "PUE" | "PPD" });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const action = useAction();
  const expenseAccounts = (accounts.data ?? []).filter((a) => a.postable && (a.kind === "expense" || a.kind === "cost" || a.kind === "asset"));
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const calc = lines.map((l) => {
    const base = r2(Number(l.qty || 0) * Number(l.unitPrice || 0));
    const iva = r2(base * Number(l.ivaRate || 0));
    const ret = r2(base * Number(l.retIvaRate || 0)) + r2(base * Number(l.retIsrRate || 0));
    return { base, iva, ret, total: r2(base + iva - ret) };
  });
  const t = calc.reduce((a, c) => ({ base: a.base + c.base, iva: a.iva + c.iva, ret: a.ret + c.ret, total: a.total + c.total }), { base: 0, iva: 0, ret: 0, total: 0 });

  async function save(validate: boolean) {
    const res = await action.run(async () => {
      const created = await api().createSupplierInvoice({
        thirdPartyId: Number(head.thirdPartyId), warehouseId: head.warehouseId ? Number(head.warehouseId) : undefined,
        supplierRef: head.supplierRef || undefined, uuid: head.uuid || undefined, issueDate: head.issueDate, metodoPago: head.metodoPago,
        lines: lines.map((l) => ({
          productId: l.kind === "product" && l.productId ? Number(l.productId) : undefined,
          accountId: l.kind === "account" && l.accountId ? Number(l.accountId) : undefined,
          description: l.description || undefined, qty: l.qty, unitPrice: l.unitPrice || "0",
          ivaRate: l.ivaRate, retIvaRate: l.retIvaRate !== "0" ? l.retIvaRate : undefined, retIsrRate: l.retIsrRate !== "0" ? l.retIsrRate : undefined,
        })),
      });
      if (validate) await api().validateSupplierInvoice(created.id);
      return created;
    });
    if (res) router.push(`/purchases/view/?id=${res.id}`);
  }

  return (
    <>
      <PageHeader title="Nueva factura de proveedor" subtitle="Compras de mercancía (entran al inventario) o gastos (a una cuenta contable)" />
      <ErrorBox error={suppliers.error ?? products.error ?? accounts.error ?? warehouses.error} />
      <Card title="Datos">
        <div className="form-grid">
          <Field label="Proveedor">
            <select required value={head.thirdPartyId} onChange={(e) => setHead({ ...head, thirdPartyId: e.target.value })}>
              <option value="">Selecciona…</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.rfc})</option>)}
            </select>
          </Field>
          <Field label="Almacén de entrada">
            <select value={head.warehouseId} onChange={(e) => setHead({ ...head, warehouseId: e.target.value })}>
              <option value="">Predeterminado</option>
              {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </Field>
          <Field label="Fecha"><input type="date" value={head.issueDate} onChange={(e) => setHead({ ...head, issueDate: e.target.value })} /></Field>
          <Field label="Método de pago">
            <select value={head.metodoPago} onChange={(e) => setHead({ ...head, metodoPago: e.target.value as "PUE" | "PPD" })}><option value="PUE">PUE</option><option value="PPD">PPD</option></select>
          </Field>
          <Field label="Folio del proveedor"><input value={head.supplierRef} onChange={(e) => setHead({ ...head, supplierRef: e.target.value })} /></Field>
          <Field label="UUID del CFDI recibido"><input className="mono" value={head.uuid} onChange={(e) => setHead({ ...head, uuid: e.target.value })} placeholder="xxxxxxxx-xxxx-…" /></Field>
        </div>
      </Card>
      <Card title="Conceptos" actions={<button className="btn btn-sm" onClick={() => setLines((ls) => [...ls, newLine()])}>+ Agregar concepto</button>}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tipo</th><th style={{ minWidth: 220 }}>Producto / cuenta</th><th>Descripción</th><th className="num">Cantidad</th><th className="num">Precio unit.</th><th>IVA</th><th>Ret. IVA</th><th>Ret. ISR</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td>
                    <select value={l.kind} onChange={(e) => setLine(l.key, { kind: e.target.value as Line["kind"] })}>
                      <option value="product">Mercancía</option><option value="account">Gasto</option>
                    </select>
                  </td>
                  <td>
                    {l.kind === "product" ? (
                      <select value={l.productId} onChange={(e) => {
                        const p = (products.data ?? []).find((x) => String(x.id) === e.target.value);
                        setLine(l.key, { productId: e.target.value, unitPrice: p ? String(Number(p.purchase_price)) : l.unitPrice, ivaRate: p ? (p.iva_factor === "Exento" ? "0" : String(Number(p.iva_rate))) : l.ivaRate });
                      }}>
                        <option value="">Selecciona…</option>
                        {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                      </select>
                    ) : (
                      <select value={l.accountId} onChange={(e) => setLine(l.key, { accountId: e.target.value })}>
                        <option value="">Selecciona…</option>
                        {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td><input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} /></td>
                  <td><input type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} style={{ width: 90, textAlign: "right" }} /></td>
                  <td><input type="number" step="0.0001" min="0" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} style={{ width: 110, textAlign: "right" }} /></td>
                  <td><select value={l.ivaRate} onChange={(e) => setLine(l.key, { ivaRate: e.target.value })}><option value="0.16">16%</option><option value="0.08">8%</option><option value="0">0%</option></select></td>
                  <td><select value={l.retIvaRate} onChange={(e) => setLine(l.key, { retIvaRate: e.target.value })}><option value="0">—</option><option value="0.106667">10.6667%</option><option value="0.04">4%</option><option value="0.16">16%</option></select></td>
                  <td><select value={l.retIsrRate} onChange={(e) => setLine(l.key, { retIsrRate: e.target.value })}><option value="0">—</option><option value="0.10">10%</option><option value="0.0125">1.25% (RESICO)</option></select></td>
                  <td className="num">{money(calc[i]!.total)}</td>
                  <td><button className="btn btn-ghost btn-sm" aria-label="Quitar" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="totals" style={{ marginTop: 14 }}>
          <div><span>Subtotal</span><span>{money(t.base)}</span></div>
          <div><span>IVA acreditable</span><span>{money(t.iva)}</span></div>
          {t.ret ? <div><span>Retenciones</span><span>-{money(t.ret)}</span></div> : null}
          <div className="grand"><span>Total</span><span>{money(t.total)}</span></div>
        </div>
      </Card>
      <ErrorBox error={action.error} />
      <div className="form-actions">
        <button className="btn" onClick={() => router.push("/purchases/")}>Cancelar</button>
        <button className="btn" disabled={!head.thirdPartyId || action.busy} onClick={() => save(false)}>Guardar borrador</button>
        <button className="btn btn-primary" disabled={!head.thirdPartyId || action.busy} onClick={() => save(true)}>Guardar y validar</button>
      </div>
    </>
  );
}
