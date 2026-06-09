# MarketBubble

**A live trading‑streamer command center** — one cockpit that pulls every channel's live chat, the markets, your portfolio, show prep, analytics, and an AI co‑pilot into a single surface. Think *TweetDeck‑for‑livestreams* fused with a trading desk: a producer or moderator can run a live trading broadcast without juggling ten tabs.

Built for the **Market Bubble Vibe Code Challenge**. 🎥 [Demo video](https://youtu.be/hLcGXGdQqas)

```
 Twitch IRC ┐
 Kick Pusher ├─► supervised connectors ─► ingest (dedup → enrich) ─► ring + durable store + analytics ─► bus
 X / Periscope ┘                                                                                          │
 tracked X posts · live captions · native rooms ─────────────────────────────────────────────────────────┤
                                                                                                          ▼
                                              WebSocket fan‑out  ─►  React dashboard · OBS overlay
```

---

## What it does

Everything flows through **one pipeline**: a message arrives from any source → it's normalized into a single `ChatMessage`, deduped, scored for sentiment, tagged with cashtags → then it fans out three ways — broadcast to every connected screen over WebSocket, folded into live analytics, and persisted to the database. Every screen is just a *view* onto that one stream of truth.

### Feature surfaces

- **Live cockpit** — every platform's chat merged into one feed (**Unified**) or side‑by‑side (**Columns**), each message tagged by source. Click a chatter to filter the whole feed to just them. A video dock plays the live streams (including **X broadcast video**, proxied HLS) in theater or grid. A markets ticker tape with a live **NYSE session clock** runs across the top, plus live viewer counts per stream.
- **Markets** — live crypto prices (Binance / CoinGecko), macro, **Polymarket** odds, and a chat‑derived sentiment gauge, all pushed in real time.
- **Rooms & DMs** — Discord‑style native team chat with channels and direct messages. A multi‑destination composer fans one message out to several rooms *and* connected platform chats at once.
- **Moderation** — connect your **Twitch / Kick** account (OAuth, tokens stay server‑side) and post + moderate as yourself: timeout / ban / unban / delete / chat‑modes / clear, via an inline per‑message mod menu and a per‑channel control bar, with an **undo window** and a persisted **audit log**.
- **Analytics** — *Pulse* (live hype score, acceleration + spike markers, per‑stream sentiment, new‑vs‑returning chatters, most‑reacted messages, rising emotes/cashtags), *Reactions*, mod‑controlled **session recording**, per‑session **reports** (KPIs + charts + PDF), and session **comparison**.
- **Trends** — "what the internet is talking about" across free social/news sources (Bluesky, Mastodon, Reddit, Google Trends/News); TikTok/Instagram optionally via an Apify actor.
- **AI assistant** — a streaming co‑pilot, *grounded* by tools that read live server state: market mood, trends, stream stats, chat search, who's live, and portfolios. Bring your own provider — a **Venice**, **ChatGPT (OpenAI)**, or **Claude (Anthropic)** API key — or run it locally on an **Ollama** model.
- **Portfolio** — holdings tracking + a performance report.
- **Studio** — show planning + a run‑of‑show checklist.
- **Live transcription** — a Python worker turns stream HLS audio into searchable speech‑to‑text captions.
- **OBS overlay** — a public `/overlay` route usable as a browser source.

---

## Architecture

A **pnpm monorepo**:

| Package | What it is |
|---|---|
| **`@app/server`** | Node + `tsx`, port **8787**. Chat ingest, realtime fan‑out, analytics, finance/social feeds, native rooms, auth, platform OAuth, and the AI assistant. |
| **`@app/web`** | React + Vite SPA, port **5173**. The dashboard + the OBS overlay. |
| **`@app/shared`** | Shared TypeScript types (`ChatMessage`, the WS envelope, stats contracts). |
| **`transcriber`** | Python worker: stream HLS audio → speech‑to‑text → `POST /api/captions`. |

**Realtime:** chat messages ride an in‑memory bus → `WsServer` fans them out to clients with per‑client ACL + filters. Market/presence data rides a separate **SideBus** whose latest snapshot is replayed to every client on connect, so a fresh tab sees prices instantly. New clients get a **backfill** of recent history on `hello`.

**Persistence:** durable by default via embedded **PGlite** (`packages/server/data/pgdata`), or a managed **Postgres** when `DATABASE_URL` is set. The in‑memory `RingBuffer` is a hot cache for live fan‑out + backfill; on boot the server replays recent durable history back into it, so a refresh keeps your scrollback and analytics. Low‑traffic room/DM and tracked‑post history is read straight from the durable store so the high‑volume chat firehose can't evict it.

📐 Full diagrams (system containers, ingest pipeline, side‑band feeds, WS protocol, route map, AI grounding, persistence map) are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (Mermaid).

### How each platform is read

- **Twitch** — anonymous chat over IRC‑WebSocket (`justinfan` nick). No API key needed to read.
- **Kick** — the `chatroom_id` is Cloudflare‑gated, so it's resolved once with a headless Chrome/Chromium fingerprint (cached), then chat streams over Kick's public Pusher socket.
- **X (broadcasts)** — there's no public API for live‑broadcast chat, so the app uses X's own guest web endpoints (the `pscp.tv` / Periscope infrastructure X Live still runs on). **Video + viewer counts work for guests out of the box** (HLS proxied through the server to satisfy hotlink protection). **Reading the live chat messages** requires a logged‑in `X_AUTH_TOKEN` cookie — without it a broadcast connects but only reports occupancy.
- **Tracked X accounts (news posts)** — polled from X's **syndication** timeline (primary) with a **Nitter** pool fallback. No paid API.

---

## Getting started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** 9 (`corepack enable` pins the version from `package.json`)
- *(optional)* **Chrome/Chromium** — only needed to read Kick chat (auto‑detected; override with `KICK_CHROME_BIN`)
- *(optional)* **Ollama** — only if you want to run the AI assistant locally instead of with a hosted API key (`ollama serve`, then e.g. `ollama pull qwen2.5:7b`)
- *(optional)* **Python 3** — only for the live‑transcription worker

### Install & configure

```bash
git clone <your-repo-url> marketbubble
cd marketbubble
pnpm install

# server config — copy the template and fill in what you need (all optional to start)
cp .env.example packages/server/.env
```

Twitch chat, X broadcast video, markets, and trends all work **without any keys**. Add to `packages/server/.env` only what you want to unlock:

| Variable | Unlocks |
|---|---|
| `X_AUTH_TOKEN` | Reading **X broadcast chat messages** (a logged‑in `auth_token` cookie — a **burner account is recommended**). |
| `VENICE_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | The **AI assistant** provider — Venice, ChatGPT, or Claude. |
| `OLLAMA_MODEL` | Or run the assistant locally on an Ollama model (e.g. `qwen2.5:7b`). |
| `DATABASE_URL` | A managed Postgres instead of the embedded PGlite. |
| `TRENDS_APIFY_TOKEN` (+ actor slugs) | TikTok / Instagram trends lanes. |

> Twitch/Kick **account linking** (post + moderate) is configured in‑app at **Settings → Connections** — paste your OAuth app Client ID/Secret there; no `.env` edit or restart needed.

### Run

```bash
pnpm dev          # server (:8787) + web (:5173) together
# or individually:
pnpm dev:server
pnpm dev:web
```

Then open **http://localhost:5173**. The **first account you create becomes the admin.**

```bash
pnpm typecheck    # type-check every package
pnpm build        # production build of all packages
```

---

## Security & secrets

- **`packages/server/.env`** (your `X_AUTH_TOKEN`, Apify token, DB URL, hosted‑LLM keys) and **`packages/server/data/`** (the database, `users.json` password hashes, OAuth app creds, audit log) are **gitignored** and never leave the server. Account passwords are bcrypt‑hashed; OAuth tokens are stored server‑side and never sent to the browser.
- The only credentials in `.env.example` are **public constants** that x.com / kick.com themselves use — there are no real secrets in the repo.
- Use a **burner X account** for `X_AUTH_TOKEN`; automated access can get accounts limited.

---

## Project structure

```
packages/
  server/          @app/server — Node/tsx API + WebSocket (:8787)
    src/
      connectors/  Twitch / Kick / X live-chat + tracked-post connectors
      pipeline/    ingest (dedup → enrich → fan-out)
      store/       RingBuffer + PgChatStore (durable history + search)
      bus/         chat bus + market SideBus
      ws/          WebSocket fan-out (ACL + filters + backfill)
      analytics/   stats aggregator, session recorder, reports
      finance/     prices, sentiment, cashtags
      news/        tracked X accounts, market news
      room/        native rooms + DMs
      platform/    Twitch/Kick post + moderate (OAuth)
      ai/          assistant LLM router + grounding tools
    data/          runtime state (gitignored)
  web/             @app/web — React + Vite SPA + OBS overlay (:5173)
    src/views/     Live, Markets, Portfolio, Studio, Trends, Rooms, Assistant, Analytics, Settings
  shared-types/    @app/shared — ChatMessage, WS envelope, stats contracts
transcriber/       Python HLS → speech-to-text worker
docs/              ARCHITECTURE.md (+ design notes)
```

---

## License

See `LICENSE` if present; otherwise all rights reserved by the author.
