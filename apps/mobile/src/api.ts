import { createClient, type AuthProfile, type ErpClient } from "@erp/client";

// On a phone, "localhost" is the phone itself: point this at your computer's LAN IP.
export const defaultBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

/** A signed-in session. Kept in memory only (no storage package installed), so the app asks to log in again after a restart. */
export interface Session {
  baseUrl: string;
  token: string;
  profile: AuthProfile;
}

export function makeClient(baseUrl: string, token?: string, onUnauthorized?: () => void): ErpClient {
  return createClient({ baseUrl: baseUrl.replace(/\/$/, ""), token, onUnauthorized });
}
