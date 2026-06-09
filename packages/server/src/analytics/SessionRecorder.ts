import { readFileSync, existsSync, renameSync } from "node:fs";
import type { ChatMessage, Platform, SessionSummary } from "@app/shared";
import { scoreSentiment } from "../finance/Sentiment.js";
import type { StreamerRegistry } from "./streamers.js";
import type { Db } from "../store/db.js";
import { logger } from "../observability/logger.js";

const MINUTE = 60_000;
const MAX_MIN_BUCKETS = 24 * 60; // cap a session timeline at 24h of minutes
const MAX_CHATTERS = 4000;
const MAX_TAGS = 300;
const MAX_EMOTES = 300;
const MAX_HISTORY = 500; // keep the last N ended sessions on disk

interface PlatMin {
  twitch: number;
  x: number;
  kick: number;
  mb: number;
}

/** Live accumulation for one in-progress session. */
class Acc {
  messages = 0;
  byPlatform: Record<Platform, number> = { twitch: 0, x: 0, kick: 0, mb: 0 };
  mins = new Map<number, PlatMin>();
  chatters = new Map<string, { name: string; platform: Platform; count: number }>();
  emotes = new Map<string, { name: string; url: string; count: number }>();
  cashtags = new Map<string, number>();
  sent = new Map<number, { bull: number; bear: number }>();
}

/**
 * Mod-controlled recording sessions. A session captures one streamer's broadcast
 * from Start to Stop into a durable, immutable summary — the basis for historical
 * analytics + per-session reports. Independent of the live rolling aggregator.
 */
export class SessionRecorder {
  private active = new Map<string, { s: SessionSummary; acc: Acc }>();
  private recordingStreamers = new Set<string>();
  private history: SessionSummary[] = [];

  constructor(private readonly deps: { streamers: StreamerRegistry; db: Db; legacyJsonPath?: string }) {}

  /** Load ended-session history from the DB, importing the legacy sessions.json
   * once if present. Call after the DB is migrated, before serving. */
  async init(): Promise<void> {
    await this.importLegacyJson();
    try {
      const { rows } = await this.deps.db.query(`SELECT * FROM sessions ORDER BY started_at DESC LIMIT ${MAX_HISTORY}`);
      this.history = rows.map(rowToSession);
      logger.info({ sessions: this.history.length }, "loaded session history from DB");
    } catch (e) {
      logger.warn({ err: String(e) }, "failed to load session history");
    }
  }

  isRecording(streamerId: string): boolean {
    return this.recordingStreamers.has(streamerId);
  }

  /** fold an ingested message into every active session whose streamer matches */
  record(m: ChatMessage): void {
    // tracked-account posts, STT captions, and internal MB rooms are not a
    // streamer's live chat — never folded into a session's chat metrics
    if (m.kind === "post" || m.kind === "caption" || m.platform === "mb" || this.active.size === 0) return;
    const ref = this.deps.streamers.resolve(m.channel, m.channelLabel);
    for (const e of this.active.values()) {
      if (e.s.streamerId === ref.id) fold(e.acc, m);
    }
  }

