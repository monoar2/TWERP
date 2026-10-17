"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, DEFAULT_API_URL, loadSession, loadSettings, saveSession, saveSettings } from "@/lib/api";
import { ErrorBox, Field } from "@/components/ui";

/** Where to go after logging in: the ?next= page if it is a local path, else home. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (loadSession()) { router.replace(nextPath()); return; }
    setApiUrl(loadSettings().apiUrl);
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = apiUrl.trim();
      saveSettings({ apiUrl: url && url !== DEFAULT_API_URL ? url.replace(/\/$/, "") : "" });
      const r = await api().login(email.trim(), password);
      saveSession({ token: r.token, expiresAt: r.expiresAt, profile: { user: r.user, roleLabel: r.roleLabel, permissions: r.permissions } });
      router.replace(nextPath());
    } catch (err) {
      if (err instanceof TypeError) {
        setShowServer(true);
        setError(new Error(`No se pudo conectar con el servidor ${loadSettings().apiUrl}. Revisa la dirección en «Servidor».`));
      } else {
        setError(err);
      }
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="card login-card">
        <div className="brand"><span className="brand-mark">E</span> ERP <small>México</small></div>
        <h1>Iniciar sesión</h1>
        <p className="muted small" style={{ margin: 0 }}>Usa el correo y la contraseña que te dio el administrador.</p>
        <form onSubmit={submit}>
          <Field label="Correo electrónico">
            <input type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Contraseña">
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
          <details className="server-box" open={showServer} onToggle={(e) => setShowServer(e.currentTarget.open)}>
            <summary>Servidor</summary>
            <Field label="URL de la API" hint={`Predeterminada: ${DEFAULT_API_URL}`}>
              <input className="mono" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder={DEFAULT_API_URL} autoCapitalize="none" spellCheck={false} />
            </Field>
          </details>
        </form>
      </section>
    </div>
  );
}
