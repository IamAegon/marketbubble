import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeSource, type ConnectorManager, type SourceSpec } from "../connectors/ConnectorManager.js";
import type { HealthRegistry } from "../observability/health.js";
import type { UserStore } from "../auth/UserStore.js";
import type { MbRoom } from "../room/MbRoom.js";
import type { RoomRegistry } from "../room/rooms.js";
import type { NewsManager } from "../news/NewsManager.js";
import type { ChatStore } from "../store/ChatStore.js";
import type { CaptionStore } from "../store/CaptionStore.js";
import type { StatsAggregator } from "../analytics/StatsAggregator.js";
import type { RingBuffer } from "../store/RingBuffer.js";
import { analyzeReactions } from "../analytics/reactions.js";
import type { SessionRecorder } from "../analytics/SessionRecorder.js";
import type { StreamerRegistry } from "../analytics/streamers.js";
import type { HistoryStore } from "../finance/history.js";
import type { TrendsStore } from "../social/trends.js";
import type { FinvizNewsStore } from "../news/finvizNews.js";
import type { MarketSentimentStore } from "../social/marketSentiment.js";
import type { PortfolioStore } from "../portfolio/store.js";
import type { PriceHistoryStore } from "../finance/priceHistory.js";
import type { ChecklistStore } from "../checklist/store.js";
import type { ShowStore } from "../show/store.js";
import type { TranscriptionManager } from "../transcribe/TranscriptionManager.js";
import { computePerformance } from "../portfolio/perf.js";
import { chatWithTools, llmConfigured, listProviders, type ChatMsg } from "../ai/llm.js";
import { buildTools } from "../ai/tools.js";
import type { ActionResult, ChatPost, ModLogEntry, ModRequest, Role, RoomInfo, StatsRange, StatsScope, TeamEvent } from "@app/shared";
import { resolveBroadcastMaster, proxyHls } from "../connectors/x/hlsProxy.js";
import { resolveBroadcast } from "../connectors/x/broadcastDiscovery.js";
import { compileLatex, compilePortfolioReport, compileReport, renderMarketBrief, sessionSnapshot } from "../analytics/report.js";
import { signToken } from "../auth/jwt.js";
import { userFromReq } from "../auth/verify.js";
import type { PlatformService } from "../platform/PlatformService.js";
import type { ModLog } from "../platform/ModLog.js";
import type { IntegrationStore } from "../connect/integrations.js";
import { buildAuthorizeUrl, exchangeCode, getOwner, twitchConfigured, twitchRedirectUri } from "../connect/oauth-twitch.js";
import {
  buildAuthorizeUrl as kickAuthorizeUrl,
  exchangeCode as kickExchange,
  getOwner as kickOwner,
  kickConfigured,
  kickRedirectUri,
  makeVerifier,
  challengeOf,
} from "../connect/oauth-kick.js";
import { oauthStates } from "../connect/stateStore.js";
import { logger } from "../observability/logger.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

