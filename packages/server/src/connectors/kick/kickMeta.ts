import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { logger } from "../../observability/logger.js";

const execFileP = promisify(execFile);
const log = logger.child({ mod: "kickMeta" });

export interface KickChannelMeta {
  slug: string;
  chatroomId: number;
  isLive: boolean;
  displayName: string;
}

// chatroom_id is stable per channel → cache in memory AND on disk, so the slow,
// Cloudflare-gated headless-Chrome resolve runs once per channel ever and survives
// server restarts (otherwise every reload re-resolves and can get CF-throttled).
const cache = new Map<string, KickChannelMeta>();
const CACHE_PATH = resolve(process.cwd(), "data/kick-chatrooms.json");

function loadCache(): void {
  if (!existsSync(CACHE_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Record<string, { chatroomId: number; displayName: string }>;
    for (const [slug, v] of Object.entries(raw)) {
      if (v && typeof v.chatroomId === "number") {
        // isLive is time-sensitive, not persisted — the live poller owns that
        cache.set(slug, { slug, chatroomId: v.chatroomId, displayName: v.displayName || slug, isLive: false });
      }
    }
    log.info({ count: cache.size }, "loaded persisted kick chatroom ids");
  } catch (e) {
    log.warn({ err: String(e) }, "failed to read kick chatroom cache");
  }
}
loadCache();

function persistCache(): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    const obj: Record<string, { chatroomId: number; displayName: string }> = {};
    for (const [slug, m] of cache) obj[slug] = { chatroomId: m.chatroomId, displayName: m.displayName };
    writeFileSync(CACHE_PATH, JSON.stringify(obj, null, 2));
  } catch (e) {
    log.warn({ err: String(e) }, "failed to persist kick chatroom cache");
  }
}

/**
 * Resolve a Kick channel's chatroom_id past Cloudflare using a real headless
 * Chrome (legit TLS fingerprint). Validated: yields chatroom.id + live state.
 * The Pusher socket itself is not gated, so this runs once per channel.
 */
export async function resolveKickChannel(
  slug: string,
  chromeBin: string,
  userAgent: string,
): Promise<KickChannelMeta> {
  const cached = cache.get(slug);
  if (cached) return cached;

  const profile = await mkdtemp(join(tmpdir(), "kick-cf-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-agent=${userAgent}`,
    "--virtual-time-budget=20000",
    `--user-data-dir=${profile}`,
    "--dump-dom",
    `https://kick.com/api/v2/channels/${slug}`,
  ];

  log.info({ slug }, "resolving chatroom_id via headless Chrome (one-time, then cached to disk)");
  let stdout: string;
  try {
    ({ stdout } = await execFileP(chromeBin, args, {
      timeout: 45_000,
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (e) {
    log.error(
      { slug, chromeBin, err: String(e) },
      "kick resolve failed — headless Chrome errored (check KICK_CHROME_BIN / Chrome install / timeout)",
    );
    throw new Error(`kick: headless Chrome failed for "${slug}" — ${String(e)}`);
  }

  const clean = stdout.replace(/<[^>]*>/g, "");
  const idMatch = clean.match(/"chatroom":\{"id":(\d+)/);
  if (!idMatch) {
    log.error({ slug }, "kick resolve failed — chatroom_id not in response (likely a Cloudflare challenge)");
    throw new Error(`kick: chatroom_id not found for "${slug}" (Cloudflare block?)`);
  }

  const meta: KickChannelMeta = {
    slug,
    chatroomId: Number(idMatch[1]),
    isLive: /"livestream":\{/.test(clean),
    displayName: clean.match(/"username":"([^"]+)"/)?.[1] ?? slug,
  };
  cache.set(slug, meta);
  persistCache();
  log.info({ slug, chatroomId: meta.chatroomId, isLive: meta.isLive }, "resolved + cached to disk");
  return meta;
}
