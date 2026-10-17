import type { AiQuery, ErpClient } from "@erp/client";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Theme } from "../theme";
import { Button, Card, ErrorText } from "../ui";

interface Turn {
  role: "user" | "assistant";
  content: string;
  queries?: AiQuery[];
}

const EXAMPLES = ["¿Qué productos están bajo el mínimo?", "¿Cuánto vendí este mes y a qué clientes?", "¿Cuál es mi IVA por pagar del mes?"];

export function AskScreen({ api, t }: { api: ErpClient; t: Theme }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const scroll = useRef<ScrollView>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setQuestion("");
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    try {
      const r = await api.askAi(text, history);
      setTurns((prev) => [...prev, { role: "assistant", content: r.answer, queries: r.queries }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16 }}>
        {turns.length === 0 ? (
          <View>
            <Text style={{ color: t.muted, marginBottom: 8 }}>Pregunta lo que quieras sobre tu inventario, ventas o contabilidad.</Text>
            {EXAMPLES.map((e) => (
              <Pressable key={e} onPress={() => ask(e)} style={{ paddingVertical: 10 }}>
                <Text style={{ color: t.accent }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {turns.map((turn, i) => (
          <Card t={t} key={i}>
            <Text style={{ color: t.muted, fontSize: 12, marginBottom: 4 }}>{turn.role === "user" ? "Tú" : "ERP IA"}</Text>
            <Text style={{ color: t.text }} selectable>{turn.content}</Text>
            {turn.queries?.length ? (
              <Pressable onPress={() => setOpen(open === i ? null : i)} style={{ marginTop: 8 }}>
                <Text style={{ color: t.accent, fontSize: 13 }}>{open === i ? "Ocultar" : "Ver"} consultas SQL ({turn.queries.length})</Text>
              </Pressable>
            ) : null}
            {open === i
              ? turn.queries?.map((q, j) => (
                  <View key={j} style={{ marginTop: 6 }}>
                    <Text style={{ color: t.muted, fontSize: 12 }}>{q.purpose}</Text>
                    <Text style={{ color: t.text, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 12 }} selectable>{q.sql}</Text>
                    <Text style={{ color: q.error ? t.danger : t.muted, fontSize: 12 }}>{q.error ?? `${q.rowCount} filas`}</Text>
                  </View>
                ))
              : null}
          </Card>
        ))}
        <ErrorText t={t} error={error} />
      </ScrollView>
      <View style={{ flexDirection: "row", padding: 12, gap: 8, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="Escribe tu pregunta"
          placeholderTextColor={t.muted}
          onSubmitEditing={() => ask(question)}
          returnKeyType="send"
          style={{ flex: 1, color: t.text, borderColor: t.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 }}
        />
        <Button t={t} title={busy ? "…" : "Preguntar"} onPress={() => ask(question)} disabled={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}
