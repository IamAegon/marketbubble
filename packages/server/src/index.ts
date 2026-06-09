import { createServer } from "node:http";
import { resolve } from "node:path";
import { loadConfig } from "./config/loadConfig.js";
import { logger } from "./observability/logger.js";
import { HealthRegistry } from "./observability/health.js";
import { InMemoryBus } from "./bus/InMemoryBus.js";
import { SideBus } from "./bus/SideBus.js";
import { RingBuffer } from "./store/RingBuffer.js";
import { createDb } from "./store/db.js";
import { migrate } from "./store/migrate.js";
import { createChatStore } from "./store/createChatStore.js";
import { CaptionStore } from "./store/CaptionStore.js";
import { Deduper } from "./dedup/Deduper.js";
import { createPipeline } from "./pipeline/ingest.js";
import { WsServer } from "./ws/WsServer.js";
import { ConnectorManager, type SourceSpec } from "./connectors/ConnectorManager.js";
import { createRouter } from "./http/router.js";
import { UserStore } from "./auth/UserStore.js";
import { PlatformService } from "./platform/PlatformService.js";
import { ModLog } from "./platform/ModLog.js";
import { IntegrationStore } from "./connect/integrations.js";
import { startViewerPoller } from "./platform/viewerPoller.js";
import { RoomRegistry } from "./room/rooms.js";
import { seedRooms } from "./room/seedRooms.js";
import { MbRoom } from "./room/MbRoom.js";
import { NewsManager, type TrackedAccount } from "./news/NewsManager.js";
import { PriceStore } from "./finance/PriceStore.js";
import { startBinance } from "./finance/binance.js";
import { startCoinGecko } from "./finance/coingecko.js";
import { startMacro, MACRO_SYMBOLS } from "./finance/macro.js";
import { HistoryStore, startHistory } from "./finance/history.js";
import { TrendsStore, startTrends } from "./social/trends.js";
import { FinvizNewsStore, startFinvizNews } from "./news/finvizNews.js";
import { MarketSentimentStore, startMarketSentiment } from "./social/marketSentiment.js";
import { startPolymarket } from "./finance/polymarket.js";
import { PortfolioStore } from "./portfolio/store.js";
import { PriceHistoryStore } from "./finance/priceHistory.js";
import { ChecklistStore } from "./checklist/store.js";
import { ShowStore } from "./show/store.js";
import { TranscriptionManager } from "./transcribe/TranscriptionManager.js";
import { Sentiment, scoreSentiment } from "./finance/Sentiment.js";
import { detectCashtags } from "./finance/cashtags.js";
import { primeGlobalEmotes } from "./connectors/emoteSets.js";
import { StatsAggregator } from "./analytics/StatsAggregator.js";
import { StreamerRegistry } from "./analytics/streamers.js";
import { SessionRecorder } from "./analytics/SessionRecorder.js";
import { SessionDriver } from "./analytics/SessionDriver.js";

const cfg = loadConfig();

const bus = new InMemoryBus();
const sideBus = new SideBus();
const ring = new RingBuffer(20000);
const deduper = new Deduper();
const health = new HealthRegistry();

// --- finance (side-band): prices, sentiment, cashtags ---
const BINANCE_WATCH = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "AVAX", "LINK", "SUI"];
const CRYPTO_WATCH = [...BINANCE_WATCH, "HYPE"];
const WATCH = [...CRYPTO_WATCH, ...MACRO_SYMBOLS];
const priceStore = new PriceStore(sideBus, WATCH);
const sentiment = new Sentiment(sideBus);

// durable spine: embedded Postgres (PGlite) by default, managed Postgres via
// DATABASE_URL. Migrations own the schema; the store is always durable.
const db = await createDb();
await migrate(db);
const chatStore = await createChatStore(db);

// --- native rooms (declared before the pipeline: analytics filters mod rooms) ---
const rooms = new RoomRegistry(resolve(process.cwd(), "data/rooms-dynamic.json"));

// streamer registry: maps channels to owned (Ansem/Faze) vs external streamers
const streamers = new StreamerRegistry(resolve(process.cwd(), "data/streamers.json"));

// rolling analytics: folds every chat message per-streamer (mod rooms excluded)
const stats = new StatsAggregator(streamers, {
  canRecord: (channel) => rooms.canRead(undefined, channel),
  durable: () => chatStore.durable(),
});

