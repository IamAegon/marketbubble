import type { StatsRange, StatsScope } from "@app/shared";
import { getToken } from "./auth";
import { statsQuery } from "./stats";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};

/** Turn a non-OK report response into a precise error: "<status> · <server message>".
 * The modal keys its guidance off the leading status, so a 401/429/500 each get the
 * right hint instead of the old catch-all "no TeX distribution" message. */
async function blobOrThrow(r: Response, what: string): Promise<Blob> {
  if (r.ok) return await r.blob();
  let detail = "";
  try {
    detail = ((await r.json()) as { error?: string })?.error ?? "";
  } catch {
    /* non-JSON body */
  }
  throw new Error(`${r.status} · ${detail || `${what} failed`}`);
}

/** Fetch the LaTeX-compiled analytics PDF for a range/scope/streamer as a Blob. */
export async function fetchReport(range: StatsRange, scope: StatsScope, streamer?: string): Promise<Blob> {
  const r = await fetch(`${API}/api/stats/report?${statsQuery(range, scope, streamer)}`, { headers: authH() });
  return blobOrThrow(r, "report");
}

/** Fetch the LaTeX-compiled PDF for a single recorded session. */
export async function fetchSessionReport(sessionId: string): Promise<Blob> {
  const r = await fetch(`${API}/api/sessions/report?id=${encodeURIComponent(sessionId)}`, { headers: authH() });
  return blobOrThrow(r, "session report");
}

/** Generate a LaTeX market-brief PDF from the current market state (mods/admins). */
export async function fetchMarketBrief(assets: unknown[], markets: unknown[]): Promise<Blob> {
  const r = await fetch(`${API}/api/market/report`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authH() },
    body: JSON.stringify({ assets, markets }),
  });
  return blobOrThrow(r, "brief");
}
