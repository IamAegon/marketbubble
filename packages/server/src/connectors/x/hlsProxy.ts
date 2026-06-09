/**
 * X Live (Periscope/pscp.tv) HLS video proxy.
 *
 * X broadcast video is an HLS stream, but the pscp.tv CDN enforces hotlink
 * protection (requires `Referer: https://x.com/`) — a browser can't spoof that,
 * so direct hls.js playback from our origin is 403'd. We therefore proxy the
 * playlist + segments through our server (which sends the right Referer) and
 * rewrite every child URL to flow back through this proxy. CORS is open here.
 */

const REFERER = "https://x.com/";

function allowedHost(u: URL): boolean {
  return u.hostname === "pscp.tv" || u.hostname.endsWith(".pscp.tv");
}

/** Resolve a broadcast id to its master HLS playlist URL (no guest token needed). */
export async function resolveBroadcastMaster(broadcastId: string, userAgent: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://proxsee.pscp.tv/api/v2/accessVideoPublic?broadcast_id=${encodeURIComponent(broadcastId)}`,
      { headers: { "User-Agent": userAgent } },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { https_hls_url?: string; hls_url?: string; replay_url?: string };
    return j.https_hls_url || j.hls_url || j.replay_url || null;
  } catch {
    return null;
  }
}

export interface ProxyResult {
  status: number;
  contentType: string;
  /** text body for playlists */
  body?: string;
  /** binary body for media segments */
  buf?: Buffer;
}

function rewritePlaylist(text: string, base: URL, proxyPath: string): string {
  const proxy = (ref: string) => `${proxyPath}?u=${encodeURIComponent(new URL(ref, base).toString())}`;
  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        // rewrite URI="..." attributes (EXT-X-KEY / EXT-X-MEDIA / EXT-X-MAP)
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxy(uri)}"`);
      }
      return proxy(t); // a variant- or segment-URI line
    })
    .join("\n");
}

/** Fetch a pscp.tv playlist/segment with the right Referer; rewrite playlists. */
export async function proxyHls(absUrl: string, userAgent: string, proxyPath: string): Promise<ProxyResult> {
  let u: URL;
  try {
    u = new URL(absUrl);
  } catch {
    return { status: 400, contentType: "text/plain", body: "bad url" };
  }
  if (u.protocol !== "https:" || !allowedHost(u)) {
    return { status: 403, contentType: "text/plain", body: "forbidden host" };
  }
  let r: Response;
  try {
    r = await fetch(u, { headers: { "User-Agent": userAgent, Referer: REFERER, Origin: "https://x.com" } });
  } catch (e) {
    return { status: 502, contentType: "text/plain", body: String(e) };
  }
  const ct = r.headers.get("content-type") || "";
  const isPlaylist = ct.includes("mpegurl") || u.pathname.endsWith(".m3u8");
  if (isPlaylist) {
    const text = await r.text();
    return { status: r.status, contentType: "application/vnd.apple.mpegurl", body: rewritePlaylist(text, u, proxyPath) };
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, contentType: ct || "video/mp2t", buf };
}
