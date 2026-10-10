"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { MONTHS, money } from "@/lib/format";
import { Card, ErrorBox, Kpi, Loading, PageHeader, YearMonthPicker, useData } from "@/components/ui";
import { TaxesNav } from "@/components/TaxesNav";

export default function IvaPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const r = useData(() => api().ivaReport(year, month), [year, month]);
  const d = r.data;
  return (
    <>
      <PageHeader title="Impuestos" subtitle="Determinación mensual de IVA (flujo de efectivo: cobrado y pagado)" />
      <TaxesNav />
      <div style={{ marginBottom: 16 }}><YearMonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} /></div>
      <ErrorBox error={r.error} />
      {r.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <div className="kpis">
            <Kpi label="IVA a cargo" value={money(d.ivaACargo)} tone={Number(d.ivaACargo) > 0 ? "warning" : undefined} />
            <Kpi label="IVA a favor" value={money(d.ivaAFavor)} />
            <Kpi label="Retenciones de IVA a enterar" value={money(d.retencionesIvaAEnterar)} />
          </div>
          <Card title={`Cálculo de ${MONTHS[d.month - 1]} ${d.year}`}>
            <div className="totals" style={{ marginLeft: 0, maxWidth: 520 }}>
              <div><span>IVA causado (cobrado a clientes)</span><span>{money(d.ivaCausado)}</span></div>
              <div><span>(−) IVA retenido por clientes</span><span>{money(d.ivaRetenidoPorClientes)}</span></div>
              <div><span>(−) IVA acreditable (pagado a proveedores)</span><span>{money(d.ivaAcreditable)}</span></div>
              <div className="grand"><span>{Number(d.ivaAFavor) > 0 ? "Saldo a favor" : "IVA a cargo"}</span><span>{money(Number(d.ivaAFavor) > 0 ? d.ivaAFavor : d.ivaACargo)}</span></div>
              <div><span>Retenciones de IVA a enterar</span><span>{money(d.retencionesIvaAEnterar)}</span></div>
            </div>
            {d.note ? <p className="muted small" style={{ marginTop: 12 }}>{d.note}</p> : null}
          </Card>
        </>
      ) : null}
    </>
  );
}