// mod-controlled recording sessions (durable, the basis for historical analytics)
const sessions = new SessionRecorder({ streamers, db, legacyJsonPath: resolve(process.cwd(), "data/analytics/sessions.json") });
await sessions.init(); // load history from the DB (importing legacy sessions.json once)
stats.setRecordingCheck((id) => sessions.isRecording(id));
// durable transcript store (live captions persisted as first-class rows)
const captionStore = new CaptionStore(db);

// boot-rebuild: replay durable history so live analytics + WS backfill survive a
// server restart (no-op without a durable store; never blocks startup).
if (chatStore.durable()) {
  try {
    const replayMsgs = await chatStore.recent({ sinceMs: 6 * 60 * 60_000, limit: 50_000 });
    for (const m of replayMsgs) ring.append(m);
    stats.replay(replayMsgs);
    logger.info({ count: replayMsgs.length }, "boot-rebuild: replayed durable history");
  } catch (e) {
    logger.warn({ err: String(e) }, "boot-rebuild skipped (history unavailable)");
  }
}

const pipeline = createPipeline({
  bus,
  ring,
  deduper,
  health,
  store: chatStore,
  stats,
  sessions,
  enrich: (m) => {
    // single source of enrichment: compute cashtags + sentiment ONCE and stamp
    // them onto the message; all downstream folds/gauges read these fields.
    m.cashtags = detectCashtags(m.text);
    m.sentiment = scoreSentiment(m.text);
    sentiment.observe(m);
  },
});

// --- live transcription (Python worker pulls HLS audio → STT → captions) ---
const transcription = new TranscriptionManager({
  pipeline,
  workerUrl: process.env.TRANSCRIBER_URL || "http://127.0.0.1:8799",
  callbackUrl: `http://localhost:${cfg.port}/api/captions`,
  captions: captionStore,
  resolveSession: (channel, label) => sessions.activeSessionFor(channel, label),
});

// auto-recording: live-state → sessions, no manual button. The viewer poller feeds
// the live set each tick; a mod can still start/stop manually as an override.
const sessionDriver = new SessionDriver({ streamers, sessions, transcription });

// --- auth + native rooms ---
const users = new UserStore(resolve(process.cwd(), "data/users.json"));
// applies any admin-saved OAuth app credentials before the platform layer uses them
const integrations = new IntegrationStore(resolve(process.cwd(), "data/integrations.json"));
const platform = new PlatformService(users);
const modLog = new ModLog(resolve(process.cwd(), "data/modlog.json"));
const mbRoom = new MbRoom(pipeline, rooms, users);
for (const r of rooms.list()) {
  health.register(r.id, "mb", r.label);
  health.setStatus(r.id, { kind: "connected" });
}
seedRooms(pipeline, rooms);

// --- http + ws ---
const server = createServer();
const ws = new WsServer(server, bus, sideBus, ring, health, mbRoom, rooms, chatStore);

const manager = new ConnectorManager({
  pipeline,
  health,
  x: cfg.x,
  kick: cfg.kick,
  onStatus: (info) => ws.broadcastStatus(info),
  persistPath: resolve(process.cwd(), "data/sources.json"),
});

const seed: SourceSpec[] = [];
for (const ch of cfg.channels.twitch) seed.push({ platform: "twitch", value: ch });
for (const b of cfg.channels.x.broadcasts) {
  const value = typeof b === "string" ? b : b.broadcast;
  const label = typeof b === "string" ? undefined : b.label;
  seed.push({ platform: "x", value, label });
}
for (const k of cfg.channels.kick) {
  const value = typeof k === "string" ? k : k.slug;
  const chatroomId = typeof k === "string" ? undefined : k.chatroomId;
  seed.push({ platform: "kick", value, chatroomId });
}
for (const spec of manager.initialSpecs(seed)) manager.add(spec);
logger.info({ count: manager.list().length, rooms: rooms.list().length }, "sources + rooms initialized");

// warm the global 3rd-party emote set (7TV/BTTV/FFZ) so first messages resolve
primeGlobalEmotes();

