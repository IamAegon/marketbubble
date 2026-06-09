import type {
  ActivityBucket,
  CashtagStat,
  ChannelSentiment,
  ChannelStat,
  ChatterInsights,
  ChatterRank,
  ChatMessage,
  EmoteStat,
  HypeStat,
  MomentumStat,
  Platform,
  ReactedMessage,
  RollupSummary,
  SentimentPoint,
  StatsRange,
  StatsScope,
  StatsSnapshot,
  StreamerSummary,
} from "@app/shared";
import { scoreSentiment } from "../finance/Sentiment.js";
import type { StreamerRegistry } from "./streamers.js";

const FINE_MS = 10_000; // 10s native bucket
const MAX_WINDOW_MS = 6 * 60 * 60_000; // keep 6h of fine buckets
const SENT_BUCKET_MS = 15_000;
const MAX_CHATTERS = 5000;
const MAX_TAGS = 500;
const MAX_EMOTES = 500;
const MAX_SENT_EVENTS = 6000;
const MAX_REACTIONS = 800;
const MAX_EMOTE_EVENTS = 6000;
const MAX_TAG_EVENTS = 4000;

const RANGE_MS: Record<Exclude<StatsRange, "session">, number> = {
  "5m": 5 * 60_000,
  "20m": 20 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
};

interface PlatBucket {
  twitch: number;
  x: number;
  kick: number;
  mb: number;
}
interface ChannelAgg {
  label: string;
  platform: Platform;
  count: number;
}
interface ChatterAgg {
  name: string;
  platform: Platform;
  count: number;
  first: number;
  last: number;
}
interface EmoteAgg {
  name: string;
  url: string;
  count: number;
}

/** Rolling analytics for one streamer (owned or external). */
class PerStreamer {
  total = 0;
  byPlatform: Record<Platform, number> = { twitch: 0, x: 0, kick: 0, mb: 0 };
  buckets = new Map<number, PlatBucket>();
  channels = new Map<string, ChannelAgg>();
  chatters = new Map<string, ChatterAgg>();
  cashtags = new Map<string, number>();
  emotes = new Map<string, EmoteAgg>();
  // sentiment events carry channel info so we can split sentiment per stream
  sentEvents: { t: number; v: number; channel?: string; label?: string; platform?: Platform }[] = [];
  // reactions: top emoted messages (keyed by message id); momentum event logs
  reactions = new Map<string, ReactedMessage>();
  emoteEvents: { t: number; key: string; name: string; url: string }[] = [];
  cashtagEvents: { t: number; sym: string }[] = [];
  lastActivity = 0;
  constructor(
    public id: string,
    public name: string,
    public owned: boolean,
  ) {}
}

/**
 * Multi-tenant rolling analytics. Every chat message is attributed to a streamer
 * (via the registry) and folded into that streamer's aggregates, so the view can
 * scope to one streamer, to "ours" (owned), to external, or compare the two.
 */
export class StatsAggregator {
  private readonly startedAt = Date.now();
  private streamers = new Map<string, PerStreamer>();
  private sincePrune = 0;
  private recordingCheck?: (streamerId: string) => boolean;

  constructor(
    private readonly registry: StreamerRegistry,
    private readonly opts: { canRecord?: (channel: string) => boolean; durable?: () => boolean } = {},
  ) {}

  /** wire the session recorder so snapshots flag which streamers are recording */
  setRecordingCheck(fn: (streamerId: string) => boolean): void {
    this.recordingCheck = fn;
  }

  /** rebuild rolling state from durable history on boot — replays the live fold
   * path so analytics survive a restart (skips anything past the 6h window). */
  replay(messages: ChatMessage[]): void {
    const cutoff = Date.now() - MAX_WINDOW_MS;
    for (const m of messages) {
      if ((m.receivedAt || m.timestamp) < cutoff) continue;
      this.record(m);
    }
  }

