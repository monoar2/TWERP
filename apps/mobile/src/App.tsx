import { StatusBar } from "expo-status-bar";
import { canAccess, type Area } from "@erp/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { defaultBaseUrl, makeClient, type Session } from "./api";
import { AskScreen } from "./screens/Ask";
import { DashboardScreen } from "./screens/Dashboard";
import { InvoicesScreen } from "./screens/Invoices";
import { LoginScreen } from "./screens/Login";
import { SettingsScreen } from "./screens/Settings";
import { StockScreen } from "./screens/Stock";
import { useTheme } from "./theme";

const TABS: ReadonlyArray<{ key: Tab; label: string; area: Area | null }> = [
  { key: "home", label: "Inicio", area: "common" },
  { key: "stock", label: "Inventario", area: "inventory" },
  { key: "invoices", label: "Facturas", area: "sales" },
  { key: "ask", label: "IA", area: "ai" },
  { key: "settings", label: "Ajustes", area: null },
];
type Tab = "home" | "stock" | "invoices" | "ask" | "settings";

export default function App() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>("home");
  // Session lives in memory only: the app has no storage package, so a restart asks to log in again.
  const [session, setSession] = useState<Session | null>(null);
  const [lastBaseUrl, setLastBaseUrl] = useState(defaultBaseUrl);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  // Any 401 (expired, revoked or deactivated user) goes back to the login screen.
  const expire = useCallback(() => {
    setLoginNotice("Tu sesión expiró o fue cerrada. Vuelve a iniciar sesión.");
    setSession(null);
  }, []);
  const api = useMemo(() => (session ? makeClient(session.baseUrl, session.token, expire) : null), [session?.baseUrl, session?.token, expire]);

  // Refresh the profile once per session: the role may have changed since the token was issued.
  useEffect(() => {
    if (!api) return;
    api.me().then((profile) => setSession((s) => (s ? { ...s, profile } : s))).catch(() => { /* 401 handled by expire */ });
  }, [api]);

  const tabs = session ? TABS.filter((x) => !x.area || canAccess(session.profile, x.area)) : [];
  const current = tabs.some((x) => x.key === tab) ? tab : (tabs[0]?.key ?? "settings");
  const title = TABS.find((x) => x.key === current)!.label;

  function login(s: Session) {
    setLastBaseUrl(s.baseUrl);
    setLoginNotice(null);
    setTab("home");
    setSession(s);
  }
  async function logout() {
    setLoggingOut(true);
    try { await api?.logout(); } catch { /* already expired or offline */ }
    setLoggingOut(false);
    setLoginNotice(null);
    setSession(null);
  }

  if (!session || !api) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <StatusBar style={t.dark ? "light" : "dark"} />
          <LoginScreen t={t} initialBaseUrl={lastBaseUrl} notice={loginNotice} onLogin={login} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <StatusBar style={t.dark ? "light" : "dark"} />
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 24, fontWeight: "700", paddingHorizontal: 16, paddingTop: 8 }}>{title}</Text>
        <View style={{ flex: 1 }}>
          {current === "home" && <DashboardScreen api={api} t={t} />}
          {current === "stock" && <StockScreen api={api} t={t} />}
          {current === "invoices" && <InvoicesScreen api={api} t={t} />}
          {current === "ask" && <AskScreen api={api} t={t} />}
          {current === "settings" && <SettingsScreen t={t} session={session} onLogout={logout} loggingOut={loggingOut} />}
        </View>
        <View accessibilityRole="tablist" style={{ flexDirection: "row", borderTopWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
          {tabs.map((x) => (
            <Pressable
              key={x.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: current === x.key }}
              onPress={() => setTab(x.key)}
              style={{ flex: 1, alignItems: "center", paddingVertical: 12, minHeight: 48 }}
            >
              <Text style={{ color: current === x.key ? t.accent : t.muted, fontWeight: current === x.key ? "700" : "400", fontSize: 13 }}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
