"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Product } from "@erp/client";
import { api, satCatalogs } from "@/lib/api";
import { money } from "@/lib/format";
import { Card, ErrorBox, Field, PageHeader, useAction, useData } from "@/components/ui";

interface Line { key: number; productId: string; description: string; qty: string; unitPrice: string; discount: string }
let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, productId: "", description: "", qty: "1", unitPrice: "", discount: "" });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function NewInvoicePage() {
  const router = useRouter();
  const customers = useData(() => api().thirdParties({ role: "customer" }));
  const products = useData(() => api().products());
  const warehouses = useData(() => api().warehouses());
  const cats = useData(() => satCatalogs());
  const [head, setHead] = useState({ thirdPartyId: "", warehouseId: "", metodoPago: "PUE" as "PUE" | "PPD", formaPago: "03", usoCfdi: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const action = useAction();
  const [draftId, setDraftId] = useState<number | null>(null);

  const productById = useMemo(() => new Map((products.data ?? []).map((p) => [String(p.id), p] as [string, Product])), [products.data]);
  const customer = (customers.data ?? []).find((c) => String(c.id) === head.thirdPartyId);

  const computed = lines.map((l) => {
    const p = productById.get(l.productId);
    const price = l.unitPrice !== "" ? Number(l.unitPrice) : Number(p?.sale_price ?? 0);
    const importe = round2(Number(l.qty || 0) * price);
    const base = round2(importe - Number(l.discount || 0));
    const rate = p && p.iva_factor === "Tasa" ? Number(p.iva_rate) : 0;
    const iva = round2(base * rate);
    return { importe, discount: Number(l.discount || 0), base, iva, total: round2(base + iva), rate, exento: p?.iva_factor === "Exento" };
  });
  const totals = computed.reduce((a, c) => ({ importe: a.importe + c.importe, discount: a.discount + c.discount, iva: a.iva + c.iva, total: a.total + c.total }), { importe: 0, discount: 0, iva: 0, total: 0 });

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save(stamp: boolean) {
    const res = await action.run(async () => {
      const created = await api().createSalesInvoice({
        thirdPartyId: Number(head.thirdPartyId),
        warehouseId: head.warehouseId ? Number(head.warehouseId) : undefined,
        metodoPago: head.metodoPago,
        formaPago: head.metodoPago === "PPD" ? "99" : head.formaPago,
        usoCfdi: head.usoCfdi || undefined,
        notes: head.notes || undefined,
        lines: lines.filter((l) => l.productId || l.description).map((l) => ({
          productId: l.productId ? Number(l.productId) : undefined,
          description: l.description || undefined,
          qty: l.qty,
          unitPrice: l.unitPrice !== "" ? l.unitPrice : undefined,
          discount: l.discount !== "" ? l.discount : undefined,
        })),
      });
      if (stamp) {
        try {
          await api().issueSalesInvoice(created.id);
        } catch (e) {
          // The draft was saved; keep the error visible and offer to open it.
          setDraftId(created.id);
          throw e;
        }
      }
      return created;
    });
    if (res) router.push(`/invoices/view/?id=${res.id}`);
  }

  const canSave = Boolean(head.thirdPartyId && lines.some((l) => l.productId)) && !draftId;

  return (
    <>
      <PageHeader title="Nueva factura" subtitle="Captura el CFDI; guárdalo como borrador o timbra directamente" />
      <ErrorBox error={customers.error ?? products.error ?? warehouses.error ?? cats.error} />
      <Card title="Datos del comprobante">
        <div className="form-grid">
          <Field label="Cliente" hint={customer ? `${customer.rfc} · Régimen ${customer.regimen_fiscal} · C.P. ${customer.codigo_postal}` : undefined}>
            <select required value={head.thirdPartyId} onChange={(e) => {
              const c = (customers.data ?? []).find((x) => String(x.id) === e.target.value);
              setHead({ ...head, thirdPartyId: e.target.value, usoCfdi: c?.uso_cfdi ?? "" });
            }}>
              <option value="">Selecciona…</option>
              {(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.rfc})</option>)}
            </select>
          </Field>
          <Field label="Almacén de salida" hint="Para descontar inventario al timbrar">
            <select value={head.warehouseId} onChange={(e) => setHead({ ...head, warehouseId: e.target.value })}>
              <option value="">Predeterminado</option>
              {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </Field>
          <Field label="Método de pago">
            <select value={head.metodoPago} onChange={(e) => setHead({ ...head, metodoPago: e.target.value as "PUE" | "PPD" })}>
              <option value="PUE">PUE — Pago en una sola exhibición</option>
              <option value="PPD">PPD — Pago en parcialidades o diferido</option>
            </select>
          </Field>
          <Field label="Forma de pago" hint={head.metodoPago === "PPD" ? "Con PPD la forma de pago es 99 (Por definir)" : undefined}>
            <select value={head.metodoPago === "PPD" ? "99" : head.formaPago} disabled={head.metodoPago === "PPD"} onChange={(e) => setHead({ ...head, formaPago: e.target.value })}>
              {(cats.data?.formasPago ?? [{ code: "03", description: "Transferencia electrónica de fondos" }, { code: "99", description: "Por definir" }]).map((f) => <option key={f.code} value={f.code}>{f.code} — {f.description}</option>)}
            </select>
          </Field>
          <Field label="Uso CFDI">
            <select value={head.usoCfdi} onChange={(e) => setHead({ ...head, usoCfdi: e.target.value })}>
              <option value="">Del cliente</option>
              {(cats.data?.usosCfdi ?? []).map((u) => <option key={u.code} value={u.code}>{u.code} — {u.description}</option>)}
            </select>
          </Field>
          <Field label="Notas"><input value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Conceptos" actions={<button className="btn btn-sm" onClick={() => setLines((ls) => [...ls, newLine()])}>+ Agregar concepto</button>}>
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ minWidth: 220 }}>Producto</th><th>Descripción</th><th className="num">Cantidad</th><th className="num">Precio unit.</th><th className="num">Descuento</th><th className="num">Importe</th><th className="num">IVA</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const p = productById.get(l.productId);
                const c = computed[i]!;
                return (
                  <tr key={l.key}>
                    <td>
                      <select value={l.productId} onChange={(e) => setLine(l.key, { productId: e.target.value, unitPrice: "" })}>
                        <option value="">Selecciona…</option>
                        {(products.data ?? []).map((pr) => <option key={pr.id} value={pr.id}>{pr.sku} — {pr.name}</option>)}
                      </select>
                      {p ? <div className="muted small">{p.clave_prod_serv} · {p.clave_unidad}{p.type === "product" ? ` · Exist. ${Number(p.total_qty)}` : ""}</div> : null}
                    </td>
                    <td><input value={l.description} placeholder={p?.name ?? ""} onChange={(e) => setLine(l.key, { description: e.target.value })} /></td>
                    <td><input type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} style={{ width: 90, textAlign: "right" }} /></td>
                    <td><input type="number" step="0.01" min="0" value={l.unitPrice} placeholder={p ? String(Number(p.sale_price)) : ""} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} style={{ width: 110, textAlign: "right" }} /></td>
                    <td><input type="number" step="0.01" min="0" value={l.discount} placeholder="0" onChange={(e) => setLine(l.key, { discount: e.target.value })} style={{ width: 100, textAlign: "right" }} /></td>
                    <td className="num">{money(c.importe)}</td>
                    <td className="num">{c.exento ? "Exento" : money(c.iva)}</td>
                    <td><button className="btn btn-ghost btn-sm" aria-label="Quitar" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="totals" style={{ marginTop: 14 }}>
          <div><span>Subtotal</span><span>{money(totals.importe)}</span></div>
          <div><span>Descuento</span><span>{money(totals.discount)}</span></div>
          <div><span>IVA trasladado</span><span>{money(totals.iva)}</span></div>
          <div className="grand"><span>Total</span><span>{money(totals.total)}</span></div>
          <p className="muted small">Vista previa; el servidor calcula los importes definitivos.</p>
        </div>
      </Card>
      <ErrorBox error={action.error} />
      {draftId ? (
        <div className="alert alert-warning">
          El borrador se guardó pero no se pudo timbrar. <a href={`/invoices/view/?id=${draftId}`} onClick={(e) => { e.preventDefault(); router.push(`/invoices/view/?id=${draftId}`); }}>Abrir borrador</a> para corregir y reintentar.
        </div>
      ) : null}
      <div className="form-actions">
        <button className="btn" onClick={() => router.push("/invoices/")}>Cancelar</button>
        <button className="btn" disabled={!canSave || action.busy} onClick={() => save(false)}>Guardar borrador</button>
        <button className="btn btn-primary" disabled={!canSave || action.busy} onClick={() => save(true)}>{action.busy ? "Procesando…" : "Timbrar"}</button>
      </div>
    </>
  );
}
