import { formatMXN, type ErpClient } from "@erp/client";
import { useMemo, useState } from "react";
import { FlatList, Switch, Text, TextInput, View } from "react-native";
import type { Theme } from "../theme";
import { Card, ErrorText, Loading } from "../ui";
import { useLoad } from "../useLoad";

export function StockScreen({ api, t }: { api: ErpClient; t: Theme }) {
  const [lowOnly, setLowOnly] = useState(false);
  const [q, setQ] = useState("");
  const { data, error, loading, refresh } = useLoad(() => api.stock({ lowOnly }), [api, lowOnly]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((r) => !term || r.name.toLowerCase().includes(term) || r.sku.toLowerCase().includes(term));
  }, [data, q]);
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <TextInput
        placeholder="Buscar por nombre o SKU"
        placeholderTextColor={t.muted}
        value={q}
        onChangeText={setQ}
        style={{ backgroundColor: t.card, color: t.text, borderColor: t.border, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
        <Switch value={lowOnly} onValueChange={setLowOnly} />
        <Text style={{ color: t.text, marginLeft: 8 }}>Sólo bajo mínimo</Text>
      </View>
      <ErrorText t={t} error={error} />
      {!data && loading ? <Loading t={t} /> : null}
      <FlatList
        data={rows}
        refreshing={loading}
        onRefresh={refresh}
        keyExtractor={(r) => `${r.product_id}-${r.warehouse_id}`}
        ListEmptyComponent={!loading ? <Text style={{ color: t.muted }}>Sin existencias.</Text> : null}
        renderItem={({ item }) => (
          <Card t={t}>
            <Text style={{ color: t.text, fontWeight: "600" }}>{item.name}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>{item.sku} · {item.warehouse_code}</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
              <Text style={{ color: item.below_min ? t.danger : t.text }}>{Number(item.qty)} pzas{item.below_min ? " · bajo mínimo" : ""}</Text>
              <Text style={{ color: t.text }}>{formatMXN(item.value)}</Text>
            </View>
          </Card>
        )}
      />
    </View>
  );
}
