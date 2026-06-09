# MarketBubble — Architecture

A trading-streamer command center. pnpm monorepo:

- **`@app/server`** — Node/tsx, port **8787**, no watch (manual restart). Ingests chat from
  Twitch/Kick/X, runs the realtime fan-out, analytics, finance/social feeds, native rooms,
  and the AI assistant.
- **`@app/web`** — React + Vite SPA, port **5173** (HMR). Dashboard + OBS overlay.
- **`@app/shared`** — shared TypeScript types (the `ChatMessage`, envelope, stats contracts).

These diagrams are **Mermaid**. View them in any Mermaid-aware Markdown preview
(VS Code "Markdown Preview Mermaid Support", GitHub, etc.).

---

## 1. System containers (the big picture)

```mermaid
flowchart LR
  subgraph EXT["External platforms & data"]
    TW["Twitch IRC"]
    KK["Kick Pusher WS"]
    XX["X / Periscope broadcast chat"]
    NT["Nitter (tracked X posts)"]
    MK["Markets:<br/>Binance · CoinGecko · CNBC macro · Polymarket"]
    AU["Stream HLS audio"]
  end

  PYW["Transcriber worker<br/>(Python · HLS → speech-to-text)"]

  subgraph SRV["@app/server — Node/tsx :8787"]
    CONN["Connector layer"]
    PIPE["Ingest pipeline"]
    CORE["Bus + SideBus + RingBuffer + Health"]
    ANA["Analytics + SessionRecorder + StreamerRegistry"]
    FED["Market/social feeds + viewerPoller"]
    RM["Rooms + Auth + PlatformService"]
    AIS["AI assistant (llm + tools)"]
    API["HTTP /api/*"]
    WSS["WebSocket /ws"]
  end

  subgraph DB["Persistence"]
    MEMS["In-memory ChatStore"]
    PGS["Postgres (PgChatStore, optional)"]
    FILES["data/*.json"]
  end

  PROV["AI providers:<br/>Ollama (local) · Venice · OpenAI · Anthropic"]

  subgraph FE["@app/web — React+Vite :5173"]
    SPA["Dashboard SPA (views)"]
    OVL["/overlay (OBS browser source)"]
  end

  TW --> CONN
  KK --> CONN
  XX --> CONN
  NT --> CONN
  AU --> PYW
  PYW -->|"POST /api/captions"| API
  MK --> FED

  CONN --> PIPE --> CORE
  PIPE --> ANA
  PIPE -->|"persist"| MEMS
  MEMS -.->|"if DATABASE_URL"| PGS
  FED --> CORE
  ANA --> FILES
  RM --> FILES

  CORE --> WSS
  API --> AIS --> PROV
  AIS --> ANA
  AIS --> MEMS

  WSS <-->|"WS: live messages, status, market data"| SPA
  API <-->|"REST + SSE"| SPA
  WSS --> OVL
```

---

## 2. Chat-message ingest pipeline (what happens to every message)

Every message — from a platform connector, a tracked-account tweet, a live caption, or a
native room post — funnels through one `pipeline.ingest()` path: **dedup → enrich → fan out
to ring, store, analytics, recorder, and the live bus**.

```mermaid
flowchart TB
  subgraph SRC["Message sources"]
    A1["TwitchIrcConnector"]
    A2["XLiveChatConnector<br/>(Periscope WS)"]
    A3["KickPusherConnector"]
    A4["XNitterConnector<br/>(NewsManager · kind:post)"]
    A5["TranscriptionManager<br/>(/api/captions · kind:caption)"]
    A6["MbRoom.post()<br/>(native rooms · platform:mb)"]
  end

  A1 --> CM["ConnectorManager<br/>(SupervisedConnector: retry + backoff)"]
  A2 --> CM
  A3 --> CM
  CM --> ING["pipeline.ingest(connectorId, msg)"]
  A4 --> ING
  A5 --> ING
  A6 --> ING

  ING --> DD{"Deduper<br/>(platform + platformMsgId)"}
  DD -->|"duplicate"| DROP["drop"]
  DD -->|"new"| EN["enrich:<br/>detectCashtags(text)<br/>sentiment.observe(msg)"]

  EN --> R["RingBuffer<br/>(last 8000, backfill window)"]
  EN --> CS["chatStore<br/>(durable history + search)"]
  EN --> ST["StatsAggregator.fold()<br/>(live rates; skips mod/private rooms)"]
  EN --> SR["SessionRecorder<br/>(folds only while a session is recording)"]
  EN --> PUB["bus.publish(msg)"]

  PUB --> WS["WsServer<br/>(per-client ACL + filters)"]
  WS --> CLIENTS["Subscribed web clients + overlay"]

  CS --> PG["Postgres (PgChatStore)"]
  CS --> MEM["In-memory (RingBuffer-backed)"]
```

---

## 3. Side-band feeds (market / social / viewers)

Market and presence data never touch the chat bus — they ride the **SideBus**, which
snapshots the last message of each type and **replays it to every client on connect** (so a
fresh tab sees prices/markets immediately). Slower aggregates are served over REST.