  record(m: ChatMessage): void {
    if (m.kind === "post") return; // tracked-account news, not chat
    if (m.kind === "caption") return; // STT captions are stream audio, not a chatter
    if (m.platform === "mb") return; // internal Market Bubble rooms are chats, not streams — never a "streamer"
    if (this.opts.canRecord && !this.opts.canRecord(m.channel)) return;

    const ref = this.registry.resolve(m.channel, m.channelLabel);
    let ps = this.streamers.get(ref.id);
    if (!ps) {
      ps = new PerStreamer(ref.id, ref.name, ref.owned);
      this.streamers.set(ref.id, ps);
    }
    ps.name = ref.name;
    ps.owned = ref.owned;

    const p = m.platform;
    const t = m.receivedAt || Date.now();
    ps.total++;
    ps.byPlatform[p]++;
    ps.lastActivity = t;

    const bStart = Math.floor(t / FINE_MS) * FINE_MS;
    let b = ps.buckets.get(bStart);
    if (!b) {
      b = { twitch: 0, x: 0, kick: 0, mb: 0 };
      ps.buckets.set(bStart, b);
    }
    b[p]++;

    const ch = ps.channels.get(m.channel);
    if (ch) ch.count++;
    else ps.channels.set(m.channel, { label: m.channelLabel, platform: p, count: 1 });

    const uk = `${p}:${m.author.username.toLowerCase()}`;
    const ca = ps.chatters.get(uk);
    if (ca) {
      ca.count++;
      ca.last = t;
    } else {
      ps.chatters.set(uk, { name: m.author.displayName, platform: p, count: 1, first: t, last: t });
    }

    if (m.cashtags) {
      for (const c of m.cashtags) {
        const s = c.symbol.toUpperCase();
        ps.cashtags.set(s, (ps.cashtags.get(s) ?? 0) + 1);
        ps.cashtagEvents.push({ t, sym: s });
      }
      if (ps.cashtagEvents.length > MAX_TAG_EVENTS) ps.cashtagEvents.splice(0, ps.cashtagEvents.length - MAX_TAG_EVENTS);
    }
    if (m.emotes) {
      for (const e of m.emotes) {
        const key = e.name || e.url;
        const ea = ps.emotes.get(key);
        if (ea) ea.count++;
        else ps.emotes.set(key, { name: e.name || key, url: e.url, count: 1 });
        ps.emoteEvents.push({ t, key, name: e.name || key, url: e.url });
      }
      if (ps.emoteEvents.length > MAX_EMOTE_EVENTS) ps.emoteEvents.splice(0, ps.emoteEvents.length - MAX_EMOTE_EVENTS);
      if (m.emotes.length) {
        ps.reactions.set(m.id, {
          id: m.id,
          channel: m.channel,
          label: m.channelLabel,
          author: m.author.displayName,
          text: collapseSpam(m.text).slice(0, 160),
          emoteCount: m.emotes.length,
          t,
        });
      }
    }

    // read the stamped sentiment; fall back to scoring for pre-column rows
    // replayed from durable history (mixed-corpus after the schema change)
    const v = m.sentiment ?? scoreSentiment(m.text);
    if (v !== 0) {
      ps.sentEvents.push({ t, v, channel: m.channel, label: m.channelLabel, platform: p });
      if (ps.sentEvents.length > MAX_SENT_EVENTS) ps.sentEvents.splice(0, ps.sentEvents.length - MAX_SENT_EVENTS);
    }

    if (++this.sincePrune >= 200) {
      this.sincePrune = 0;
      this.prune();
    }
  }

  private prune(): void {
    const cutoff = Date.now() - MAX_WINDOW_MS;
    for (const ps of this.streamers.values()) {
      for (const k of ps.buckets.keys()) if (k < cutoff) ps.buckets.delete(k);
      capMap(ps.chatters, MAX_CHATTERS, (v) => v.count);
      capCounts(ps.cashtags, MAX_TAGS);
      capMap(ps.emotes, MAX_EMOTES, (v) => v.count);
      if (ps.sentEvents.length) {
        const i = ps.sentEvents.findIndex((e) => e.t >= cutoff);
        if (i > 0) ps.sentEvents.splice(0, i);
      }
      for (const [k, r] of ps.reactions) if (r.t < cutoff) ps.reactions.delete(k);
      capMap(ps.reactions, MAX_REACTIONS, (v) => v.emoteCount);
      trimEvents(ps.emoteEvents, cutoff);
      trimEvents(ps.cashtagEvents, cutoff);
    }
  }

