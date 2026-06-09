// Live MarketBubble data exposed to the assistant as callable tools. The assistant
// (any provider) can invoke these mid-conversation to ground answers in real state
// — the same idea as MCP tools, wired straight into the in-app tool-calling loop.

export interface ToolDeps {
  marketSentiment: { get(): unknown };
  trends: { get(): { trends: any[] } };
  stats: { snapshot(range: any, opts: any): any };
  chatStore: {
    recent(opts: { sinceMs?: number; limit?: number }): Promise<any[]>;
    search(opts: { q: string; platform?: string; channel?: string; limit?: number }): Promise<any[]>;
  };
  sessions: { list(): any[]; get(id: string): any };
  /** the recent tracked-account posts (tweets) hot buffer — same feed shown in X Feed / News */
  tweets: { recentPosts(n: number): any[] };
  /** on-demand fetch of a single account's latest tweets (authoritative, reload-proof) */
  news: { recentForHandle(handle: string, limit?: number): Promise<any[]> };
  captions: { recent(channel: string, limit?: number): Promise<any[]>; forSession(sessionId: string, limit?: number): Promise<any[]> };
  history: { get(): any };
  portfolios: { list(): any[] };
  priceHistory: any;
  manager: { list(): any[] };
  computePerformance: (ps: any[], store: any) => Promise<any>;
}

/** evenly down-sample a time series to ~n points (keeps shape, drops bulk). */
function downsample<T>(arr: T[] | undefined, n: number): T[] {
  if (!Array.isArray(arr) || arr.length <= n) return arr ?? [];
  const step = arr.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]!);
  return out;
}

/** headline metrics for one recorded session (no heavy timelines). */
function sessionBrief(s: any) {
  return {
    id: s.id,
    streamer: s.streamerName,
    owned: s.owned,
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: s.durationMs,
    messages: s.messages,
    chatters: s.chatters,
    avgPerMin: Math.round((s.avgPerMin ?? 0) * 10) / 10,
    peakPerMin: s.peakPerMin,
    net: Math.round((s.net ?? 0) * 100) / 100,
  };
}

export interface ToolSpec {
  name: string;
  label: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, any>; required?: string[] };
  run: (args: any) => Promise<unknown> | unknown;
}

/** Drop heavy time-series and cap arrays so a tool result stays small + relevant. */
function compact(obj: any, cap = 8): any {
  if (Array.isArray(obj)) return obj.slice(0, cap).map((x) => compact(x, cap));
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/series|bars|spikes|histogram|points|sparkline/i.test(k)) continue;
      out[k] = Array.isArray(v) ? v.slice(0, cap).map((x) => compact(x, cap)) : v;
    }
    return out;
  }
  return obj;
}

