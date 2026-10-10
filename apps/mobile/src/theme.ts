import { useColorScheme } from "react-native";

export function useTheme() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    bg: dark ? "#0f1115" : "#f5f6f8",
    card: dark ? "#1a1d24" : "#ffffff",
    text: dark ? "#e8eaed" : "#1b1f24",
    muted: dark ? "#9aa0a6" : "#5f6368",
    border: dark ? "#2b2f38" : "#e3e5e8",
    accent: dark ? "#7aa7ff" : "#2457c5",
    danger: dark ? "#ff8a80" : "#c62828",
    ok: dark ? "#81c995" : "#1e7d32",
  };
}
export type Theme = ReturnType<typeof useTheme>;
