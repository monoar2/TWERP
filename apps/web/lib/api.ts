"use client";
import { createClient, type ErpClient, type SatCatalogs } from "@erp/client";

const STORAGE_KEY = "erp.settings";
export const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
export const DEFAULT_API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || "";

export interface ApiSettings { apiUrl: string; token: string }

export function loadSettings(): ApiSettings {
  let stored: Partial<ApiSettings> = {};
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw) stored = JSON.parse(raw) as Partial<ApiSettings>;
  } catch {
    /* localStorage unavailable or corrupt: use defaults */
  }
  return { apiUrl: stored.apiUrl || DEFAULT_API_URL, token: stored.token ?? DEFAULT_API_TOKEN };
}

export function saveSettings(s: Partial<ApiSettings>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  cached = null;
  catalogs = null;
}

let cached: { key: string; client: ErpClient } | null = null;

/** Returns the API client built from env defaults or the user's overrides. */
export function api(): ErpClient {
  const s = loadSettings();
  const key = `${s.apiUrl}|${s.token}`;
  if (!cached || cached.key !== key) cached = { key, client: createClient({ baseUrl: s.apiUrl, token: s.token || undefined }) };
  return cached.client;
}

let catalogs: Promise<SatCatalogs> | null = null;
/** SAT catalogs rarely change; cache them for the session. */
export function satCatalogs(): Promise<SatCatalogs> {
  if (!catalogs) {
    catalogs = api().satCatalogs();
    catalogs.catch(() => { catalogs = null; });
  }
  return catalogs;
}

/** Downloads a file from the API sending the bearer token, then saves it via a blob link. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const s = loadSettings();
  const res = await fetch(api().url(path), { headers: s.token ? { authorization: `Bearer ${s.token}` } : {} });
  if (!res.ok) {
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
