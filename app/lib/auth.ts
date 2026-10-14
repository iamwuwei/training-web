import type { ApiUser } from "../types/api";
import { config, useMock } from "./config";

const TOKEN_KEY = "training-web.token";
const USER_KEY = "training-web.user";

const safe = <T>(fn: () => T, fallback: T): T => {
  try { return fn(); } catch { return fallback; }
};

export const MOCK_USER: ApiUser = { id: "mock", display_name: "Wei Wu" };

/** Session token to send as Bearer, or null when not logged in. */
export function getToken(): string | null {
  if (useMock) return "mock";
  if (config.devToken) return config.devToken;
  return safe(() => localStorage.getItem(TOKEN_KEY), null);
}

export function getUser(): ApiUser | null {
  if (useMock) return MOCK_USER;
  const raw = safe(() => localStorage.getItem(USER_KEY), null);
  if (!raw) return null;
  return safe(() => JSON.parse(raw) as ApiUser, null);
}

export function setSession(token: string, user: ApiUser): void {
  safe(() => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }, undefined);
}

export function clearSession(): void {
  safe(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, undefined);
}
