import { useState } from "react";
import { ScrollView, Text, TextInput } from "react-native";
import type { ApiConfig } from "../api";
import type { Theme } from "../theme";
import { Button, Card } from "../ui";

export function SettingsScreen({ t, config, onSave }: { t: Theme; config: ApiConfig; onSave: (c: ApiConfig) => void }) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [token, setToken] = useState(config.token);
  const input = { color: t.text, borderColor: t.border, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 } as const;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card t={t}>
        <Text style={{ color: t.muted, marginBottom: 4 }}>URL del API</Text>
        <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={input} />
        <Text style={{ color: t.muted, marginBottom: 4 }}>Token</Text>
        <TextInput value={token} onChangeText={setToken} autoCapitalize="none" secureTextEntry style={input} />
        <Button t={t} title="Guardar" onPress={() => onSave({ baseUrl: baseUrl.trim(), token: token.trim() })} />
        <Text style={{ color: t.muted, fontSize: 12, marginTop: 10 }}>
          En un teléfono, usa la IP de tu computadora en la red local (por ejemplo http://192.168.1.10:4000), no localhost.
        </Text>
      </Card>
    </ScrollView>
  );
}
