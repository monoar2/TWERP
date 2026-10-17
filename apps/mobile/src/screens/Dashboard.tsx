import { formatMXN, type ErpClient } from "@erp/client";
import { RefreshControl, ScrollView, Text } from "react-native";
import type { Theme } from "../theme";
import { Card, ErrorText, Loading, Stat } from "../ui";
import { useLoad } from "../useLoad";

export function DashboardScreen({ api, t }: { api: ErpClient; t: Theme }) {
  const { data, error, loading, refresh } = useLoad(() => api.dashboard(), [api]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
      <ErrorText t={t} error={error} />
      {!data && loading ? <Loading t={t} /> : null}
      {data ? (
        <>
          <Stat t={t} label="Ventas del mes (sin IVA)" value={formatMXN(data.sales_this_month)} />
          <Stat t={t} label="Cuentas por cobrar" value={formatMXN(data.receivables)} />
          <Stat t={t} label="Cuentas por pagar" value={formatMXN(data.payables)} />
          <Stat t={t} label="Valor del inventario" value={formatMXN(data.inventory_value)} />
          <Stat t={t} label="Productos bajo mínimo" value={String(data.low_stock_items)} tone={data.low_stock_items > 0 ? "danger" : "ok"} />
          <Card t={t}>
            <Text style={{ color: t.text, fontWeight: "600", marginBottom: 6 }}>Más vendidos (90 días)</Text>
            {data.topProducts.length === 0 ? <Text style={{ color: t.muted }}>Sin ventas todavía.</Text> : null}
            {data.topProducts.map((p) => (
              <Text key={p.sku} style={{ color: t.text, paddingVertical: 3 }}>
                {p.name} · {Number(p.qty)} · {formatMXN(p.sales)}
              </Text>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
