// Twitch OAuth (Authorization Code grant) — user access tokens for posting + moderating.
// Credentials default from process.env but can be set at runtime from the admin UI
// (IntegrationStore.setTwitch → setTwitchCreds), so no .env / restart is needed.

const creds = {
  clientId: process.env.TWITCH_CLIENT_ID || "",
  clientSecret: process.env.TWITCH_CLIENT_SECRET || "",
  redirectUri: process.env.TWITCH_REDIRECT_URI || "http://localhost:8787/api/connect/twitch/callback",
};

/** override the app credentials at runtime (admin sets them in the UI) */
export function setTwitchCreds(c: { clientId?: string; clientSecret?: string; redirectUri?: string }): void {
  if (typeof c.clientId === "string") creds.clientId = c.clientId.trim();
  if (typeof c.clientSecret === "string") creds.clientSecret = c.clientSecret.trim();
  if (typeof c.redirectUri === "string" && c.redirectUri.trim()) creds.redirectUri = c.redirectUri.trim();
}

/** Scopes: send chat as the user + the core moderation surface + read follows. */
export const TWITCH_SCOPES = [
  "user:write:chat",
  "user:read:follows",
  "moderator:manage:banned_users",
  "moderator:manage:chat_messages",
  "moderator:manage:chat_settings",
];

export const twitchConfigured = (): boolean => !!creds.clientId && !!creds.clientSecret;
export const twitchClientId = (): string => creds.clientId;
export const twitchRedirectUri = (): string => creds.redirectUri;

export function buildAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: creds.redirectUri,
    scope: TWITCH_SCOPES.join(" "),
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${p.toString()}`;
}

export interface TwitchTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt?: number;
  scopes?: string[];
}

function tokenFromJson(j: any): TwitchTokens {
  return {
    accessToken: String(j.access_token),
    refreshToken: j.refresh_token ? String(j.refresh_token) : undefined,
    expiresAt: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : undefined,
    scopes: Array.isArray(j.scope) ? j.scope.map(String) : undefined,
  };
}

async function tokenRequest(body: Record<string, string>): Promise<TwitchTokens> {
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`twitch token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return tokenFromJson(await r.json());
}

export const exchangeCode = (code: string): Promise<TwitchTokens> =>
  tokenRequest({ code, grant_type: "authorization_code", redirect_uri: creds.redirectUri });

// app (client-credentials) token for server-side public reads (e.g. Get Streams).
// Cached until ~1min before expiry. Null when the app isn't configured.
let appToken: { token: string; expiresAt: number } | null = null;
export async function clientCredentialsToken(): Promise<string | null> {
  if (!twitchConfigured()) return null;
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.token;
  try {
    const t = await tokenRequest({ grant_type: "client_credentials" });
    appToken = { token: t.accessToken, expiresAt: t.expiresAt ?? Date.now() + 3_600_000 };
    return appToken.token;
  } catch {
    return null;
  }
}

export const refreshToken = (token: string): Promise<TwitchTokens> =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: token });

/** the token owner (no login param) → {id, login}; used at connect time to record who linked */
export async function getOwner(accessToken: string): Promise<{ id: string; login: string } | null> {
  const r = await fetch("https://api.twitch.tv/helix/users", {
    headers: { authorization: `Bearer ${accessToken}`, "client-id": creds.clientId },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  const u = j?.data?.[0];
  return u ? { id: String(u.id), login: String(u.login) } : null;
}