  start(streamerId: string, by: string, xUrl?: string): { ok: boolean; error?: string; session?: SessionSummary } {
    const streamer = this.deps.streamers.get(streamerId);
    if (!streamer) return { ok: false, error: "unknown streamer" };
    if (this.recordingStreamers.has(streamerId)) return { ok: false, error: "already recording this streamer" };
    if (xUrl) {
      const m = xUrl.match(/broadcasts\/([A-Za-z0-9]+)/);
      const id = m ? m[1] : xUrl.trim();
      if (id) this.deps.streamers.assignChannel(streamerId, "x", `x:${id}`);
    }
    const now = Date.now();
    const session: SessionSummary = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      streamerId,
      streamerName: streamer.name,
      owned: streamer.owned,
      startedBy: by,
      startedAt: now,
      endedAt: null,
      status: "recording",
      durationMs: 0,
      messages: 0,
      chatters: 0,
      avgPerMin: 0,
      peakPerMin: 0,
      peakAt: now,
      net: 0,
      byPlatform: { twitch: 0, x: 0, kick: 0, mb: 0 },
      topChatters: [],
      topEmotes: [],
      topCashtags: [],
      activity: [],
      sentiment: [],
    };
    this.active.set(session.id, { s: session, acc: new Acc() });
    this.recordingStreamers.add(streamerId);
    logger.info({ session: session.id, streamer: streamerId, by }, "recording started");
    return { ok: true, session };
  }

  async stop(sessionId: string): Promise<{ ok: boolean; error?: string; session?: SessionSummary }> {
    const e = this.active.get(sessionId);
    if (!e) return { ok: false, error: "no such active session" };
    const finalized = finalize(e.s, e.acc, false);
    this.active.delete(sessionId);
    this.recordingStreamers.delete(e.s.streamerId);
    this.history.unshift(finalized);
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    await this.upsert(finalized);
    logger.info({ session: sessionId, messages: finalized.messages }, "recording stopped + saved");
    return { ok: true, session: finalized };
  }

  /** finalize any active recordings into the DB — called on shutdown so a
   * SIGTERM/SIGINT mid-broadcast doesn't lose the in-flight session. */
  async shutdown(): Promise<void> {
    if (this.active.size === 0) return;
    const finals: SessionSummary[] = [];
    for (const e of this.active.values()) {
      const f = finalize(e.s, e.acc, false);
      finals.push(f);
      this.history.unshift(f);
      this.recordingStreamers.delete(e.s.streamerId);
    }
    this.active.clear();
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    for (const f of finals) await this.upsert(f);
    logger.info({ count: finals.length }, "active recordings finalized on shutdown");
  }

  /** active sessions (live metrics) followed by ended history, newest first */
  list(): SessionSummary[] {
    const live = [...this.active.values()].map((e) => finalize(e.s, e.acc, true));
    return [...live, ...this.history];
  }

  /** one session by id (active → finalized-live, or from ended history) */
  get(id: string): SessionSummary | undefined {
    const a = this.active.get(id);
    if (a) return finalize(a.s, a.acc, true);
    return this.history.find((s) => s.id === id);
  }

  /** the open session id for a streamer, if any (used by the auto-session driver) */
  activeSessionIdForStreamer(streamerId: string): string | undefined {
    for (const e of this.active.values()) if (e.s.streamerId === streamerId) return e.s.id;
    return undefined;
  }

  /** the open session for a channel, if any (resolves channel→streamer→active) —
   * used to FK live captions to the session they belong to */
  activeSessionFor(channel: string, channelLabel: string): { sessionId: string; streamerId: string } | undefined {
    if (this.active.size === 0) return undefined;
    const ref = this.deps.streamers.resolve(channel, channelLabel);
    for (const e of this.active.values()) {
      if (e.s.streamerId === ref.id) return { sessionId: e.s.id, streamerId: ref.id };
    }
    return undefined;
  }

  /** upsert one session row (insert on start/stop, update live snapshot on stop) */
  private async upsert(s: SessionSummary): Promise<void> {
    try {
      await this.deps.db.query(
        `INSERT INTO sessions (id, streamer_id, streamer_name, owned, started_by, started_at, ended_at, status,
           duration_ms, messages, chatters, avg_per_min, peak_per_min, peak_at, net, by_platform,
           top_chatters, top_emotes, top_cashtags, activity, sentiment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (id) DO UPDATE SET
           ended_at=EXCLUDED.ended_at, status=EXCLUDED.status, duration_ms=EXCLUDED.duration_ms,
           messages=EXCLUDED.messages, chatters=EXCLUDED.chatters, avg_per_min=EXCLUDED.avg_per_min,
           peak_per_min=EXCLUDED.peak_per_min, peak_at=EXCLUDED.peak_at, net=EXCLUDED.net,
           by_platform=EXCLUDED.by_platform, top_chatters=EXCLUDED.top_chatters, top_emotes=EXCLUDED.top_emotes,
           top_cashtags=EXCLUDED.top_cashtags, activity=EXCLUDED.activity, sentiment=EXCLUDED.sentiment`,
        [
          s.id, s.streamerId, s.streamerName, s.owned, s.startedBy, s.startedAt, s.endedAt, s.status,
          s.durationMs, s.messages, s.chatters, s.avgPerMin, s.peakPerMin, s.peakAt, s.net,
          JSON.stringify(s.byPlatform), JSON.stringify(s.topChatters), JSON.stringify(s.topEmotes),
          JSON.stringify(s.topCashtags), JSON.stringify(s.activity), JSON.stringify(s.sentiment),
        ],
      );
    } catch (e) {
      logger.warn({ err: String(e), session: s.id }, "failed to persist session");
    }
  }

  /** one-time migration of the legacy data/analytics/sessions.json into the DB */
  private async importLegacyJson(): Promise<void> {
    const p = this.deps.legacyJsonPath;
    if (!p || !existsSync(p)) return;
    try {
      const legacy = JSON.parse(readFileSync(p, "utf8")) as SessionSummary[];
      for (const s of legacy) await this.upsert(s);
      renameSync(p, `${p}.imported`);
      logger.info({ imported: legacy.length }, "imported legacy sessions.json into DB");
    } catch (e) {
      logger.warn({ err: String(e) }, "legacy sessions.json import failed");
    }
  }
}

