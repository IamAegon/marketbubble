// Kick OAuth 2.1 (Authorization Code + PKCE) — user access tokens for posting + moderating.
// Mirrors oauth-twitch.ts; the key difference is that Kick REQUIRES PKCE (S256).
// Credentials default from process.env but can be set at runtime from the admin UI
// (IntegrationStore.setKick → setKickCreds), so no .env / restart is needed.
import { createHash, randomBytes } from "node:crypto";

const creds = {
  clientId: process.env.KICK_CLIENT_ID || "",
  clientSecret: process.env.KICK_CLIENT_SECRET || "",
  redirectUri: process.env.KICK_REDIRECT_URI || "http://localhost:8787/api/connect/kick/callback",
};

/** override the app credentials at runtime (admin sets them in the UI) */
export function setKickCreds(c: { clientId?: string; clientSecret?: string; redirectUri?: string }): void {
  if (typeof c.clientId === "string") creds.clientId = c.clientId.trim();
  if (typeof c.clientSecret === "string") creds.clientSecret = c.clientSecret.trim();
  if (typeof c.redirectUri === "string" && c.redirectUri.trim()) creds.redirectUri = c.redirectUri.trim();
}

/** Scopes: identify the user, resolve channels, send chat, and moderate. */
export const KICK_SCOPES = ["user:read", "channel:read", "chat:write", "moderation:ban", "moderation:chat_message:manage"];

export const kickConfigured = (): boolean => !!creds.clientId && !!creds.clientSecret;
export const kickClientId = (): string => creds.clientId;
export const kickRedirectUri = (): string => creds.redirectUri;

const ID_BASE = "https://id.kick.com";
const API_BASE = "https://api.kick.com/public/v1";

// ---- PKCE helpers (S256) ----
const b64url = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const makeVerifier = (): string => b64url(randomBytes(32));
export const challengeOf = (verifier: string): string => b64url(createHash("sha256").update(verifier).digest());

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: creds.redirectUri,
    scope: KICK_SCOPES.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${ID_BASE}/oauth/authorize?${p.toString()}`;
}

export interface KickTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt?: number;
  scopes?: string[];
}

function tokenFromJson(j: any): KickTokens {
  return {
    accessToken: String(j.access_token),
    refreshToken: j.refresh_token ? String(j.refresh_token) : undefined,
    expiresAt: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : undefined,
    scopes:
      typeof j.scope === "string"
        ? j.scope.split(" ").filter(Boolean)
        : Array.isArray(j.scope)
          ? j.scope.map(String)
          : undefined,
  };
}

async function tokenRequest(body: Record<string, string>): Promise<KickTokens> {
  const r = await fetch(`${ID_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`kick token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return tokenFromJson(await r.json());
}

export const exchangeCode = (code: string, codeVerifier: string): Promise<KickTokens> =>
  tokenRequest({ code, grant_type: "authorization_code", redirect_uri: creds.redirectUri, code_verifier: codeVerifier });

export const refreshToken = (token: string): Promise<KickTokens> =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: token });

// app (client-credentials) token for server-side public reads (channel resolution,
// live viewer counts). Cached until ~1min before expiry; null when unconfigured.
let appCache: { token: string; expiresAt: number } | null = null;
export async function appToken(): Promise<string | null> {
  if (!kickConfigured()) return null;
  if (appCache && appCache.expiresAt > Date.now() + 60_000) return appCache.token;
  try {
    const t = await tokenRequest({ grant_type: "client_credentials" });
    appCache = { token: t.accessToken, expiresAt: t.expiresAt ?? Date.now() + 3_600_000 };
    return appCache.token;
  } catch {
    return null;
  }
}

/** the token owner (no ids) → {id, login}; recorded at connect time to show who linked */
export async function getOwner(accessToken: string): Promise<{ id: string; login: string } | null> {
  const r = await fetch(`${API_BASE}/users`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  const u = j?.data?.[0];
  return u ? { id: String(u.user_id), login: String(u.name ?? u.username ?? "") } : null;
}
