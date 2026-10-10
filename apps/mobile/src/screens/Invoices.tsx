import { formatMXN, type ErpClient } from "@erp/client";
import { FlatList, Text, View } from "react-native";
import type { Theme } from "../theme";
import { Card, ErrorText, Loading } from "../ui";
import { useLoad } from "../useLoad";

const STATUS: Record<string, string> = { draft: "Borrador", stamped: "Timbrada", cancelled: "Cancelada" };

export function InvoicesScreen({ api, t }: { api: ErpClient; t: Theme }) {
  const { data, error, loading, refresh } = useLoad(() => api.salesInvoices(), [api]);
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <ErrorText t={t} error={error} />
      {!data && loading ? <Loading t={t} /> : null}
      <FlatList
        data={data ?? []}
        refreshing={loading}
        onRefresh={refresh}
        keyExtractor={(i) => String(i.id)}
        ListEmptyComponent={!loading ? <Text style={{ color: t.muted }}>Sin facturas.</Text> : null}
        renderItem={({ item }) => {
          const due = Number(item.total) - Number(item.paid_amount);
          return (
            <Card t={t}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: t.text, fontWeight: "600" }}>{item.serie}-{item.folio ?? "borrador"}</Text>
                <Text style={{ color: item.status === "cancelled" ? t.danger : item.status === "stamped" ? t.ok : t.muted }}>{STATUS[item.status] ?? item.status}</Text>
              </View>
              <Text style={{ color: t.muted, fontSize: 13 }}>{item.customer_name} · {item.customer_rfc}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={{ color: t.text }}>{formatMXN(item.total)} · {item.metodo_pago}</Text>
                {item.status === "stamped" && due > 0 ? <Text style={{ color: t.danger }}>Saldo {formatMXN(due)}</Text> : null}
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}