export function buildTools(d: ToolDeps): ToolSpec[] {
  return [
    {
      name: "get_market_mood",
      label: "Market mood",
      description: "Current market sentiment gauges: crypto Fear & Greed, stock Fear & Greed, and AAII investor survey.",
      parameters: { type: "object", properties: {} },
      run: () => d.marketSentiment.get(),
    },
    {
      name: "get_trends",
      label: "Trends",
      description: "What people are talking about right now — trending searches, social hashtags, and news headlines.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "max items (default 10)" } },
      },
      run: ({ limit }: { limit?: number }) =>
        d.trends
          .get()
          .trends.slice(0, Math.min(limit ?? 10, 20))
          .map((t: any) => ({ title: t.title, source: t.source, traffic: t.traffic, snippet: t.snippet })),
    },
    {
      name: "get_stream_stats",
      label: "Stream stats",
      description:
        "Live chat analytics across the connected streams: volume, rate, unique chatters, sentiment, busiest streams, top chatters/cashtags/emotes, hype.",
      parameters: {
        type: "object",
        properties: {
          range: { type: "string", enum: ["5m", "20m", "1h", "6h", "session"], description: "time window (default 1h)" },
          scope: { type: "string", enum: ["owned", "external", "all"], description: "which streams (default all)" },
          streamer: { type: "string", description: "a specific streamer id (from get_sessions/get_live_streams); overrides scope" },
        },
      },
      run: ({ range, scope, streamer }: { range?: string; scope?: string; streamer?: string }) =>
        compact(d.stats.snapshot((range as any) || "1h", { scope: (scope as any) || "all", streamer })),
    },
    {
      name: "search_chat",
      label: "Chat search",
      description:
        "Full-text search across durable chat history (not just the live window). Matches message text/author; optional channel/platform filter. Use to find what was said about a topic, by whom, or in a specific stream.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "term to match (omit for the latest messages)" },
          channel: { type: "string", description: "restrict to one connector id, e.g. 'twitch:#jynxzi'" },
          platform: { type: "string", enum: ["twitch", "kick", "x", "mb"], description: "restrict to one platform" },
          limit: { type: "number", description: "max messages (default 25, cap 80)" },
        },
      },
      run: async ({ query, channel, platform, limit }: { query?: string; channel?: string; platform?: string; limit?: number }) => {
        const lim = Math.min(limit ?? 25, 80);
        const q = (query || "").trim();
        // use the indexed durable search when there's a query; else the latest window
        const msgs = q ? await d.chatStore.search({ q, channel, platform, limit: lim }) : await d.chatStore.recent({ limit: lim });
        return msgs.map((m: any) => ({
          author: m.author?.displayName,
          channel: m.channelLabel || m.channel,
          platform: m.platform,
          text: m.text,
          t: m.receivedAt || m.timestamp,
        }));
      },
    },
    {
      name: "search_tweets",
      label: "Tracked tweets",
      description:
        "Recent posts (tweets) from the X accounts this command center tracks — the same feed shown in the X Feed / News column. Use to summarize or answer questions ACROSS what the tracked accounts are posting right now: 'what's the latest on the Fed?', 'any BTC news?', 'what did @DeItaone post today?', 'overall mood of the tweets'. Optional text query, handle, or category filter; newest-first. Results are budget-capped — narrow with query/handle/category for fuller coverage of a topic.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "case-insensitive term to match in the tweet text (omit for all recent tweets)" },
          handle: { type: "string", description: "restrict to one account, e.g. 'DeItaone' (with or without @)" },
          category: { type: "string", description: "restrict to a tracked category, e.g. 'News', 'Macro', 'Crypto'" },
          limit: { type: "number", description: "max tweets, newest first (default 40, cap 150)" },
        },
      },
      run: async ({ query, handle, category, limit }: { query?: string; handle?: string; category?: string; limit?: number }) => {
        const lim = Math.min(limit ?? 40, 150);
        const h = (handle || "").replace(/^@/, "").trim();
        const cat = (category || "").trim().toLowerCase();
        const q = (query || "").trim();
        // Pick the most authoritative source for the ask:
        let raw: { from: string; cat?: string; text: string; link?: string; at: number }[];
        let live = false;
        if (h) {
          // one account → fetch its timeline directly (fresh + survives a server restart,
          // unlike the in-memory window). This is the reliable answer to "what did @x post".
          const posts = await d.news.recentForHandle(h, Math.min(lim, 40)).catch(() => []);
          raw = posts.map((p: any) => ({ from: `@${h}`, text: p.text, link: p.link, at: p.at }));
          live = true;
        } else if (q) {
          // a topic → durable full-text search over stored tweets (not just the hot window)
          const msgs = await d.chatStore.search({ q, platform: "x", limit: lim * 2 }).catch(() => []);
          raw = msgs.map((m: any) => ({ from: m.channelLabel || `@${m.author?.username || "?"}`, cat: m.category, text: m.text, link: m.link, at: m.timestamp }));
        } else {
          // broad → the current window across all tracked accounts
          raw = d.tweets
            .recentPosts(500)
            .reverse()
            .map((m: any) => ({ from: m.channelLabel || `@${m.author?.username || "?"}`, cat: m.category, text: m.text, link: m.link, at: m.timestamp }));
        }
        const matched = raw
          .filter((r) => !cat || String(r.cat || "").toLowerCase() === cat)
          .map((r) => ({
            from: r.from,
            cat: r.cat,
            text: String(r.text || "").replace(/\s+/g, " ").slice(0, 280),
            link: r.link,
            at: new Date(r.at).toISOString(),
          }));
        // pack as many as fit under aiExec's ~6000-char result cap, so the JSON stays valid
        const rows: any[] = [];
        let budget = 5200;
        for (const row of matched) {
          if (rows.length >= lim) break;
          const cost = JSON.stringify(row).length + 1;
          if (budget - cost < 0 && rows.length) break;
          budget -= cost;
          rows.push(row);
        }
        return {
          count: rows.length,
          total: matched.length,
          source: live ? "live timeline" : "tracked feed",
          tweets: rows,
          ...(rows.length < matched.length ? { note: "more tweets available — narrow with query/handle/category" } : {}),
        };
      },
    },
    {
      name: "get_sessions",
      label: "Recorded sessions",
      description:
        "List recorded stream sessions (past broadcasts) with headline metrics — duration, messages, chatters, peak rate, net sentiment. Use to answer 'how did last night's stream do?' or compare broadcasts over time.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "max sessions, newest first (default 10, cap 30)" } },
      },
      run: ({ limit }: { limit?: number }) => d.sessions.list().slice(0, Math.min(limit ?? 10, 30)).map(sessionBrief),
    },
    {
      name: "get_session",
      label: "Session detail",
      description:
        "Full detail for one recorded session by id: headline metrics + top chatters/cashtags/emotes + a down-sampled activity & sentiment timeline.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "session id from get_sessions" } },
        required: ["id"],
      },
      run: ({ id }: { id?: string }) => {
        const s = d.sessions.get(String(id || ""));
        if (!s) return { error: "no such session" };
        return {
          ...sessionBrief(s),
          topChatters: (s.topChatters ?? []).slice(0, 10).map((c: any) => ({ name: c.name, count: c.count })),
          topCashtags: (s.topCashtags ?? []).slice(0, 10),
          topEmotes: (s.topEmotes ?? []).slice(0, 10).map((e: any) => ({ name: e.name, count: e.count })),
          activity: downsample(s.activity, 24),
          sentiment: downsample(s.sentiment, 24),
        };
      },
    },
    {
      name: "get_transcript",
      label: "Transcript",
      description:
        "Speech-to-text transcript — what the streamer actually said — for a recorded session (by id) or a live channel. Returns time-ordered caption segments. Only available when that stream had transcription on.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "a recorded session id (preferred)" },
          channel: { type: "string", description: "a connector id, e.g. 'kick:solomission' (recent captions)" },
          limit: { type: "number", description: "max segments (default 120, cap 400)" },
        },
      },
      run: async ({ sessionId, channel, limit }: { sessionId?: string; channel?: string; limit?: number }) => {
        const lim = Math.min(limit ?? 120, 400);
        const rows = sessionId
          ? await d.captions.forSession(String(sessionId), lim)
          : channel
            ? await d.captions.recent(String(channel), lim)
            : [];
        if (!rows.length) return { note: "no transcript found (was transcription on for this stream?)", segments: [] };
        return { segments: rows.map((c: any) => ({ t: c.startMs, text: c.text, conf: c.conf })) };
      },
    },
    {
      name: "get_market_history",
      label: "Market history",
      description:
        "Historical price levels for tracked assets — period opens (daily/weekly/monthly/yearly) and 52-week range — to cite where price sits relative to recent history.",
      parameters: { type: "object", properties: {} },
      run: () => compact(d.history.get()),
    },
    {
      name: "get_live_streams",
      label: "Live streams",
      description: "The streams/sources currently connected (Twitch/Kick/X + Market Bubble rooms) and their connection status.",
      parameters: { type: "object", properties: {} },
      run: () =>
        d.manager.list().map((c: any) => ({ id: c.id, platform: c.platform, label: c.label, status: c.status?.kind })),
    },
    {
      name: "get_portfolios",
      label: "Portfolios",
      description: "Tracked model portfolios and their performance (return %, current value, and called positions).",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const perf = await d.computePerformance(d.portfolios.list(), d.priceHistory);
        return compact(perf);
      },
    },
  ];
}