function rowToSession(r: any): SessionSummary {
  return {
    id: r.id,
    streamerId: r.streamer_id,
    streamerName: r.streamer_name,
    owned: !!r.owned,
    startedBy: r.started_by,
    startedAt: Number(r.started_at),
    endedAt: r.ended_at != null ? Number(r.ended_at) : null,
    status: r.status as SessionSummary["status"],
    durationMs: Number(r.duration_ms ?? 0),
    messages: Number(r.messages ?? 0),
    chatters: Number(r.chatters ?? 0),
    avgPerMin: Number(r.avg_per_min ?? 0),
    peakPerMin: Number(r.peak_per_min ?? 0),
    peakAt: Number(r.peak_at ?? 0),
    net: Number(r.net ?? 0),
    byPlatform: r.by_platform ?? { twitch: 0, x: 0, kick: 0, mb: 0 },
    topChatters: r.top_chatters ?? [],
    topEmotes: r.top_emotes ?? [],
    topCashtags: r.top_cashtags ?? [],
    activity: r.activity ?? [],
    sentiment: r.sentiment ?? [],
  };
}

function fold(acc: Acc, m: ChatMessage): void {
  const p = m.platform;
  const t = m.receivedAt || Date.now();
  acc.messages++;
  acc.byPlatform[p]++;
  const min = Math.floor(t / MINUTE) * MINUTE;
  let b = acc.mins.get(min);
  if (!b && acc.mins.size < MAX_MIN_BUCKETS) {
    b = { twitch: 0, x: 0, kick: 0, mb: 0 };
    acc.mins.set(min, b);
  }
  if (b) b[p]++;
  const uk = `${p}:${m.author.username.toLowerCase()}`;
  const ca = acc.chatters.get(uk);
  if (ca) ca.count++;
  else if (acc.chatters.size < MAX_CHATTERS) acc.chatters.set(uk, { name: m.author.displayName, platform: p, count: 1 });
  if (m.cashtags) for (const c of m.cashtags) acc.cashtags.set(c.symbol.toUpperCase(), (acc.cashtags.get(c.symbol.toUpperCase()) ?? 0) + 1);
  if (m.emotes)
    for (const e of m.emotes) {
      const k = e.name || e.url;
      const ea = acc.emotes.get(k);
      if (ea) ea.count++;
      else if (acc.emotes.size < MAX_EMOTES) acc.emotes.set(k, { name: e.name || k, url: e.url, count: 1 });
    }
  const v = m.sentiment ?? scoreSentiment(m.text);
  if (v !== 0) {
    const sb = acc.sent.get(min) ?? { bull: 0, bear: 0 };
    if (v > 0) sb.bull++;
    else sb.bear++;
    acc.sent.set(min, sb);
  }
  if (acc.cashtags.size > MAX_TAGS) {
    // keep top tags only (rare)
    const top = [...acc.cashtags.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAGS);
    acc.cashtags.clear();
    for (const [k, v2] of top) acc.cashtags.set(k, v2);
  }
}

function finalize(base: SessionSummary, acc: Acc, live: boolean): SessionSummary {
  const now = Date.now();
  const durationMs = Math.max(0, now - base.startedAt);
  const durationMin = Math.max(1 / 60, durationMs / MINUTE);
  const activity = [...acc.mins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ t, twitch: b.twitch, x: b.x, kick: b.kick, mb: b.mb, total: b.twitch + b.x + b.kick + b.mb }));
  let peakPerMin = 0;
  let peakAt = base.startedAt;
  for (const a of activity) if (a.total > peakPerMin) ((peakPerMin = a.total), (peakAt = a.t));
  const sentiment = [...acc.sent.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => {
      const s = b.bull + b.bear;
      return { t, net: s ? (b.bull - b.bear) / s : 0, bullish: b.bull, bearish: b.bear };
    });
  let bull = 0;
  let bear = 0;
  for (const b of acc.sent.values()) ((bull += b.bull), (bear += b.bear));
  const net = bull + bear ? (bull - bear) / (bull + bear) : 0;
  const topChatters = [...acc.chatters.entries()]
    .map(([k, v]) => ({ username: k.slice(k.indexOf(":") + 1), name: v.name, platform: v.platform, count: v.count, perMin: v.count / durationMin }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  const topEmotes = [...acc.emotes.values()].filter((e) => e.url).sort((a, b) => b.count - a.count).slice(0, 16);
  const topCashtags = [...acc.cashtags.entries()].map(([symbol, count]) => ({ symbol, count })).sort((a, b) => b.count - a.count).slice(0, 12);
  return {
    ...base,
    endedAt: live ? null : now,
    status: live ? "recording" : "ended",
    durationMs,
    messages: acc.messages,
    chatters: acc.chatters.size,
    avgPerMin: acc.messages / durationMin,
    peakPerMin,
    peakAt,
    net,
    byPlatform: { ...acc.byPlatform },
    topChatters,
    topEmotes,
    topCashtags,
    activity,
    sentiment,
  };
}