```mermaid
flowchart LR
  B1["Binance WS"] --> PS["PriceStore"]
  B2["CoinGecko"] --> PS
  B3["CNBC macro"] --> PS
  SE["Sentiment (from chat enrich)"] --> SB["SideBus"]
  PS -->|"price / ticker"| SB
  PM["Polymarket"] -->|"markets"| SB
  VP["viewerPoller<br/>(Twitch/Kick/X live APIs)"] -->|"viewers + live[]"| SB

  SB -->|"snapshot replayed on connect"| WS["WsServer /ws"]
  WS --> WEB["Web panels:<br/>prices · markets · viewers · sentiment"]

  TRq["TrendsStore"] -. "GET /api/trends" .-> API["HTTP router"]
  MSq["MarketSentimentStore"] -. "GET /api/market-sentiment" .-> API
  HSq["HistoryStore / PriceHistory"] -. "GET /api/history" .-> API
  API --> WEB
```

---

## 4. Realtime WebSocket protocol

```mermaid
sequenceDiagram
  participant C as Web client
  participant W as WsServer (/ws)
  participant B as InMemoryBus (chat)
  participant S as SideBus (market)

  C->>W: connect
  W-->>C: welcome (public connector list)
  W-->>C: side-band snapshot (prices, markets, sentiment, viewers)
  C->>W: hello { token, filters, backfill }
  W-->>C: welcome (role-scoped connectors)
  W-->>C: backfill (recent messages, ACL-filtered)

  Note over W,B: live loop
  B-->>W: new ChatMessage
  W-->>C: message (only if canRead + matches filters)

  Note over W,S: connector lifecycle + market
  W-->>C: status (connected / reconnecting / idle:removed)
  S-->>W: tick / viewers
  W-->>C: ticker · price · viewers · sentiment

  Note over C,B: posting to a native room
  C->>W: post { room, text, replyTo?, embed? }
  W->>B: mbRoom.post() → pipeline.ingest()
```

---

## 5. Frontend route map

```mermaid
flowchart TB
  ROOT["/ → Landing (auth)"]
  OVL["/overlay → OverlayApp (public · OBS source)"]
  APP["/app → AppShell (Protected)"]
  ROOT -. "after login" .-> APP

  APP --> LV["index → LiveView"]
  APP --> MK["markets → MarketsView"]
  APP --> PF["portfolio → PortfolioView"]
  APP --> ST["studio → StudioLayout"]
  ST --> SP["index → ShowPlanningView"]
  ST --> RUN["run → ChecklistView"]
  APP --> TRN["trends → TrendsView"]
  APP --> RM["rooms → RoomsView"]
  APP --> AS["assistant → AssistantView"]
  APP --> AN["analytics → AnalyticsLayout"]
  AN --> PULSE["index → AnalyticsView (Pulse / live)"]
  AN --> RX["reactions → PerformanceLab"]
  AN --> TX["transcript → TranscriptView"]
  AN --> SESS["sessions → HistoryView"]
  AN --> SREP["sessions/:id → SessionReport"]
  AN --> CMP["compare → ComparisonView"]
  APP --> SET["settings → SettingsView"]
```

---

## 6. AI assistant grounding

The assistant streams over SSE. It picks a provider (Ollama by default, local-first) and is
"grounded" by a fixed set of tools that read live server state.

```mermaid
flowchart LR
  CMP["Assistant composer (web)"] -->|"SSE stream"| RT["/api/assistant route"]
  RT --> LLM["llm.ts — provider registry"]
  LLM --> P1["Ollama (local, default)"]
  LLM --> P2["Venice"]
  LLM --> P3["OpenAI"]
  LLM --> P4["Anthropic"]

  RT --> TL["tools.ts — grounding tools"]
  TL --> T1["get_market_mood → Sentiment / PriceStore"]
  TL --> T2["get_trends → TrendsStore"]
  TL --> T3["get_stream_stats → StatsAggregator"]
  TL --> T4["search_chat → chatStore"]
  TL --> T5["get_live_streams → viewers / connectors"]
  TL --> T6["get_portfolios → PortfolioStore"]
```

> Note: there is currently **no transcript/caption tool** and the assistant reads the **live
> snapshot**, not durable session history. Those gaps are part of the in-progress analytics
> redesign.

---

## Persistence map (where state lives)

| Store | Backing | Survives restart? |
|---|---|---|
| Recent chat (backfill window) | `RingBuffer` (in-memory, 8000) | No (rebuilt from durable on boot) |
| Durable chat + search | `PgChatStore` if `DATABASE_URL`, else in-memory `ChatStore` | Postgres: yes · in-memory: no |
| Live analytics | `StatsAggregator` (in-memory fold) | No (replayed from durable on boot) |
| Recording sessions | `data/analytics/sessions.json` | Yes |
| Native rooms | `data/rooms-dynamic.json` | Yes |
| Streamer identities | `data/streamers.json` | Yes |
| Users / auth | `data/users.json` | Yes |
| OAuth app creds | `data/integrations.json` | Yes |
| Runtime-added sources | `data/sources.json` | Yes |
| Tracked X accounts | `data/tracked.json` | Yes |
| Portfolios | `data/portfolios.json` | Yes |
| Checklists | `data/checklists.json` | Yes |
| Show episodes | `data/episodes.json` | Yes |
| Market caches | `data/sentiment-cache.json`, `data/price-history-cache.json` | Yes |
