import { ApiError } from "@erp/client";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from "react-native";
import { makeClient, type Session } from "../api";
import type { Theme } from "../theme";
import { Button, Card, ErrorText } from "../ui";

export function LoginScreen({ t, initialBaseUrl, notice, onLogin }: { t: Theme; initialBaseUrl: string; notice?: string | null; onLogin: (s: Session) => void }) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = { color: t.text, borderColor: t.border, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 } as const;

  async function submit() {
    const url = baseUrl.trim().replace(/\/$/, "");
    if (!email.trim() || !password) { setError("Escribe tu correo y contraseña."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await makeClient(url).login(email.trim(), password);
      onLogin({ baseUrl: url, token: r.token, profile: { user: r.user, roleLabel: r.roleLabel, permissions: r.permissions } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `No se pudo conectar con ${url}. Revisa la dirección del servidor.`);
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 24, fontWeight: "700", marginBottom: 4 }}>Iniciar sesión</Text>
        <Text style={{ color: t.muted, marginBottom: 16 }}>Usa el correo y la contraseña que te dio el administrador.</Text>
        {notice ? <Text style={{ color: t.danger, marginBottom: 12 }}>{notice}</Text> : null}
        <Card t={t}>
          <Text style={{ color: t.muted, marginBottom: 4 }}>Correo electrónico</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" style={input} />
          <Text style={{ color: t.muted, marginBottom: 4 }}>Contraseña</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" textContentType="password" onSubmitEditing={submit} style={input} />
          <Text style={{ color: t.muted, marginBottom: 4 }}>Servidor (URL del API)</Text>
          <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={input} />
          <ErrorText t={t} error={error} />
          <Button t={t} title={busy ? "Entrando…" : "Entrar"} onPress={submit} disabled={busy} />
          <Text style={{ color: t.muted, fontSize: 12, marginTop: 10 }}>
            En un teléfono, usa la IP de tu computadora en la red local (por ejemplo http://192.168.1.10:4000), no localhost.
          </Text>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
