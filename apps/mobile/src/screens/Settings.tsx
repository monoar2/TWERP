import { ScrollView, Text } from "react-native";
import type { Session } from "../api";
import type { Theme } from "../theme";
import { Button, Card } from "../ui";

export function SettingsScreen({ t, session, onLogout, loggingOut }: { t: Theme; session: Session; onLogout: () => void; loggingOut?: boolean }) {
  const row = (label: string, value: string) => (
    <>
      <Text style={{ color: t.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 16, marginBottom: 10 }} selectable>{value}</Text>
    </>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card t={t}>
        {row("Usuario", session.profile.user.name)}
        {row("Correo", session.profile.user.email)}
        {row("Rol", session.profile.roleLabel)}
        {row("Servidor", session.baseUrl)}
        <Button t={t} title={loggingOut ? "Cerrando sesión…" : "Cerrar sesión"} onPress={onLogout} disabled={loggingOut} />
        <Text style={{ color: t.muted, fontSize: 12, marginTop: 10 }}>
          Para cambiar de servidor, cierra sesión y escribe la nueva dirección al iniciar sesión.
        </Text>
      </Card>
    </ScrollView>
  );
}
