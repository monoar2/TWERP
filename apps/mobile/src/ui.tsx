import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Theme } from "./theme";

export function Card({ t, children }: { t: Theme; children: ReactNode }) {
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>{children}</View>;
}

export function Stat({ t, label, value, tone }: { t: Theme; label: string; value: string; tone?: "danger" | "ok" }) {
  return (
    <Card t={t}>
      <Text style={{ color: t.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: tone === "danger" ? t.danger : tone === "ok" ? t.ok : t.text, fontSize: 22, fontWeight: "600", marginTop: 4 }}>{value}</Text>
    </Card>
  );
}

export function Loading({ t }: { t: Theme }) {
  return <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} />;
}

export function ErrorText({ t, error }: { t: Theme; error: string | null }) {
  return error ? <Text style={{ color: t.danger, marginVertical: 8 }}>{error}</Text> : null;
}

export function Button({ t, title, onPress, disabled }: { t: Theme; title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, { backgroundColor: t.accent, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <Text style={{ color: "#fff", fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, marginBottom: 10 },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", minHeight: 44, justifyContent: "center" },
});
