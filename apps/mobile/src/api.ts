import { createClient, type ErpClient } from "@erp/client";

export interface ApiConfig {
  baseUrl: string;
  token: string;
}

// On a phone, "localhost" is the phone itself: point this at your computer's LAN IP.
export const defaultConfig: ApiConfig = {
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000",
  token: process.env.EXPO_PUBLIC_API_TOKEN ?? "",
};

export function makeClient(cfg: ApiConfig): ErpClient {
  return createClient({ baseUrl: cfg.baseUrl, token: cfg.token || undefined });
}