// --- start finance feeds ---
const financeAbort = new AbortController();
priceStore.start();
sentiment.start();
startBinance(priceStore, BINANCE_WATCH, financeAbort.signal);
startCoinGecko(priceStore, ["HYPE"], financeAbort.signal);
startMacro(priceStore, financeAbort.signal);
startPolymarket(sideBus, financeAbort.signal);
// live Twitch viewer counts for connected channels (app token; no-op if unconfigured)
startViewerPoller({
  sideBus,
  signal: financeAbort.signal,
  twitchLogins: () => manager.list().filter((c) => c.platform === "twitch").map((c) => c.id.replace(/^twitch:#/, "")),
  kickChannels: () =>
    manager.list().filter((c) => c.platform === "kick").map((c) => ({ id: c.id, slug: c.id.replace(/^kick:#?/, "") })),
  xBroadcasts: () =>
    manager
      .list()
      .filter((c) => c.platform === "x" && !c.id.startsWith("xnews:"))
      .map((c) => ({ id: c.id, broadcastId: c.id.replace(/^x:/, "") })),
  xAuth: manager.guestAuth,
  onLive: (ids) => sessionDriver.onLive(ids),
});
const history = new HistoryStore();
startHistory(history, financeAbort.signal);
const trends = new TrendsStore();
startTrends(trends, financeAbort.signal);
const marketNews = new FinvizNewsStore();
startFinvizNews(marketNews, financeAbort.signal);
const marketSentiment = new MarketSentimentStore(resolve(process.cwd(), "data/sentiment-cache.json"));
startMarketSentiment(marketSentiment, financeAbort.signal);

// --- portfolio tracker (stream trade calls + auto report) ---
const portfolios = new PortfolioStore(resolve(process.cwd(), "data/portfolios.json"));
const priceHistory = new PriceHistoryStore(resolve(process.cwd(), "data/price-history-cache.json"));

// --- pre-stream checklists (run-of-show + team notify) ---
const checklists = new ChecklistStore(resolve(process.cwd(), "data/checklists.json"));

// --- show planning (episodes / guests / schedule) ---
const shows = new ShowStore(resolve(process.cwd(), "data/episodes.json"));

// --- tracked X accounts (Nitter news) ---
const news = new NewsManager({
  pipeline,
  health,
  userAgent: cfg.x.userAgent,
  onStatus: (info) => ws.broadcastStatus(info),
  persistPath: resolve(process.cwd(), "data/tracked.json"),
});
const TRACKED_SEED: TrackedAccount[] = [
  { handle: "saylor", category: "Crypto" },
  { handle: "CryptoHayes", category: "Crypto" },
  { handle: "cz_binance", category: "Crypto" },
  { handle: "cobie", category: "Traders" },
  { handle: "blknoiz06", category: "Traders" },
  { handle: "HsakaTrades", category: "Traders" },
  { handle: "DeItaone", category: "News" },
  { handle: "Osint613", category: "News" },
  { handle: "TrumpDailyPosts", category: "Politics" },
  { handle: "elonmusk", category: "Tech" },
  { handle: "anthropicai", category: "Tech" },
  { handle: "Banks", category: "Creators" },
  { handle: "notthreadguy", category: "Creators" },
];
for (const a of news.initial(TRACKED_SEED)) news.add(a.handle, a.category);

server.on("request", createRouter({ manager, health, users, mbRoom, rooms, news, chatStore, captions: captionStore, stats, ring, sessions, streamers, history, trends, marketNews, marketSentiment, portfolios, priceHistory, checklists, shows, transcription, platform, modLog, integrations, transcribeSecret: process.env.TRANSCRIBE_SECRET || "", notifyTeam: (e) => ws.broadcastTeam(e), notifyRoom: (r) => ws.announceRoom(r), notifyRoomRemoval: (id, audience) => ws.announceRoomRemoval(id, audience), notifyMemberRemoval: (id, h) => ws.announceMemberRemoval(id, h), xUserAgent: cfg.x.userAgent }));
server.listen(cfg.port, () => logger.info(`server listening on http://localhost:${cfg.port} (ws: /ws)`));

// --- graceful shutdown ---
let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ sig }, "shutting down");
    financeAbort.abort();
    priceStore.stop();
    sentiment.stop();
    manager.stopAll();
    news.stopAll();
    // persist in-flight data before exit: finalize active recordings, then drain
    // the durable write queue and close the DB so nothing is lost on SIGTERM.
    try {
      await sessions.shutdown();
    } catch (e) {
      logger.warn({ err: String(e) }, "session shutdown-persist failed");
    }
    try {
      await chatStore.close();
      await db.close();
    } catch (e) {
      logger.warn({ err: String(e) }, "store flush/close failed");
    }
    ws.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
