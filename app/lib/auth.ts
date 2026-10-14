// Cognito hosted-UI login: OAuth 2.0 authorization code + PKCE, done by hand.
// The ID token (not the access token) goes to the API as Bearer: the first
// call links the Cognito `sub` to a users row by the `email` claim.

import { config, useMock } from "./config";

/** Who is logged in, from the ID token claims (users.id and email come from GET /me). */
export interface SessionUser {
  sub: string;
  display_name: string;
}

const ID_KEY = "training-web.id_token";
const REFRESH_KEY = "training-web.refresh_token";
const PKCE_KEY = "training-web.pkce";

const safe = <T>(fn: () => T, fallback: T): T => {
  try { return fn(); } catch { return fallback; }
};

export const MOCK_USER: SessionUser = { sub: "mock", display_name: "Wei Wu" };

export class AuthError extends Error {}

// ---- token helpers ------------------------------------------------------------

interface Claims { sub?: string; email?: string; exp?: number; name?: string }

export function decodeClaims(jwt: string): Claims {
  return safe(() => {
    const payload = jwt.split(".")[1] ?? "";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    return JSON.parse(decodeURIComponent(Array.from(json, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""))) as Claims;
  }, {});
}

function storedIdToken(): string | null {
  return safe(() => localStorage.getItem(ID_KEY), null);
}

function expiresSoon(jwt: string): boolean {
  const exp = decodeClaims(jwt).exp;
  return !exp || exp * 1000 < Date.now() + 60_000;
}

/** Synchronous: is there any session at all? (May be expired; getIdToken refreshes.) */
export function hasSession(): boolean {
  if (useMock) return true;
  return !!storedIdToken();
}

/** A valid ID token for the API, refreshing through Cognito when it is about to expire. */
export async function getIdToken(): Promise<string | null> {
  if (useMock) return "mock";
  const id = storedIdToken();
  if (!id) return null;
  if (!expiresSoon(id)) return id;

  const refresh = safe(() => localStorage.getItem(REFRESH_KEY), null);
  if (!refresh) { clearSession(); return null; }
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
    saveTokens(t.id_token, refresh);
    return t.id_token;
  } catch {
    clearSession();
    return null;
  }
}

export function getUser(): SessionUser | null {
  if (useMock) return MOCK_USER;
  const id = storedIdToken();
  if (!id) return null;
  const c = decodeClaims(id);
  return { sub: c.sub ?? "", display_name: c.name ?? c.email ?? "" };
}

export function clearSession(): void {
  safe(() => { localStorage.removeItem(ID_KEY); localStorage.removeItem(REFRESH_KEY); }, undefined);
}

function saveTokens(idToken: string, refreshToken: string | null): void {
  safe(() => {
    localStorage.setItem(ID_KEY, idToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  }, undefined);
}

// ---- hosted-UI flow -----------------------------------------------------------

const redirectUri = () => `${window.location.origin}/`; // must equal a Cognito callback URL (CORS_ORIGIN + "/")

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function requireConfig(): void {
  if (!config.cognitoDomain || !config.cognitoClientId) {
    throw new AuthError("尚未設定 VITE_COGNITO_DOMAIN / VITE_COGNITO_CLIENT_ID");
  }
}

/** Send the browser to Cognito. Returns only if something is misconfigured. */
export async function startLogin(): Promise<void> {
  requireConfig();
  const verifier = randomString(48);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));

  const p = new URLSearchParams({
    client_id: config.cognitoClientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  if (config.cognitoIdp) p.set("identity_provider", config.cognitoIdp);
  window.location.assign(`${config.cognitoDomain}/oauth2/authorize?${p}`);
}

/**
 * If this URL is the Cognito callback (?code=…&state=…), exchange the code for
 * tokens and return true. Call before any auth check on the "/" route.
 */
export async function completeLogin(url: URL): Promise<boolean> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    const err = url.searchParams.get("error");
    if (err) throw new AuthError(url.searchParams.get("error_description") ?? err);
    return false;
  }
  requireConfig();
  const raw = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  const pkce = raw ? (JSON.parse(raw) as { verifier: string; state: string }) : null;
  if (!pkce || pkce.state !== state) throw new AuthError("登入狀態不符，請重新登入");

  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: pkce.verifier });
  saveTokens(t.id_token, t.refresh_token ?? null);
  return true;
}

interface TokenResponse { id_token: string; access_token: string; refresh_token?: string; expires_in: number }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: config.cognitoClientId, ...params });
  const res = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    let msg = `token ${res.status}`;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new AuthError(msg);
  }
  return (await res.json()) as TokenResponse;
}

/** Clear local tokens and end the Cognito session too. */
export function logout(): void {
  clearSession();
  if (useMock || !config.cognitoDomain) { window.location.assign("/login"); return; }
  const p = new URLSearchParams({ client_id: config.cognitoClientId, logout_uri: redirectUri() });
  window.location.assign(`${config.cognitoDomain}/logout?${p}`);
}