  // short-TTL cache so concurrent pollers AND the PDF report share one computation
  // (so the exported PDF matches the on-screen numbers, and we don't recompute the
  // full snapshot on every 7s poll from every client). Slightly stale `now` is fine.
  private snapCache = new Map<string, { at: number; snap: StatsSnapshot }>();
  private static readonly SNAP_TTL_MS = 2500;

  snapshot(range: StatsRange, opts: { scope?: StatsScope; streamer?: string } = {}): StatsSnapshot {
    const key = `${range}|${opts.scope ?? "owned"}|${opts.streamer ?? ""}`;
    const t = Date.now();
    const cached = this.snapCache.get(key);
    if (cached && t - cached.at < StatsAggregator.SNAP_TTL_MS) return cached.snap;
    const snap = this.computeSnapshot(range, opts);
    this.snapCache.set(key, { at: t, snap });
    return snap;
  }

  private computeSnapshot(range: StatsRange, opts: { scope?: StatsScope; streamer?: string } = {}): StatsSnapshot {
    const now = Date.now();
    const scope: StatsScope = opts.scope ?? "owned";
    const all = [...this.streamers.values()];

    let view: PerStreamer[];
    let streamerId: string | undefined;
    let streamerName: string | undefined;
    let owned: boolean | undefined;
    if (opts.streamer) {
      const one = this.streamers.get(opts.streamer);
      view = one ? [one] : [];
      if (one) {
        streamerId = one.id;
        streamerName = one.name;
        owned = one.owned;
      }
    } else if (scope === "owned") view = all.filter((s) => s.owned);
    else if (scope === "external") view = all.filter((s) => !s.owned);
    else view = all;

    const windowMs = range === "session" ? Math.max(60_000, now - this.startedAt) : RANGE_MS[range];
    const from = now - windowMs;

    // ----- merged activity timeline (sum buckets across the in-view streamers) -----
    const target = Math.max(FINE_MS, Math.round(windowMs / 60 / FINE_MS) * FINE_MS);
    const bucketMs = target;
    const firstStart = Math.floor(from / bucketMs) * bucketMs;
    const nBars = Math.max(1, Math.round((now - firstStart) / bucketMs));
    const bars: ActivityBucket[] = [];
    for (let i = 0; i < nBars; i++) {
      bars.push({ t: firstStart + i * bucketMs, twitch: 0, x: 0, kick: 0, mb: 0, total: 0 });
    }
    for (const ps of view) {
      for (const [k, b] of ps.buckets) {
        if (k < firstStart || k >= now + bucketMs) continue;
        const idx = Math.floor((k - firstStart) / bucketMs);
        if (idx < 0 || idx >= bars.length) continue;
        const bar = bars[idx]!;
        bar.twitch += b.twitch;
        bar.x += b.x;
        bar.kick += b.kick;
        bar.mb += b.mb;
      }
    }
    let total = 0;
    let peakPerMin = 0;
    let peakAt = now;
    const perBar = bucketMs / 60_000;
    for (const bar of bars) {
      bar.total = bar.twitch + bar.x + bar.kick + bar.mb;
      total += bar.total;
      const rate = bar.total / perBar;
      if (rate > peakPerMin) {
        peakPerMin = rate;
        peakAt = bar.t;
      }
    }
    const perMin = recentRate(view, now);

    // ----- merged leaderboards -----
    const byPlatform: Record<string, number> = { twitch: 0, x: 0, kick: 0, mb: 0 };
    const channels = new Map<string, ChannelStat>();
    const chatters = new Map<string, ChatterAgg>();
    const cashtags = new Map<string, number>();
    const emotes = new Map<string, EmoteAgg>();
    let sessionTotal = 0;
    for (const ps of view) {
      sessionTotal += ps.total;
      for (const p of Object.keys(ps.byPlatform) as Platform[]) byPlatform[p]! += ps.byPlatform[p];
      for (const [k, v] of ps.channels) {
        const e = channels.get(k);
        if (e) e.count += v.count;
        else channels.set(k, { channel: k, label: v.label, platform: v.platform, count: v.count });
      }
      for (const [k, v] of ps.chatters) {
        const e = chatters.get(k);
        if (e) {
          e.count += v.count;
          e.first = Math.min(e.first, v.first);
          e.last = Math.max(e.last, v.last);
        } else chatters.set(k, { ...v });
      }
      for (const [k, v] of ps.cashtags) cashtags.set(k, (cashtags.get(k) ?? 0) + v);
      for (const [k, v] of ps.emotes) {
        const e = emotes.get(k);
        if (e) e.count += v.count;
        else emotes.set(k, { ...v });
      }
    }

    const channelList = [...channels.values()].sort((a, b) => b.count - a.count).slice(0, 12);
    const topChatters: ChatterRank[] = [...chatters.entries()]
      .map(([k, v]) => ({
        username: k.slice(k.indexOf(":") + 1),
        name: v.name,
        platform: v.platform,
        count: v.count,
        perMin: v.count / (Math.max(60_000, v.last - v.first) / 60_000),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
    const cashtagList: CashtagStat[] = [...cashtags.entries()]
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    const emoteList: EmoteStat[] = [...emotes.values()]
      .filter((e) => e.url)
      .sort((a, b) => b.count - a.count)
      .slice(0, 16);

    const sentiment = sentimentSeries(view, from, now);
    const chatterCount = chatters.size;

    // ----- enriched live metrics -----
    // (b) chatter lifecycle: new vs returning within the range
    const fiveAgo = now - 5 * 60_000;
    let newChatters = 0;
    let returning = 0;
    let activeRecent = 0;
    for (const v of chatters.values()) {
      if (v.first >= from) newChatters++;
      else if (v.last >= from) returning++;
      if (v.last >= fiveAgo) activeRecent++;
    }
    const chatterInsights: ChatterInsights = {
      newChatters,
      returning,
      returningRate: newChatters + returning ? returning / (newChatters + returning) : 0,
      activeUniquesPerMin: activeRecent / 5,
    };

    // (c) per-channel sentiment (windowed), most-reacted messages, emote/cashtag momentum
    const chanSent = new Map<string, { bull: number; bear: number; label: string; platform: Platform }>();
    const reacted: ReactedMessage[] = [];
    const emoteEvents: { t: number; key: string; name: string; url: string }[] = [];
    const cashtagEvents: { t: number; sym: string }[] = [];
    for (const ps of view) {
      for (const e of ps.sentEvents) {
        if (e.t < from || !e.channel) continue;
        let c = chanSent.get(e.channel);
        if (!c) {
          c = { bull: 0, bear: 0, label: e.label ?? e.channel, platform: e.platform ?? "twitch" };
          chanSent.set(e.channel, c);
        }
        if (e.v > 0) c.bull++;
        else c.bear++;
      }
      for (const r of ps.reactions.values()) if (r.t >= from) reacted.push(r);
      for (const e of ps.emoteEvents) emoteEvents.push(e);
      for (const e of ps.cashtagEvents) cashtagEvents.push(e);
    }
    const channelSentiment: ChannelSentiment[] = [...chanSent.entries()]
      .map(([channel, c]) => ({
        channel,
        label: c.label,
        platform: c.platform,
        net: c.bull + c.bear ? (c.bull - c.bear) / (c.bull + c.bear) : 0,
        bullish: c.bull,
        bearish: c.bear,
      }))
      .filter((c) => c.bullish + c.bearish >= 3)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 12);
    // re-collapse at read time (cleans up rows captured before a reload) + dedupe near-
    // identical copy-paste to one row (highest-count instance) so the list shows distinct
    // reactions, not the same spam echoed by three accounts
    const byText = new Map<string, ReactedMessage>();
    for (const r of reacted.sort((a, b) => b.emoteCount - a.emoteCount)) {
      const text = collapseSpam(r.text).slice(0, 160);
      const k = reactedKey(r.channel, text);
      if (!byText.has(k)) byText.set(k, { ...r, text });
    }
    const mostReacted = [...byText.values()].sort((a, b) => b.emoteCount - a.emoteCount).slice(0, 8);
    const emoteMomentum = momentum(emoteEvents, windowMs, now, (e) => e.key, (e) => ({ label: e.name, url: e.url }));
    const cashtagMomentum = momentum(cashtagEvents, windowMs, now, (e) => e.sym, (e) => ({ label: "$" + e.sym }));

    // (a) hype & velocity: rate spike vs baseline + sentiment swing + emote/cashtag burst
    const perBarMin = bucketMs / 60_000;
    const recentCut = now - 5 * 60_000;
    const baseBars = bars.filter((b) => b.t < recentCut);
    const baselinePerMin = baseBars.length
      ? baseBars.reduce((s, b) => s + b.total, 0) / (baseBars.length * perBarMin)
      : bars.length
        ? bars.reduce((s, b) => s + b.total, 0) / (bars.length * perBarMin)
        : 0;
    const acceleration = (perMin - rateBetween(view, now - 10 * 60_000, now - 5 * 60_000)) / 5;
    const spikeThresh = Math.max(baselinePerMin * 2, baselinePerMin + 5);
    const spikes = baselinePerMin > 0 ? bars.filter((b) => b.total > 0 && b.total / perBarMin >= spikeThresh).map((b) => b.t) : [];
    const rateRatio = baselinePerMin > 0 ? perMin / baselinePerMin : perMin > 0 ? 1.5 : 0;
    const ratePart = Math.min(60, Math.max(0, (rateRatio - 1) * 55));
    const recentSent = sentiment.length ? sentiment[sentiment.length - 1]!.net : 0;
    const earlierSent = sentiment.length ? sentiment[0]!.net : 0;
    const sentPart = Math.min(20, Math.abs(recentSent - earlierSent) * 20);
    const burst = [...emoteMomentum, ...cashtagMomentum].reduce((s, m) => s + Math.max(0, m.delta), 0);
    const burstPart = Math.min(20, burst / 5);
    const hype: HypeStat = {
      score: Math.round(Math.min(100, Math.max(0, ratePart + sentPart + burstPart))),
      perMinNow: perMin,
      baselinePerMin: Math.round(baselinePerMin * 10) / 10,
      acceleration: Math.round(acceleration * 10) / 10,
      spikes,
    };

    // ----- per-streamer summaries + owned/external comparison (over the range) -----
    const streamers: StreamerSummary[] = all.map((s) => summarize(s, now));
    // surface registered owned streamers (Ansem/Faze) even when offline, so the
    // "ours" view always lists them (with zeroed metrics until they go live)
    const known = new Set(streamers.map((s) => s.id));
    for (const r of this.registry.list()) {
      if (r.owned && !known.has(r.id)) {
        streamers.push({ id: r.id, name: r.name, owned: true, total: 0, chatters: 0, perMin: 0, peakPerMin: 0, net: 0 });
      }
    }
    if (this.recordingCheck) for (const s of streamers) s.recording = this.recordingCheck(s.id);
    streamers.sort((a, b) => Number(b.owned) - Number(a.owned) || b.total - a.total);
    const comparison = {
      owned: rollup(all.filter((s) => s.owned)),
      external: rollup(all.filter((s) => !s.owned)),
    };

    return {
      range,
      scope,
      streamerId,
      streamerName,
      owned,
      now,
      startedAt: this.startedAt,
      total,
      sessionTotal,
      bucketMs,
      perMin,
      peakPerMin,
      peakAt,
      chatters: chatterCount,
      byPlatform,
      buckets: bars,
      channels: channelList,
      topChatters,
      cashtags: cashtagList,
      emotes: emoteList,
      sentiment,
      streamers,
      comparison,
      durable: this.opts.durable?.() ?? false,
      hype,
      chatterInsights,
      channelSentiment,
      mostReacted,
      emoteMomentum,
      cashtagMomentum,
    };
  }
}

// ---------- helpers ----------

/** messages/min over the last 5 minutes across a set of streamers */
function recentRate(view: PerStreamer[], now: number): number {
  const fiveAgo = now - 5 * 60_000;
  let last5 = 0;
  for (const ps of view) {
    for (const [k, b] of ps.buckets) if (k >= fiveAgo) last5 += b.twitch + b.x + b.kick + b.mb;
  }
  return last5 / 5;
}

/** latest net sentiment over the last 60s for a single streamer */
function recentNet(ps: PerStreamer, now: number): number {
  const since = now - 60_000;
  let bull = 0;
  let bear = 0;
  for (const e of ps.sentEvents) {
    if (e.t < since) continue;
    if (e.v > 0) bull++;
    else if (e.v < 0) bear++;
  }
  const s = bull + bear;
  return s ? (bull - bear) / s : 0;
}

/** time-bucketed sentiment trend merged across the in-view streamers */
function sentimentSeries(view: PerStreamer[], from: number, now: number): SentimentPoint[] {
  const buckets = new Map<number, { bull: number; bear: number }>();
  for (const ps of view) {
    for (const e of ps.sentEvents) {
      if (e.t < from) continue;
      const k = Math.floor(e.t / SENT_BUCKET_MS) * SENT_BUCKET_MS;
      let b = buckets.get(k);
      if (!b) {
        b = { bull: 0, bear: 0 };
        buckets.set(k, b);
      }
      if (e.v > 0) b.bull++;
      else b.bear++;
    }
  }
  const pts = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => {
      const s = b.bull + b.bear;
      return { t, net: s ? (b.bull - b.bear) / s : 0, bullish: b.bull, bearish: b.bear };
    });
  return downsample(pts, 120);
}

function summarize(ps: PerStreamer, now: number): StreamerSummary {
  let peakPerMin = 0;
  const fiveAgo = now - 5 * 60_000;
  let last5 = 0;
  for (const [k, b] of ps.buckets) {
    const total = b.twitch + b.x + b.kick + b.mb;
    const rate = total / (FINE_MS / 60_000);
    if (rate > peakPerMin) peakPerMin = rate;
    if (k >= fiveAgo) last5 += total;
  }
  return {
    id: ps.id,
    name: ps.name,
    owned: ps.owned,
    total: ps.total,
    chatters: ps.chatters.size,
    perMin: last5 / 5,
    peakPerMin,
    net: recentNet(ps, now),
  };
}

function rollup(group: PerStreamer[]): RollupSummary {
  const now = Date.now();
  let total = 0;
  let chatters = 0;
  let perMin = 0;
  let peakPerMin = 0;
  let netWeighted = 0;
  let netW = 0;
  for (const ps of group) {
    const s = summarize(ps, now);
    total += s.total;
    chatters += s.chatters;
    perMin += s.perMin;
    peakPerMin = Math.max(peakPerMin, s.peakPerMin);
    netWeighted += s.net * Math.max(1, s.total);
    netW += Math.max(1, s.total);
  }
  return {
    streamers: group.length,
    total,
    chatters,
    perMin,
    peakPerMin,
    net: netW ? netWeighted / netW : 0,
  };
}

const unitEq = (toks: string[], a: number, b: number, p: number): boolean => {
  for (let k = 0; k < p; k++) if (toks[a + k] !== toks[b + k]) return false;
  return true;
};

/** Collapse emote/phrase spam into a readable form: a unit (1–6 tokens) repeated ≥3×
 * consecutively ANYWHERE becomes "unit ×N", with any prefix/suffix preserved — so
 * "Eddy: 676 DEATHS ROFL 676 DEATHS ROFL …" reads "Eddy: 676 DEATHS ROFL ×10" instead
 * of a wall of copy-paste. Idempotent (safe to re-apply on already-collapsed text). */
export function collapseSpam(text: string): string {
  const t = (text || "").trim();
  let toks = t.split(/\s+/).filter(Boolean);
  if (toks.length < 4) return t;
  let changed = true;
  // repeatedly collapse the longest repeated block until stable (handles nested/multi spam)
  while (changed) {
    changed = false;
    let best: { start: number; p: number; reps: number } | null = null;
    for (let p = 1; p <= 6; p++) {
      let i = 0;
      while (i + p * 2 <= toks.length) {
        let reps = 1;
        while (i + (reps + 1) * p <= toks.length && unitEq(toks, i, i + reps * p, p)) reps++;
        if (reps >= 3) {
          if (!best || reps * p > best.reps * best.p) best = { start: i, p, reps };
          i += reps * p;
        } else i++;
      }
    }
    if (best) {
      const unit = toks.slice(best.start, best.start + best.p).join(" ");
      toks = [
        ...toks.slice(0, best.start),
        `${unit} ×${best.reps}`,
        ...toks.slice(best.start + best.reps * best.p),
      ];
      changed = true;
    }
  }
  return toks.join(" ");
}

/** Normalize a reacted message to its "core" for dedup: drop a leading "name:" copy/reply
 * prefix and any "×N" counts, lowercase — so copy-paste spam from several accounts merges. */
const reactedKey = (channel: string, text: string): string =>
  `${channel}|${text
    .toLowerCase()
    .replace(/^\s*[\w.]+:\s*/, "")
    .replace(/\s*×\d+/g, "")
    .replace(/\s+/g, " ")
    .trim()}`;

function capMap<V>(m: Map<string, V>, max: number, weight: (v: V) => number): void {
  if (m.size <= max) return;
  const sorted = [...m.entries()].sort((a, b) => weight(b[1]) - weight(a[1]));
  m.clear();
  for (let i = 0; i < max; i++) m.set(sorted[i]![0], sorted[i]![1]);
}
/** drop time-ordered events older than the cutoff (arrays are appended in time order) */
function trimEvents(events: { t: number }[], cutoff: number): void {
  if (!events.length) return;
  const i = events.findIndex((e) => e.t >= cutoff);
  if (i > 0) events.splice(0, i);
}

/** messages/min over an arbitrary [a,b) window across a set of streamers */
function rateBetween(view: PerStreamer[], a: number, b: number): number {
  let n = 0;
  for (const ps of view) for (const [k, bk] of ps.buckets) if (k >= a && k < b) n += bk.twitch + bk.x + bk.kick + bk.mb;
  return n / Math.max(1, (b - a) / 60_000);
}

/** rising emotes/cashtags: count in the last third of the window vs the prior third */
function momentum<T extends { t: number }>(
  events: T[],
  windowMs: number,
  now: number,
  keyOf: (e: T) => string,
  metaOf: (e: T) => { label?: string; url?: string },
): MomentumStat[] {
  const third = windowMs / 3;
  const nowFrom = now - third;
  const prevFrom = now - 2 * third;
  const nowC = new Map<string, number>();
  const prevC = new Map<string, number>();
  const meta = new Map<string, { label?: string; url?: string }>();
  for (const e of events) {
    if (e.t < prevFrom) continue;
    const k = keyOf(e);
    if (!meta.has(k)) meta.set(k, metaOf(e));
    if (e.t >= nowFrom) nowC.set(k, (nowC.get(k) ?? 0) + 1);
    else prevC.set(k, (prevC.get(k) ?? 0) + 1);
  }
  const out: MomentumStat[] = [];
  for (const k of new Set([...nowC.keys(), ...prevC.keys()])) {
    const nv = nowC.get(k) ?? 0;
    const pv = prevC.get(k) ?? 0;
    out.push({ key: k, ...meta.get(k), now: nv, prev: pv, delta: nv - pv });
  }
  return out.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 8);
}

function capCounts(m: Map<string, number>, max: number): void {
  if (m.size <= max) return;
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  m.clear();
  for (let i = 0; i < max; i++) m.set(sorted[i]![0], sorted[i]![1]);
}
function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]!);
  return out;
}
