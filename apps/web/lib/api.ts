"use client";
import { createClient, type AuthProfile, type ErpClient, type SatCatalogs } from "@erp/client";

const SETTINGS_KEY = "erp.settings";
const SESSION_KEY = "erp.session";
export const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
export const LOGIN_PATH = "/login/";

export interface ApiSettings { apiUrl: string }
export interface Session { token: string; expiresAt?: string; profile: AuthProfile }

function readJson<T>(key: string): T | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; /* localStorage unavailable or corrupt */
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function loadSettings(): ApiSettings {
  const stored = readJson<Partial<ApiSettings>>(SETTINGS_KEY) ?? {};
  return { apiUrl: stored.apiUrl || DEFAULT_API_URL };
}

/** Saves the API URL override (empty = default). Changing the server ends the current session. */
export function saveSettings(s: Partial<ApiSettings>): void {
  const prev = loadSettings().apiUrl;
  writeJson(SETTINGS_KEY, s.apiUrl ? { apiUrl: s.apiUrl } : {});
  if (loadSettings().apiUrl !== prev) clearSession();
  resetCaches();
}

// ---------- Session ----------

type Listener = (s: Session | null) => void;
const listeners = new Set<Listener>();

/** Subscribes to session changes (login, logout, profile refresh, expiry). */
export function onSessionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function loadSession(): Session | null {
  const s = readJson<Session>(SESSION_KEY);
  return s && typeof s.token === "string" && s.profile?.user ? s : null;
}

export function saveSession(s: Session): void {
  writeJson(SESSION_KEY, s);
  resetCaches();
  listeners.forEach((fn) => fn(s));
}

/** Replaces the stored profile (e.g. after me()) keeping the token. */
export function updateProfile(profile: AuthProfile): void {
  const s = loadSession();
  if (s) saveSession({ ...s, profile });
}

export function clearSession(): void {
  const had = loadSession() !== null;
  writeJson(SESSION_KEY, null);
  resetCaches();
  if (had) listeners.forEach((fn) => fn(null));
}

/** Current path + query, to come back after logging in. */
export function currentLocation(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

/** URL of the login page that returns to `next` afterwards. */
export function loginHref(next = currentLocation()): string {
  const safe = next && next.startsWith("/") && !next.startsWith(LOGIN_PATH) && !next.startsWith("/login") ? next : "";
  return safe && safe !== "/" ? `${LOGIN_PATH}?next=${encodeURIComponent(safe)}` : LOGIN_PATH;
}

/** Clears the session and sends the browser to the login page (used on any 401). */
export function handleUnauthorized(): void {
  clearSession();
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  window.location.assign(loginHref());
}

/** Ends the session on the server (best effort) and locally. */
export async function logout(): Promise<void> {
  try { await api().logout(); } catch { /* already expired or offline */ }
  clearSession();
}

// ---------- Client ----------

let cached: { key: string; client: ErpClient } | null = null;
let catalogs: Promise<SatCatalogs> | null = null;
function resetCaches() { cached = null; catalogs = null; }

/** Returns the API client for the configured server, authenticated with the current session. */
export function api(): ErpClient {
  const { apiUrl } = loadSettings();
  const token = loadSession()?.token ?? "";
  const key = `${apiUrl}|${token}`;
  if (!cached || cached.key !== key) {
    cached = { key, client: createClient({ baseUrl: apiUrl, token: token || undefined, onUnauthorized: handleUnauthorized }) };
  }
  return cached.client;
}

/** SAT catalogs rarely change; cache them for the session. */
export function satCatalogs(): Promise<SatCatalogs> {
  if (!catalogs) {
    catalogs = api().satCatalogs();
    catalogs.catch(() => { catalogs = null; });
  }
  return catalogs;
}

/** Downloads a file from the API sending the session token, then saves it via a blob link. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = loadSession()?.token;
  const res = await fetch(api().url(path), { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch { /* not JSON */ }
    throw new Error(message);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