function send(res: ServerResponse, status: number, body: unknown, contentType = "application/json") {
  res.writeHead(status, { ...CORS, "content-type": contentType });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const MAX_BODY = 1_000_000; // 1 MB — cap request bodies to avoid memory-exhaustion

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** is the request from the loopback interface (the local transcription worker)? */
function isLoopback(req: IncomingMessage): boolean {
  const ra = req.socket.remoteAddress || "";
  return ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
}

export interface RouterDeps {
  manager: ConnectorManager;
  health: HealthRegistry;
  users: UserStore;
  mbRoom: MbRoom;
  rooms: RoomRegistry;
  news: NewsManager;
  chatStore: ChatStore;
  captions: CaptionStore;
  stats: StatsAggregator;
  /** hot in-memory buffer of recent messages (chat + captions) — source for the live reaction fold */
  ring: RingBuffer;
  sessions: SessionRecorder;
  streamers: StreamerRegistry;
  history: HistoryStore;
  trends: TrendsStore;
  marketNews: FinvizNewsStore;
  marketSentiment: MarketSentimentStore;
  portfolios: PortfolioStore;
  priceHistory: PriceHistoryStore;
  checklists: ChecklistStore;
  shows: ShowStore;
  transcription: TranscriptionManager;
  platform: PlatformService;
  modLog: ModLog;
  integrations: IntegrationStore;
  transcribeSecret: string;
  notifyTeam: (event: TeamEvent) => void;
  /** announce a created/updated MB room so it appears (or refreshes) as a live column for members */
  notifyRoom: (room: RoomInfo) => void;
  /** a room was deleted — remove the column for `audience` (private rooms) or everyone (public) */
  notifyRoomRemoval: (roomId: string, audience?: string[]) => void;
  /** a participant was removed — remove the column for just that member */
  notifyMemberRemoval: (roomId: string, handle: string) => void;
  xUserAgent: string;
}

const WEB_URL = process.env.WEB_URL || "http://localhost:5173";

const isMod = (role: Role | undefined) => role === "mod" || role === "admin";

/** Build an audit-log entry from a moderation request + its outcome. */
function modLogEntry(u: { handle: string; displayName: string }, req: ModRequest, result: ActionResult): Omit<ModLogEntry, "id" | "at"> {
  const a = req.action;
  const m = String(req.channel || "").match(/^(twitch|kick):#?(.+)$/);
  return {
    actor: u.handle,
    actorName: u.displayName,
    channel: req.channel,
    channelLabel: m ? `${m[1] === "twitch" ? "#" : ""}${m[2]}` : req.channel,
    platform: m ? m[1]! : "",
    action: a.kind,
    target: req.targetName,
    durationSecs: a.kind === "timeout" ? a.seconds : undefined,
    reason: a.kind === "timeout" || a.kind === "ban" ? a.reason : undefined,
    mode: a.kind === "mode" ? a.mode : undefined,
    enabled: a.kind === "mode" ? a.enabled : undefined,
    ok: result.ok,
  };
}

const STATS_RANGES: StatsRange[] = ["5m", "20m", "1h", "6h", "session"];
const STATS_SCOPES: StatsScope[] = ["owned", "external", "all"];

function parseRange(sp: URLSearchParams): StatsRange {
  const raw = sp.get("range") ?? "20m";
  return (STATS_RANGES.includes(raw as StatsRange) ? raw : "20m") as StatsRange;
}
function parseScope(sp: URLSearchParams): { scope: StatsScope; streamer?: string } {
  const raw = sp.get("scope") ?? "owned";
  const scope = (STATS_SCOPES.includes(raw as StatsScope) ? raw : "owned") as StatsScope;
  const streamer = sp.get("streamer")?.trim() || undefined;
  return { scope, streamer };
}

export function createRouter(deps: RouterDeps) {
  const { manager, health, users, mbRoom, rooms, news, chatStore, captions, stats, ring, sessions, streamers, history, trends, marketNews, marketSentiment, portfolios, priceHistory, checklists, shows, transcription, platform, modLog, integrations, transcribeSecret, notifyTeam, notifyRoom, notifyRoomRemoval, notifyMemberRemoval, xUserAgent } = deps;

  // per-user cooldown for the LaTeX-compiled report (pdflatex is CPU-heavy)
  const REPORT_COOLDOWN_MS = 8000;
  const lastReportAt = new Map<string, number>();

  // live reaction fold — runs server-side off the hot ring so the browser never
  // does the per-bucket driver attribution. Short-TTL cache so concurrent pollers
  // share one computation (stream chat is public, so the result is role-independent).
  const reactCache = new Map<string, { at: number; snap: ReturnType<typeof analyzeReactions> }>();
  const REACT_TTL_MS = 3000;
  const reactions = (opts: { binMs: number; sinceMs?: number; channel: string; z: number }) => {
    const key = `${opts.binMs}|${opts.sinceMs ?? 0}|${opts.channel}|${opts.z}`;
    const now = Date.now();
    const cached = reactCache.get(key);
    if (cached && now - cached.at < REACT_TTL_MS) return cached.snap;
    const window = ring.recent({ platforms: [], channels: [] }, ring.size());
    const snap = analyzeReactions(window, { ...opts, now });
    reactCache.set(key, { at: now, snap });
    return snap;
  };

  // Live-data tools the assistant can call (in-app tool-calling, MCP-style).
  const aiTools = buildTools({ marketSentiment, trends, stats, chatStore, sessions, tweets: ring, news, captions, history, portfolios, priceHistory, manager, computePerformance });
  const aiToolDefs = aiTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const aiExec = async (name: string, args: any): Promise<string> => {
    const tool = aiTools.find((t) => t.name === name);
    if (!tool) return JSON.stringify({ error: `unknown tool: ${name}` });
    try {
      return JSON.stringify(await tool.run(args || {})).slice(0, 6000);
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? "GET";
    const url = (req.url ?? "/").split("?")[0]!;

    if (method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    try {
      if (url === "/healthz") return send(res, 200, "ok", "text/plain");
      if (url === "/readyz") {
        const r = health.isReady();
        return send(res, r ? 200 : 503, r ? "ready" : "not-ready", "text/plain");
      }
      if (url === "/metrics") return send(res, 200, health.prometheus(), "text/plain; version=0.0.4");

      // ---- auth ----
      if (url === "/api/auth/signup" && method === "POST") {
        const b = await readJson(req);
        const { user, error } = await users.signup(b.handle, b.password, b.displayName);
        if (error || !user) return send(res, 400, { error });
        return send(res, 200, { token: signToken(user), user });
      }
      if (url === "/api/auth/login" && method === "POST") {
        const b = await readJson(req);
        const { user, error } = await users.login(b.handle, b.password);
        if (error || !user) return send(res, 401, { error });
        return send(res, 200, { token: signToken(user), user });
      }
      if (url === "/api/auth/me" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, { user: users.get(u.handle) ?? u });
      }
      if (url === "/api/auth/profile" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const b = await readJson(req);
        const r = users.updateProfile(u.handle, {
          displayName: b.displayName,
          color: b.color,
          avatarUrl: b.avatarUrl,
          welcomeTitle: b.welcomeTitle,
        });
        return send(res, r.error ? 400 : 200, r);
      }

      // ---- platform connect (link Twitch/Kick account → post + moderate) ----
      if (url === "/api/connect/status" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const links = users.get(u.handle)?.platformLinks;
        return send(res, 200, {
          twitch: { configured: twitchConfigured(), linked: !!links?.twitch, login: links?.twitch?.login, redirectUri: twitchRedirectUri() },
          kick: { configured: kickConfigured(), linked: !!links?.kick, login: links?.kick?.login, redirectUri: kickRedirectUri() },
        });
      }
      // admin sets the Twitch app credentials from the UI (no .env / restart)
      if (url === "/api/connect/twitch/config" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        if (u.role !== "admin") return send(res, 403, { error: "admin only" });
        const b = await readJson(req);
        if (!b.clientId || !b.clientSecret) return send(res, 400, { error: "clientId and clientSecret required" });
        if (b.redirectUri && !/^https:\/\/|^http:\/\/localhost(:|\/|$)/.test(String(b.redirectUri).trim()))
          return send(res, 400, { error: "redirect URI must be HTTPS (http is only allowed for localhost)" });
        integrations.setTwitch(String(b.clientId), String(b.clientSecret), b.redirectUri ? String(b.redirectUri) : undefined);
        return send(res, 200, { ok: true });
      }
      if (url === "/api/connect/twitch/config" && method === "DELETE") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        if (u.role !== "admin") return send(res, 403, { error: "admin only" });
        integrations.clearTwitch();
        return send(res, 200, { ok: true });
      }
      // SPA fetches this (Bearer) and navigates to the returned authorize URL
      if (url === "/api/connect/twitch/start" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        if (!twitchConfigured()) return send(res, 400, { error: "Twitch isn't configured on the server" });
        const state = oauthStates.create(u.handle);
        return send(res, 200, { url: buildAuthorizeUrl(state) });
      }
      // top-level browser redirect back from Twitch (no Bearer — identity via state)
      if (url === "/api/connect/twitch/callback" && method === "GET") {
        const sp = new URL(req.url ?? "/", "http://x").searchParams;
        const code = sp.get("code");
        const state = sp.get("state");
        const rec = state ? oauthStates.consume(state) : undefined;
        const back = (q: string) => {
          res.writeHead(302, { ...CORS, location: `${WEB_URL}/app/settings?${q}` });
          res.end();
        };
        if (sp.get("error")) return back(`connect_error=${encodeURIComponent(sp.get("error_description") || sp.get("error")!)}`);
        if (!code || !rec) return back("connect_error=expired%20or%20invalid%20link%20%E2%80%94%20try%20again");
        try {
          const tokens = await exchangeCode(code);
          const owner = await getOwner(tokens.accessToken);
          users.setPlatformToken(rec.handle, "twitch", {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
            login: owner?.login,
            userId: owner?.id,
          });
          return back("connected=twitch");
        } catch (e) {
          logger.warn({ err: String(e) }, "twitch connect failed");
          return back("connect_error=connection%20failed");
        }
      }
      if (url === "/api/connect/twitch" && method === "DELETE") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        users.clearPlatformToken(u.handle, "twitch");
        return send(res, 200, { ok: true });
      }

      // ---- Kick connection (OAuth 2.1 + PKCE), mirroring Twitch ----
      if (url === "/api/connect/kick/config" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        if (u.role !== "admin") return send(res, 403, { error: "admin only" });
        const b = await readJson(req);
        if (!b.clientId || !b.clientSecret) return send(res, 400, { error: "clientId and clientSecret required" });
        if (b.redirectUri && !/^https:\/\/|^http:\/\/localhost(:|\/|$)/.test(String(b.redirectUri).trim()))
          return send(res, 400, { error: "redirect URI must be HTTPS (http is only allowed for localhost)" });
        integrations.setKick(String(b.clientId), String(b.clientSecret), b.redirectUri ? String(b.redirectUri) : undefined);
        return send(res, 200, { ok: true });
      }
      if (url === "/api/connect/kick/config" && method === "DELETE") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        if (u.role !== "admin") return send(res, 403, { error: "admin only" });
        integrations.clearKick();
        return send(res, 200, { ok: true });
      }
      if (url === "/api/connect/kick/start" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        if (!kickConfigured()) return send(res, 400, { error: "Kick isn't configured on the server" });
        const verifier = makeVerifier();
        const state = oauthStates.create(u.handle, verifier);
        return send(res, 200, { url: kickAuthorizeUrl(state, challengeOf(verifier)) });
      }
      if (url === "/api/connect/kick/callback" && method === "GET") {
        const sp = new URL(req.url ?? "/", "http://x").searchParams;
        const code = sp.get("code");
        const state = sp.get("state");
        const rec = state ? oauthStates.consume(state) : undefined;
        const back = (q: string) => {
          res.writeHead(302, { ...CORS, location: `${WEB_URL}/app/settings?${q}` });
          res.end();
        };
        if (sp.get("error")) return back(`connect_error=${encodeURIComponent(sp.get("error_description") || sp.get("error")!)}`);
        if (!code || !rec || !rec.codeVerifier) return back("connect_error=expired%20or%20invalid%20link%20%E2%80%94%20try%20again");
        try {
          const tokens = await kickExchange(code, rec.codeVerifier);
          const owner = await kickOwner(tokens.accessToken);
          users.setPlatformToken(rec.handle, "kick", {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
            login: owner?.login,
            userId: owner?.id,
          });
          return back("connected=kick");
        } catch (e) {
          logger.warn({ err: String(e) }, "kick connect failed");
          return back("connect_error=connection%20failed");
        }
      }
      if (url === "/api/connect/kick" && method === "DELETE") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        users.clearPlatformToken(u.handle, "kick");
        return send(res, 200, { ok: true });
      }

      // ---- post / moderate via a linked account ----
      if (url === "/api/platform/post" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const b = (await readJson(req)) as ChatPost;
        return send(res, 200, await platform.post(u.handle, b));
      }
      if (url === "/api/platform/mod" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        if (!isMod(u.role)) return send(res, 403, { error: "moderator role required" });
        const b = (await readJson(req)) as ModRequest;
        const result = await platform.moderate(u.handle, b);
        // audit the consequential, account-affecting actions — not deletes (high-volume and
        // self-evident; a "delete all" sweep would otherwise flood the log)
        if (b.action.kind !== "delete") modLog.record(modLogEntry(u, b, result));
        return send(res, 200, result);
      }
      // moderation audit log (who did what to whom) — mods/admins
      if (url === "/api/platform/mod-log" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        if (!isMod(u.role)) return send(res, 403, { error: "moderator role required" });
        const limit = Number(new URL(req.url ?? "/", "http://x").searchParams.get("limit")) || 100;
        return send(res, 200, { entries: modLog.list(Math.min(limit, 300)) });
      }
      // current chat modes for a channel (slow/followers/subs/emote) — powers the control bar
      if (url === "/api/platform/chat-settings" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        if (!isMod(u.role)) return send(res, 403, { error: "moderator role required" });
        const channel = new URL(req.url ?? "/", "http://x").searchParams.get("channel")?.trim();
        if (!channel) return send(res, 400, { error: "channel required" });
        return send(res, 200, await platform.chatSettings(u.handle, channel));
      }
      // the linked user's followed Twitch channels (for the add-from-follows picker)
      if (url === "/api/platform/twitch/follows" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, await platform.twitchFollows(u.handle));
      }
      // channels live on Kick right now (official API) — the "live now" add picker
      if (url === "/api/platform/kick/live" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, await platform.kickLive());
      }

      // ---- X Live HLS video (proxy past pscp.tv hotlink protection) ----
      if (url === "/api/x/resolve" && method === "GET") {
        const b = new URL(req.url ?? "/", "http://x").searchParams.get("b")?.trim();
        if (!b) return send(res, 400, { error: "b required" });
        // PRIMARY: the live x.com guest stream — `source.location` from live_video_stream/status,
        // the same guest path that powers the viewer count + chat, and exactly what x.com's own
        // web player uses for a logged-out viewer. No X_AUTH_TOKEN needed for a public broadcast.
        let master: string | null = null;
        try {
          const info = await resolveBroadcast(manager.guestAuth, b);
          master = info.hlsUrl ?? null;
        } catch (e) {
          logger.debug({ err: String(e), b }, "x guest stream resolve failed — trying legacy pscp");
        }
        // FALLBACK: the old Periscope public endpoint (dead for modern broadcasts, kept for VODs).
        if (!master) master = await resolveBroadcastMaster(b, xUserAgent);
        if (!master) return send(res, 404, { ok: false });
        return send(res, 200, { ok: true, master });
      }
      if (url === "/api/x/seg" && method === "GET") {
        const u = new URL(req.url ?? "/", "http://x").searchParams.get("u");
        if (!u) return send(res, 400, "missing u", "text/plain");
        const out = await proxyHls(u, xUserAgent, "/api/x/seg");
        if (out.buf) {
          res.writeHead(out.status, { ...CORS, "content-type": out.contentType, "cache-control": "no-cache" });
          res.end(out.buf);
          return;
        }
        return send(res, out.status, out.body ?? "", out.contentType);
      }

      // ---- cross-chat search ----
      if (url === "/api/search" && method === "GET") {
        const params = new URL(req.url ?? "/", "http://x").searchParams;
        const q = (params.get("q") ?? "").trim();
        if (!q) return send(res, 200, { results: [], durable: chatStore.durable() });
        const u = userFromReq(req);
        const found = await chatStore.search({
          q,
          platform: params.get("platform") ?? undefined,
          channel: params.get("channel") ?? undefined,
          limit: 60,
        });
        const results = found.filter((m) => rooms.canRead(u?.role, m.channel, u?.handle));
        return send(res, 200, { results, durable: chatStore.durable() });
      }
      // jump-to-context: the conversation surrounding a search hit
      if (url === "/api/messages/around" && method === "GET") {
        const params = new URL(req.url ?? "/", "http://x").searchParams;
        const id = (params.get("id") ?? "").trim();
        if (!id) return send(res, 400, { error: "id required" });
        const u = userFromReq(req);
        const msgs = await chatStore.around(id);
        const messages = msgs.filter((m) => rooms.canRead(u?.role, m.channel, u?.handle));
        return send(res, 200, { messages, durable: chatStore.durable() });
      }

      // ---- analytics ----
      if (url === "/api/stats" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const sp = new URL(req.url ?? "/", "http://x").searchParams;
        return send(res, 200, stats.snapshot(parseRange(sp), parseScope(sp)));
      }
      // live reaction fold (Reactions view) — heavy per-bucket attribution kept off the browser
      if (url === "/api/reactions" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const sp = new URL(req.url ?? "/", "http://x").searchParams;
        const binMs = Math.min(600_000, Math.max(5_000, Number(sp.get("binMs")) || 30_000));
        const sinceRaw = sp.get("sinceMs");
        const sinceMs = sinceRaw ? Math.min(12 * 3_600_000, Math.max(0, Number(sinceRaw) || 0)) : undefined;
        const channel = sp.get("channel")?.trim() || "all";
        const z = Math.min(4, Math.max(1, Number(sp.get("z")) || 2));
        return send(res, 200, reactions({ binMs, sinceMs, channel, z }));
      }
      // analytics report → LaTeX-compiled PDF (preview + download)
      if (url === "/api/stats/report" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const now = Date.now();
        const prev = lastReportAt.get(u.id) ?? 0;
        if (now - prev < REPORT_COOLDOWN_MS) return send(res, 429, { error: "slow down — report still cooling down" });
        lastReportAt.set(u.id, now);
        const sp = new URL(req.url ?? "/", "http://x").searchParams;
        const range = parseRange(sp);
        const pdf = await compileReport(stats.snapshot(range, parseScope(sp)));
        res.writeHead(200, {
          ...CORS,
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="marketbubble-analytics-${range}.pdf"`,
          "cache-control": "no-store",
        });
        res.end(pdf);
        return;
      }

      // ---- market history (period opens + daily series) ----
      if (url === "/api/history" && method === "GET") {
        return send(res, 200, { levels: history.get() });
      }
      // ---- social/search trends ----
      if (url === "/api/trends" && method === "GET") {
        return send(res, 200, trends.get());
      }
      // ---- markets + crypto news (Finviz) for the Markets → News page ----
      if (url === "/api/news" && method === "GET") {
        return send(res, 200, marketNews.get());
      }
      // ---- market sentiment gauges (crypto F&G, stock F&G, AAII) ----
      if (url === "/api/market/sentiment" && method === "GET") {
        return send(res, 200, marketSentiment.get());
      }
      // ---- Market Bubble assistant (Venice LLM, grounded in live data) ----
      if (url === "/api/assistant" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const b = await readJson(req);
        const cap = Math.min(200, Math.max(1, Number(b.maxMessages) || 12)); // client can lift the window (e.g. to summarize for /compact)
        const incoming: ChatMsg[] = Array.isArray(b.messages)
          ? b.messages
              .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
              .slice(-cap)
          : [];
        if (incoming.length === 0) return send(res, 400, { error: "no messages" });

        const s = marketSentiment.get();
        const t = trends.get().trends.slice(0, 8).map((x) => x.title);
        const ctx = [
          "You are the Market Bubble assistant — a sharp, concise analyst copilot for a crypto/markets livestream team (mods + the host).",
          "Use the live context below when relevant. Be direct, use bullets, avoid hedging and disclaimers.",
          "You can CALL TOOLS to fetch Market Bubble data on demand — market mood, trends, live + per-streamer chat analytics, full-text chat search over durable history, recorded sessions (past broadcasts), stream transcripts, connected streams, market price history, and portfolios. Use them whenever the question touches current OR past state, then answer from the results.",
          "",
          "LIVE MARKET MOOD:",
          s.cryptoFng ? `- Crypto Fear & Greed: ${s.cryptoFng.value} (${s.cryptoFng.label})` : "",
          s.stockFng ? `- Stocks Fear & Greed: ${s.stockFng.score} (${s.stockFng.rating})` : "",
          s.aaii ? `- AAII investors: ${s.aaii.bullish}% bull / ${s.aaii.neutral}% neutral / ${s.aaii.bearish}% bear` : "",
          t.length ? `TRENDING NOW: ${t.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        try {
          const base = isMod(u.role) ? aiToolDefs : []; // data tools are mod/admin-only
          const toolDefs = Array.isArray(b.tools) ? base.filter((t) => b.tools.includes(t.name)) : base;
          const { reply, mock } = await chatWithTools([{ role: "system", content: ctx }, ...incoming], toolDefs, aiExec, { provider: b.provider });
          return send(res, 200, { reply, mock });
        } catch {
          return send(res, 502, { error: "assistant unavailable" });
        }
      }
      if (url === "/api/assistant/stream" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const b = await readJson(req);
        const cap = Math.min(200, Math.max(1, Number(b.maxMessages) || 12)); // client can lift the window (e.g. to summarize for /compact)
        const incoming: ChatMsg[] = Array.isArray(b.messages)
          ? b.messages
              .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
              .slice(-cap)
          : [];
        if (incoming.length === 0) return send(res, 400, { error: "no messages" });

        const s = marketSentiment.get();
        const t = trends.get().trends.slice(0, 8).map((x) => x.title);
        const ctx = [
          "You are the Market Bubble assistant — a sharp, concise analyst copilot for a crypto/markets livestream team (mods + the host).",
          "Use the live context below when relevant. Be direct, use bullets, avoid hedging and disclaimers.",
          "You can CALL TOOLS to fetch Market Bubble data on demand — market mood, trends, live + per-streamer chat analytics, full-text chat search over durable history, recorded sessions (past broadcasts), stream transcripts, connected streams, market price history, and portfolios. Use them whenever the question touches current OR past state, then answer from the results.",
          "",
          "LIVE MARKET MOOD:",
          s.cryptoFng ? `- Crypto Fear & Greed: ${s.cryptoFng.value} (${s.cryptoFng.label})` : "",
          s.stockFng ? `- Stocks Fear & Greed: ${s.stockFng.score} (${s.stockFng.rating})` : "",
          s.aaii ? `- AAII investors: ${s.aaii.bullish}% bull / ${s.aaii.neutral}% neutral / ${s.aaii.bearish}% bear` : "",
          t.length ? `TRENDING NOW: ${t.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        res.writeHead(200, {
          ...CORS,
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no", // disable proxy buffering so tokens flush live
        });
        const ac = new AbortController();
        res.on("close", () => ac.abort());
        try {
          // run the tool-calling loop server-side, then stream the final answer
          const base = isMod(u.role) ? aiToolDefs : []; // data tools are mod/admin-only
          const toolDefs = Array.isArray(b.tools) ? base.filter((t) => b.tools.includes(t.name)) : base;
          const { reply, mock } = await chatWithTools([{ role: "system", content: ctx }, ...incoming], toolDefs, aiExec, {
            provider: b.provider,
          });
          for (const tok of reply.match(/\s*\S+/g) ?? [reply]) {
            if (ac.signal.aborted) break;
            res.write(`data: ${JSON.stringify({ t: tok })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ done: true, mock })}\n\n`);
        } catch {
          if (!ac.signal.aborted) res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
        }
        res.end();
        return;
      }
      if (url === "/api/assistant/status" && method === "GET") {
        return send(res, 200, { configured: llmConfigured() });
      }
      if (url === "/api/assistant/providers" && method === "GET") {
        return send(res, 200, { providers: await listProviders() });
      }
      if (url === "/api/assistant/tools" && method === "GET") {
        const u = userFromReq(req);
        // data tools are mod/admin-only; non-mods see none (they can still chat)
        const visible = isMod(u?.role) ? aiTools : [];
        return send(res, 200, { tools: visible.map((t) => ({ name: t.name, label: t.label, description: t.description })) });
      }
      // market brief → LaTeX PDF of the current market state (mods/admins)
      if (url === "/api/market/report" && method === "POST") {
        const u = userFromReq(req);
        if (!isMod(u?.role)) return send(res, 403, { error: "mods only" });
        const b = await readJson(req);
        const pdf = await compileLatex(renderMarketBrief(b));
        res.writeHead(200, {
          ...CORS,
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="marketbubble-brief.pdf"`,
          "cache-control": "no-store",
        });
        res.end(pdf);
        return;
      }

      // ---- portfolio tracker (stream trade calls) ----
      if (url === "/api/portfolios" && method === "GET") {
        return send(res, 200, { portfolios: portfolios.list() });
      }
      if (url === "/api/portfolios" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const b = await readJson(req);
        return send(res, 200, portfolios.create(b, u.handle));
      }
      // computed performance (live CoinGecko history) — read-only
      if (url === "/api/portfolios/performance" && method === "GET") {
        const perf = await computePerformance(portfolios.list(), priceHistory);
        return send(res, 200, perf);
      }
      // branded "Portfolio Performance" PDF
      if (url === "/api/portfolios/report" && method === "GET") {
        const perf = await computePerformance(portfolios.list(), priceHistory);
        const pdf = await compilePortfolioReport(perf);
        res.writeHead(200, {
          ...CORS,
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="marketbubble-portfolio.pdf"`,
          "cache-control": "no-store",
        });
        res.end(pdf);
        return;
      }
      // add / update / remove a call within a portfolio
      const pCall = url.match(/^\/api\/portfolios\/([^/]+)\/calls(?:\/([^/]+))?$/);
      if (pCall) {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const pid = decodeURIComponent(pCall[1]!);
        const cid = pCall[2] ? decodeURIComponent(pCall[2]) : undefined;
        if (method === "POST" && !cid) {
          const c = portfolios.addCall(pid, await readJson(req));
          return send(res, c ? 200 : 400, c ?? { error: "bad call" });
        }
        if (method === "POST" && cid) {
          const c = portfolios.updateCall(pid, cid, await readJson(req));
          return send(res, c ? 200 : 404, c ?? { error: "not found" });
        }
        if (method === "DELETE" && cid) {
          return send(res, 200, { removed: portfolios.removeCall(pid, cid) });
        }
      }
      // update / remove a portfolio
      const pOne = url.match(/^\/api\/portfolios\/([^/]+)$/);
      if (pOne && pOne[1] !== "performance" && pOne[1] !== "report") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const pid = decodeURIComponent(pOne[1]!);
        if (method === "POST") {
          const p = portfolios.update(pid, await readJson(req));
          return send(res, p ? 200 : 404, p ?? { error: "not found" });
        }
        if (method === "DELETE") {
          return send(res, 200, { removed: portfolios.remove(pid) });
        }
      }

      // ---- pre-stream checklists (run-of-show + team notify) ----
      if (url === "/api/checklists" && method === "GET") {
        return send(res, 200, { checklists: checklists.list() });
      }
      if (url === "/api/checklists" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const b = await readJson(req);
        const c = checklists.create(b.title || "Checklist", u.handle);
        notifyTeam({ kind: "checklist-created", title: `📋 New checklist: ${c.title}`, body: `Started by ${u.displayName}`, by: u.displayName, checklistId: c.id, at: Date.now() });
        return send(res, 200, c);
      }
      // add / update / remove an item
      const clItem = url.match(/^\/api\/checklists\/([^/]+)\/items(?:\/([^/]+))?$/);
      if (clItem) {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const cid = decodeURIComponent(clItem[1]!);
        const iid = clItem[2] ? decodeURIComponent(clItem[2]) : undefined;
        if (method === "POST" && !iid) {
          const b = await readJson(req);
          const it = checklists.addItem(cid, b.text, b.assignee, b.assigneeName);
          return send(res, it ? 200 : 400, it ?? { error: "bad item" });
        }
        if (method === "POST" && iid) {
          const b = await readJson(req);
          const cl = checklists.get(cid);
          const it = checklists.updateItem(cid, iid, b, u.displayName);
          if (!it) return send(res, 404, { error: "not found" });
          if (b.done === true) {
            notifyTeam({ kind: "checklist-done", title: `✅ ${u.displayName} finished a task`, body: `“${it.text}” · ${cl?.title ?? "checklist"}`, by: u.displayName, checklistId: cid, at: Date.now() });
            const fresh = checklists.get(cid);
            if (fresh && fresh.items.length > 0 && fresh.items.every((x) => x.done)) {
              notifyTeam({ kind: "checklist-complete", title: `🎉 ${fresh.title} complete`, body: `All ${fresh.items.length} tasks done — ready to go live`, by: u.displayName, checklistId: cid, at: Date.now() });
            }
          } else if (b.done === false) {
            notifyTeam({ kind: "checklist-reopened", title: `↩︎ ${u.displayName} reopened a task`, body: `“${it.text}” · ${cl?.title ?? "checklist"}`, by: u.displayName, checklistId: cid, at: Date.now() });
          }
          return send(res, 200, it);
        }
        if (method === "DELETE" && iid) {
          return send(res, 200, { removed: checklists.removeItem(cid, iid) });
        }
      }
      const clOne = url.match(/^\/api\/checklists\/([^/]+)$/);
      if (clOne && method === "DELETE") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, { removed: checklists.remove(decodeURIComponent(clOne[1]!)) });
      }

      // ---- show planning (episodes / guests / schedule) ----
      if (url === "/api/episodes" && method === "GET") {
        return send(res, 200, { episodes: shows.list() });
      }
      if (url === "/api/episodes" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, shows.create(await readJson(req), u.handle));
      }
      const epOne = url.match(/^\/api\/episodes\/([^/]+)$/);
      if (epOne) {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const eid = decodeURIComponent(epOne[1]!);
        if (method === "POST") {
          const e = shows.update(eid, await readJson(req));
          return send(res, e ? 200 : 404, e ?? { error: "not found" });
        }
        if (method === "DELETE") {
          return send(res, 200, { removed: shows.remove(eid) });
        }
      }
      // guest intel — recent X posts for a handle (on-demand, via the Nitter pool)
      if (url === "/api/x/recent" && method === "GET") {
        const handle = new URL(req.url ?? "/", "http://x").searchParams.get("handle")?.trim();
        if (!handle) return send(res, 400, { error: "handle required" });
        const posts = await news.recentForHandle(handle);
        return send(res, 200, { posts });
      }

      // ---- live transcription (Python worker control + caption ingest) ----
      if (url === "/api/transcribe" && method === "GET") {
        const health2 = await transcription.health();
        return send(res, 200, { active: transcription.list(), worker: health2 });
      }
      if (url === "/api/transcribe" && method === "POST") {
        const u = userFromReq(req);
        if (!isMod(u?.role)) return send(res, 403, { error: "mods only" });
        const b = await readJson(req);
        const r = await transcription.start(String(b.connector || ""), b.label);
        return send(res, r.ok ? 200 : 400, r);
      }
      const txStop = url.match(/^\/api\/transcribe\/(.+)$/);
      if (txStop && method === "DELETE") {
        const u = userFromReq(req);
        if (!isMod(u?.role)) return send(res, 403, { error: "mods only" });
        return send(res, 200, await transcription.stop(decodeURIComponent(txStop[1]!)));
      }
      // caption ingest — called by the Python worker. Auth: shared secret when
      // TRANSCRIBE_SECRET is set; otherwise fail closed to loopback only (never
      // accept spoofed captions from the public internet).
      if (url === "/api/captions" && method === "POST") {
        const b = await readJson(req);
        const authed = transcribeSecret ? b.secret === transcribeSecret : isLoopback(req);
        if (!authed) return send(res, 401, { error: "unauthorized" });
        const ok = transcription.ingest(b);
        return send(res, ok ? 200 : 400, { ok });
      }

      // ---- recording sessions (mod-controlled) ----
      if (url === "/api/streamers" && method === "GET") {
        return send(res, 200, { streamers: streamers.list() });
      }
      // toggle a streamer's capture settings (record-on-live / transcribe-on-live)
      if (url?.startsWith("/api/streamers/") && method === "PATCH") {
        const u = userFromReq(req);
        if (!isMod(u?.role)) return send(res, 403, { error: "mods only" });
        const id = decodeURIComponent(url.slice("/api/streamers/".length));
        const b = await readJson(req);
        const patch: { recordSessions?: boolean; transcribe?: boolean } = {};
        if (typeof b.recordSessions === "boolean") patch.recordSessions = b.recordSessions;
        if (typeof b.transcribe === "boolean") patch.transcribe = b.transcribe;
        const s = streamers.setSettings(id, patch);
        if (!s) return send(res, 404, { error: "unknown streamer" });
        return send(res, 200, { ok: true });
      }
      if (url === "/api/sessions" && method === "GET") {
        return send(res, 200, { sessions: sessions.list() });
      }
      // per-session PDF report (LaTeX)
      if (url === "/api/sessions/report" && method === "GET") {
        const id = new URL(req.url ?? "/", "http://x").searchParams.get("id")?.trim();
        const session = id ? sessions.get(id) : undefined;
        if (!session) return send(res, 404, { error: "no such session" });
        const pdf = await compileReport(sessionSnapshot(session));
        res.writeHead(200, {
          ...CORS,
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="marketbubble-session-${id}.pdf"`,
          "cache-control": "no-store",
        });
        res.end(pdf);
        return;
      }
      // recorded session transcript (captions) — for replaying a past show on the
      // Reactions page. Read-only, matching the /api/sessions list exposure.
      {
        const capMatch = url?.match(/^\/api\/sessions\/([^/]+)\/captions$/);
        if (capMatch && method === "GET") {
          const id = decodeURIComponent(capMatch[1]!);
          if (!sessions.get(id)) return send(res, 404, { error: "no such session" });
          const rows = await captions.forSession(id);
          return send(res, 200, { captions: rows.map((c) => ({ t: c.startMs, text: c.text, conf: c.conf ?? null })) });
        }
      }
      if (url === "/api/sessions/start" && method === "POST") {
        const u = userFromReq(req);
        if (!isMod(u?.role)) return send(res, 403, { error: "mods only" });
        const b = await readJson(req);
        const r = sessions.start(String(b.streamerId || ""), u!.displayName, b.xUrl ? String(b.xUrl) : undefined);
        return send(res, r.ok ? 200 : 400, r);
      }
      if (url === "/api/sessions/stop" && method === "POST") {
        const u = userFromReq(req);
        if (!isMod(u?.role)) return send(res, 403, { error: "mods only" });
        const b = await readJson(req);
        const r = await sessions.stop(String(b.sessionId || ""));
        return send(res, r.ok ? 200 : 400, r);
      }

      // ---- admin: account management (admin only) ----
      if (url === "/api/admin/users" && method === "GET") {
        const u = userFromReq(req);
        if (u?.role !== "admin") return send(res, 403, { error: "admins only" });
        return send(res, 200, { users: users.list() });
      }
      if (url === "/api/admin/users" && method === "POST") {
        const u = userFromReq(req);
        if (u?.role !== "admin") return send(res, 403, { error: "admins only" });
        const b = await readJson(req);
        const r = await users.create(String(b.handle || ""), String(b.password || ""), String(b.displayName || ""), b.role);
        return send(res, r.error ? 400 : 200, r);
      }
      const adminUser = url.match(/^\/api\/admin\/users\/(.+)$/);
      if (adminUser && method === "PATCH") {
        const u = userFromReq(req);
        if (u?.role !== "admin") return send(res, 403, { error: "admins only" });
        const handle = decodeURIComponent(adminUser[1]!);
        const b = await readJson(req);
        if (b.role) {
          const r = users.setRole(handle, b.role);
          if (!r.ok) return send(res, 400, r);
        }
        if (b.password) {
          const r = await users.setPassword(handle, String(b.password));
          if (!r.ok) return send(res, 400, r);
        }
        return send(res, 200, { ok: true });
      }
      if (adminUser && method === "DELETE") {
        const u = userFromReq(req);
        if (u?.role !== "admin") return send(res, 403, { error: "admins only" });
        const handle = decodeURIComponent(adminUser[1]!);
        if (handle.toLowerCase() === u.handle.toLowerCase()) return send(res, 400, { error: "can't delete your own account" });
        return send(res, 200, users.remove(handle));
      }

      // ---- rooms ----
      if (url === "/api/rooms" && method === "GET") {
        const u = userFromReq(req);
        return send(res, 200, { rooms: rooms.visibleTo(u?.role, u?.handle) });
      }
      // create-or-open a private DM / group DM with one or more handles
      if (url === "/api/rooms/dm" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const b = await readJson(req);
        const withH: string[] = Array.isArray(b.with) ? b.with.map(String) : [];
        const others = withH
          .map((h) => h.trim().toLowerCase().replace(/^@/, ""))
          .filter((h) => h && h !== u.handle.toLowerCase() && !!users.get(h)); // real teammates only
        if (others.length === 0) return send(res, 400, { error: "pick at least one other person" });
        const room = rooms.ensureDm([u.handle, ...others], {
          creator: u.handle.toLowerCase(),
          nameOf: (h) => users.get(h)?.displayName,
        });
        // register + push it as a live MB column so members see it without a reload
        notifyRoom(room);
        return send(res, 200, { room });
      }
      // teammate directory for the DM people-picker (public fields only)
      if (url === "/api/users/directory" && method === "GET") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const dir = users.list().map((x) => ({ handle: x.handle, displayName: x.displayName, color: x.color, ...(x.avatarUrl ? { avatarUrl: x.avatarUrl } : {}) }));
        return send(res, 200, { users: dir });
      }
      // add participants to a private room (creator or admin)
      const addMembers = url.match(/^\/api\/rooms\/([^/]+)\/members$/);
      if (addMembers && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const id = decodeURIComponent(addMembers[1]!);
        const b = await readJson(req);
        const add: string[] = (Array.isArray(b.add) ? b.add.map(String) : []).filter((h: string) => !!users.get(h)); // real teammates only
        if (add.length === 0) return send(res, 400, { error: "pick at least one teammate" });
        const r = rooms.addMembers(id, add, { role: u.role, handle: u.handle }, (h) => users.get(h)?.displayName);
        if (!r.ok || !r.room) return send(res, r.error === "forbidden" ? 403 : 400, { error: r.error ?? "failed" });
        notifyRoom(r.room); // new members get the column; existing members' label updates
        return send(res, 200, { room: r.room });
      }
      // remove a participant from a private room (creator or admin)
      const rmMember = url.match(/^\/api\/rooms\/([^/]+)\/members\/([^/]+)$/);
      if (rmMember && method === "DELETE") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const id = decodeURIComponent(rmMember[1]!);
        const handle = decodeURIComponent(rmMember[2]!);
        const r = rooms.removeMember(id, handle, { role: u.role, handle: u.handle }, (h) => users.get(h)?.displayName);
        if (!r.ok) return send(res, r.error === "forbidden" ? 403 : 400, { error: r.error ?? "failed" });
        if (r.removed) notifyRoomRemoval(id, [handle]); // room emptied → drop it for the last member
        else {
          notifyMemberRemoval(id, handle); // drop the column for the removed member
          if (r.room) notifyRoom(r.room); // refresh label/membership for the rest
        }
        return send(res, 200, { room: r.room ?? null, removed: !!r.removed });
      }
      // rename a private room (creator or admin)
      const renameRoom = url.match(/^\/api\/rooms\/([^/]+)$/);
      if (renameRoom && method === "PATCH") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const id = decodeURIComponent(renameRoom[1]!);
        const b = await readJson(req);
        const r = rooms.rename(id, String(b.label ?? ""), { role: u.role, handle: u.handle });
        if (!r.ok || !r.room) return send(res, r.error === "forbidden" ? 403 : 400, { error: r.error ?? "failed" });
        notifyRoom(r.room);
        return send(res, 200, { room: r.room });
      }
      // globally delete a room (admin only)
      const delRoom = url.match(/^\/api\/rooms\/([^/]+)$/);
      if (delRoom && method === "DELETE") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const id = decodeURIComponent(delRoom[1]!);
        const r = rooms.remove(id, { role: u.role, handle: u.handle });
        if (!r.ok) return send(res, r.error === "forbidden" ? 403 : 400, { error: r.error ?? "failed" });
        notifyRoomRemoval(id, r.room?.members); // members → targeted; public room → everyone
        return send(res, 200, { ok: true });
      }

      // ---- tracked X accounts (Nitter news) ----
      if (url === "/api/tracked" && method === "GET") return send(res, 200, { accounts: news.list() });
      if (url === "/api/tracked" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const b = await readJson(req);
        const handle = String(b.handle || "").trim();
        if (!handle) return send(res, 400, { error: "handle required" });
        return send(res, 200, news.add(handle, String(b.category || "News")));
      }
      const td = url.match(/^\/api\/tracked\/(.+)$/);
      if (td && method === "DELETE") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const removed = news.remove(decodeURIComponent(td[1]!));
        return send(res, removed ? 200 : 404, { removed });
      }

      // ---- shared-room post (non-WS) ----
      if (url === "/api/post" && method === "POST") {
        const u = userFromReq(req);
        if (!u) return send(res, 401, { error: "unauthorized" });
        const b = await readJson(req);
        const r = mbRoom.post(u, b.room || "mb:shared", b.text || "", b.replyTo, b.embed);
        return send(res, r.ok ? 200 : 400, r);
      }

      // ---- sources ----
      if (url === "/api/sources" && method === "GET") return send(res, 200, manager.list());
      if (url === "/api/sources" && method === "POST") {
        if (!userFromReq(req)) return send(res, 401, { error: "unauthorized" });
        const body = await readJson(req);
        const hint = ["twitch", "x", "kick"].includes(body.platform) ? body.platform : "twitch";
        const raw = typeof body.value === "string" ? body.value.trim() : "";
        if (!raw) return send(res, 400, { error: "value is required" });
        const norm = normalizeSource(hint, raw);
        if (!norm.value) return send(res, 400, { error: "could not parse a channel/handle from value" });
        const spec: SourceSpec = {
          platform: norm.platform,
          value: norm.value,
          label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : undefined,
        };
        return send(res, 200, manager.add(spec));
      }
      const del = url.match(/^\/api\/sources\/(.+)$/);
      if (del && method === "DELETE") {
        if (!userFromReq(req)) return send(res, 401, { error: "unauthorized" });
        const id = decodeURIComponent(del[1]!);
        const removed = manager.remove(id);
        return send(res, removed ? 200 : 404, { id, removed });
      }

      return send(res, 404, { error: "not found" });
    } catch (e) {
      logger.error({ err: String(e), url }, "router error");
      return send(res, 500, { error: "internal error" });
    }
  };
}
