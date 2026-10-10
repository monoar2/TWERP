import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { defaultConfig, makeClient, type ApiConfig } from "./api";
import { AskScreen } from "./screens/Ask";
import { DashboardScreen } from "./screens/Dashboard";
import { InvoicesScreen } from "./screens/Invoices";
import { SettingsScreen } from "./screens/Settings";
import { StockScreen } from "./screens/Stock";
import { useTheme } from "./theme";

const TABS = [
  { key: "home", label: "Inicio" },
  { key: "stock", label: "Inventario" },
  { key: "invoices", label: "Facturas" },
  { key: "ask", label: "IA" },
  { key: "settings", label: "Ajustes" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function App() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>("home");
  const [config, setConfig] = useState<ApiConfig>(defaultConfig);
  const api = useMemo(() => makeClient(config), [config]);
  const title = TABS.find((x) => x.key === tab)!.label;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <StatusBar style={t.dark ? "light" : "dark"} />
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 24, fontWeight: "700", paddingHorizontal: 16, paddingTop: 8 }}>{title}</Text>
        <View style={{ flex: 1 }}>
          {tab === "home" && <DashboardScreen api={api} t={t} />}
          {tab === "stock" && <StockScreen api={api} t={t} />}
          {tab === "invoices" && <InvoicesScreen api={api} t={t} />}
          {tab === "ask" && <AskScreen api={api} t={t} />}
          {tab === "settings" && <SettingsScreen t={t} config={config} onSave={(c) => { setConfig(c); setTab("home"); }} />}
        </View>
        <View accessibilityRole="tablist" style={{ flexDirection: "row", borderTopWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
          {TABS.map((x) => (
            <Pressable
              key={x.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === x.key }}
              onPress={() => setTab(x.key)}
              style={{ flex: 1, alignItems: "center", paddingVertical: 12, minHeight: 48 }}
            >
              <Text style={{ color: tab === x.key ? t.accent : t.muted, fontWeight: tab === x.key ? "700" : "400", fontSize: 13 }}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
