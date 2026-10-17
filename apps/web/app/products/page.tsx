"use client";
import { useState, type FormEvent } from "react";
import { api, satCatalogs } from "@/lib/api";
import { money, qty } from "@/lib/format";
import { Card, Empty, ErrorBox, Field, Loading, Notice, PageHeader, useAction, useData } from "@/components/ui";

const emptyForm = {
  sku: "", name: "", type: "product" as "product" | "service", claveProdServ: "", claveUnidad: "H87", unitName: "Pieza",
  salePrice: "", purchasePrice: "", ivaRate: "0.160000", ivaFactor: "Tasa" as "Tasa" | "Exento", minStock: "0",
};

export default function ProductsPage() {
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [notice, setNotice] = useState("");
  const [prodServQ, setProdServQ] = useState("");
  const list = useData(() => api().products(q || undefined), [q]);
  const cats = useData(() => satCatalogs());
  const prodServ = useData(() => (prodServQ.length >= 3 ? api().searchProdServ(prodServQ) : Promise.resolve([])), [prodServQ]);
  const action = useAction();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const created = await action.run(() => api().createProduct({
      sku: form.sku.trim(), name: form.name.trim(), type: form.type, claveProdServ: form.claveProdServ, claveUnidad: form.claveUnidad,
      unitName: form.unitName || undefined, salePrice: form.salePrice || "0", purchasePrice: form.purchasePrice || "0",
      ivaRate: form.ivaFactor === "Exento" ? undefined : form.ivaRate, ivaFactor: form.ivaFactor, minStock: form.minStock || "0",
    }));
    if (created) {
      setNotice(`Producto ${created.sku} creado.`);
      setForm(emptyForm);
      setShowForm(false);
      void list.reload();
    }
  }

  return (
    <>
      <PageHeader title="Productos y servicios" actions={<button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cerrar" : "Nuevo producto"}</button>} />
      <Notice>{notice}</Notice>
      {showForm ? (
        <Card title="Nuevo producto o servicio">
          <form onSubmit={submit}>
            <div className="form-grid">
              <Field label="SKU"><input required value={form.sku} onChange={(e) => set("sku", e.target.value)} className="mono" /></Field>
              <Field label="Nombre"><input required value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Tipo">
                <select value={form.type} onChange={(e) => set("type", e.target.value as "product" | "service")}>
                  <option value="product">Producto (inventariable)</option><option value="service">Servicio</option>
                </select>
              </Field>
              <Field label="Clave producto/servicio SAT" hint="8 dígitos (c_ClaveProdServ)">
                <input required pattern="\d{8}" maxLength={8} value={form.claveProdServ} onChange={(e) => set("claveProdServ", e.target.value.replace(/\D/g, ""))} className="mono" list="prodserv-list" />
              </Field>
              <Field label="Buscar clave SAT" hint="Escribe al menos 3 letras">
                <input value={prodServQ} onChange={(e) => setProdServQ(e.target.value)} placeholder="p. ej. tornillo" />
              </Field>
              <Field label="Clave de unidad SAT">
                <select value={form.claveUnidad} onChange={(e) => {
                  const u = cats.data?.clavesUnidad.find((c) => c.code === e.target.value);
                  setForm((f) => ({ ...f, claveUnidad: e.target.value, unitName: u?.name ?? f.unitName }));
                }}>
                  {(cats.data?.clavesUnidad ?? [{ code: "H87", name: "Pieza" }]).map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}
                </select>
              </Field>
              <Field label="Nombre de unidad"><input value={form.unitName} onChange={(e) => set("unitName", e.target.value)} /></Field>
              <Field label="Precio de venta (sin IVA)"><input type="number" step="0.01" min="0" value={form.salePrice} onChange={(e) => set("salePrice", e.target.value)} /></Field>
              <Field label="Costo de compra"><input type="number" step="0.01" min="0" value={form.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} /></Field>
              <Field label="IVA">
                <select value={form.ivaFactor === "Exento" ? "exento" : form.ivaRate} onChange={(e) => {
                  if (e.target.value === "exento") setForm((f) => ({ ...f, ivaFactor: "Exento" }));
                  else setForm((f) => ({ ...f, ivaFactor: "Tasa", ivaRate: e.target.value }));
                }}>
                  <option value="0.160000">16 %</option><option value="0.080000">8 % (frontera)</option><option value="0.000000">0 %</option><option value="exento">Exento</option>
                </select>
              </Field>
              <Field label="Existencia mínima"><input type="number" step="any" min="0" value={form.minStock} onChange={(e) => set("minStock", e.target.value)} /></Field>
            </div>
            <datalist id="prodserv-list">
              {(prodServ.data ?? []).map((p) => <option key={p.code} value={p.code}>{p.description}</option>)}
            </datalist>
            {prodServ.data && prodServ.data.length > 0 ? (
              <div className="table-wrap" style={{ marginTop: 12, maxHeight: 200, overflowY: "auto" }}>
                <table>
                  <tbody>
                    {prodServ.data.map((p) => (
                      <tr key={p.code} style={{ cursor: "pointer" }} onClick={() => set("claveProdServ", p.code)}>
                        <td className="mono">{p.code}</td><td>{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <ErrorBox error={action.error ?? cats.error ?? prodServ.error} />
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="btn btn-primary" disabled={action.busy}>{action.busy ? "Guardando…" : "Guardar"}</button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card>
        <div className="inline-fields" style={{ marginBottom: 12 }}>
          <Field label="Buscar"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU o nombre" /></Field>
        </div>
        <ErrorBox error={list.error} />
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && list.data.length === 0 ? <Empty>No hay productos.</Empty> : null}
        {list.data && list.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>SKU</th><th>Nombre</th><th>Tipo</th><th>ClaveProdServ</th><th>Unidad</th><th className="num">Precio</th><th className="num">IVA</th><th className="num">Costo prom.</th><th className="num">Existencia</th></tr></thead>
              <tbody>
                {list.data.map((p) => {
                  const low = p.type === "product" && Number(p.total_qty) < Number(p.min_stock);
                  return (
                    <tr key={p.id} className={low ? "row-warning" : ""}>
                      <td className="mono">{p.sku}</td><td>{p.name}</td><td>{p.type === "product" ? "Producto" : "Servicio"}</td>
                      <td className="mono">{p.clave_prod_serv}</td><td>{p.clave_unidad} <span className="muted small">{p.unit_name}</span></td>
                      <td className="num">{money(p.sale_price)}</td>
                      <td className="num">{p.iva_factor === "Exento" ? "Exento" : `${qty(Number(p.iva_rate) * 100)} %`}</td>
                      <td className="num">{money(p.avg_cost)}</td>
                      <td className="num">{p.type === "product" ? qty(p.total_qty) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}
