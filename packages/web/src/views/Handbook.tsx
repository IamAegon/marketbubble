import { useMemo, useState } from "react";
import { mdToHtml } from "../lib/markdown";

// The Market Bubble team handbook — the internal manual for the crew that runs
// the show. Lives inside Settings (mods/admins only). Content-driven: every
// topic is a markdown string rendered through the same minimal mdToHtml the
// feed uses, so it stays trivial to keep current. Landing grid → focused reader.

interface Topic {
  id: string;
  group: string;
  title: string;
  icon: string;
  hint: string;
  body: string;
}

const TOPICS: Topic[] = [
  {
    id: "overview",
    group: "Start here",
    title: "What this is",
    icon: "◈",
    hint: "The show, and the tool behind it",
    body: `
**Market Bubble is the show** — a live trading broadcast. *This app is the crew's command center:* the internal tool the Market Bubble team uses to run that show. It pulls the live chat across every channel, the markets and the portfolio, the show prep, the analytics, and an AI co-pilot into one surface — so a producer or mod can run the broadcast without juggling ten tabs.

# How it's built
Three packages, one repo:

- **\`@app/server\`** — the brain. Ingests chat from each platform, runs the analytics fold, records sessions, serves the API and the realtime WebSocket, and hosts the AI assistant. Port **8787**.
- **\`@app/web\`** — this app. The React control surface (port **5173** in dev) that talks to the server over HTTP + a WebSocket.
- **\`@app/shared\`** — the shared TypeScript types both sides agree on.

# The mental model
Everything flows through one **pipeline**: a message arrives from a channel → it's normalised, scored for sentiment, and enriched → then it fans out three ways: broadcast to every connected screen over the WebSocket, folded into the live stats, and (when a session is recording) written to the database. Every screen in the app is just a *view* onto that one stream of truth.

# Getting around
- **Live · Rooms** — the present-tense surfaces the crew watches during a broadcast.
- **Studio** — pre-show prep: planning and the run-of-show checklist.
- **Markets · Portfolio · Trends** — the trading edge that feeds the show.
- **Analytics** — how the show went, and how to make the next one better.
- **Assistant** — the AI co-pilot, grounded in the show's live data.
- **Settings** — connections, preferences, this handbook, and (for admins) accounts.

Deeper engineering references live in the repo: \`docs/ARCHITECTURE.md\` (system diagrams) and \`docs/ANALYTICS-REDESIGN.md\` (the data model).
`,
  },
  {
    id: "roles",
    group: "Start here",
    title: "Roles & access",
    icon: "⚿",
    hint: "Who on the crew can do what",
    body: `
Every account on the team has one of three roles. Most of what's in this handbook is gated by role.

# user
The baseline. Can watch the live feed, use chat and Rooms, see Markets / Portfolio / Trends, and talk to the assistant — but **without the live-data tools** (it answers from general knowledge only).

# mod
Everything a user can do, **plus**:

- Post and moderate on connected channels (timeout / ban / unban / delete).
- The assistant's **live-data tools** — chat search, stream stats, sessions, transcripts, market history (see *The AI assistant*).
- Per-stream recording and transcription toggles.
- This **handbook**.

# admin
Everything a mod can do, **plus** the **Admin** panel in Settings — manage the team's accounts, change roles, and configure platform OAuth apps and AI provider keys.

# Changing a role
Admins only: **Settings → Admin → accounts**. Pick a teammate, set their role. It takes effect on their next request — no restart.

# Why the gating exists
The data tools and moderation reach real chat history, viewer data, and real platform powers. Keeping them to mods/admins means a casual or compromised account can't pull transcripts or ban viewers. Loosening it is a deliberate decision — ask an admin.
`,
  },
  {
    id: "live",
    group: "Running the show",
    title: "The live cockpit",
    icon: "◉",
    hint: "Feed, composer, sentiment",
    body: `
**Live** is the home surface during a broadcast — the merged chat feed across every connected channel, in real time.

# The feed
Each row is one message: avatar, author, platform badge, text, timestamp. Messages land over the WebSocket the instant the server ingests them. Opening the app gives you a short **backfill** of recent messages so the feed isn't empty, then live messages stream in on top.

- **Sentiment** — every message is scored once when it's ingested (positive / neutral / negative). That single score drives the ticker, the analytics fold, and the assistant — so all three always agree.
- **AI embeds** — forwarding an assistant reply into chat shows it as a formatted **embed card**, clearly marked as from the assistant, not plain text.

# The composer & "send to"
Type at the bottom to post. The **send-to** picker chooses the destination — an internal room, or out to a connected channel (if that account is linked; see *Connecting platforms*). Posting to a platform goes out as **you**, via your linked account.

# Inline actions
Hover a message for actions: reply, forward, locally mute the chatter, or — if you're a mod on that channel — moderate (see *Moderation*).

# The ticker strip
The bar under the top carries live prices and the rolling crowd sentiment, so the crew can feel the room and the market at a glance without leaving the feed.
`,
  },
  {
    id: "platforms",
    group: "Running the show",
    title: "Connecting platforms",
    icon: "⊕",
    hint: "Twitch & Kick",
    body: `
The app reads chat anonymously out of the box. **Connecting an account** unlocks posting and moderating *as that person* on the show's channels.

# Reading (always on)
The server ingests chat from the configured channels without anyone logging in — Twitch via its chat connection, Kick via its public chat stream. Those messages appear in the Live feed for the whole crew. No setup beyond naming the channels.

# Twitch — full account connect
**Settings → Connections → Twitch → Connect.** A standard OAuth flow: you approve on Twitch, the server stores your token, and you can then:

- **Post** to the channel from the composer.
- **Moderate** — timeout, ban, unban, delete — from inline actions (if you hold mod powers there).

Tokens live only on the server and refresh automatically; the browser only ever learns that the account is *linked*, never the token.

# Kick
Kick chat is **read-only today** — it streams into the feed, but posting/moderation as a Kick account is on the roadmap (account connect + moderation, mirroring Twitch). Kick live viewer counts come with that work.

# Admin setup (one-time, per platform)
Posting/moderation needs a registered OAuth app. An **admin** pastes the app's Client ID/Secret under **Settings → Connections** (the redirect URL must be registered with the platform). Once configured, any mod connects their own account. Status is visible at \`/api/connect/status\`.
`,
  },
  {
    id: "moderation",
    group: "Running the show",
    title: "Moderation",
    icon: "⊘",
    hint: "Timeout, ban, delete",
    body: `
Moderation acts on the **real platform**, using the mod's linked account — so it needs (1) a connected account and (2) mod powers on that channel.

# Actions
From a message's inline actions (mods only):

- **Timeout** — silence a chatter for a set duration.
- **Ban** — permanent removal.
- **Unban** — reverse a ban.
- **Delete** — remove a single message.

These hit the platform's moderation API and take effect on the platform itself, not just in this app.

# Local muting (anyone)
Separate from platform moderation, **mute** hides a chatter's messages *for you*, in this client only — it doesn't touch the platform and others still see them. Good for cutting noise without taking mod action.

# What's supported where
- **Twitch** — full set above.
- **Kick** — moderation lands with Kick account connect (roadmap). Read-only today.

If an action isn't available, the platform doesn't expose it, or you haven't connected an account with the right powers there.
`,
  },
  {
    id: "recording",
    group: "Running the show",
    title: "Recording & sessions",
    icon: "●",
    hint: "Auto-record on live",
    body: `
A **session** is a recorded window of a broadcast — its messages, sentiment over time, and (optionally) its transcript — saved so the crew can review it later in Analytics.

# It's automatic
There's **no record button to babysit**. The server watches which channels are actually live (it polls each platform) and:

- When a channel **goes live** → it auto-starts a session.
- When it **goes offline** → it closes the session after a short grace (about 3 minutes, so a brief drop doesn't split one show into two).

# Per-stream settings
Each channel has two independent toggles, on the **Analytics → Pulse** capture panel:

- **Record sessions** — the show's own channels default **on**; external channels you're only watching default **off** (opt-in).
- **Transcribe** — off by default everywhere; opt-in per channel (see *Live transcription*).

So you can record without transcribing, transcribe without recording, both, or neither — per channel.

# The "Live & capturing" panel
On **Analytics → Pulse**: every channel with a live / recording / offline dot, the Rec and STT toggles, and a manual ▶ / ■ override for the rare time you want to force a session to start or stop.

# Where it goes
Everything is written to the embedded database (see *Data & storage*) — messages with their stamped sentiment, the session's start/stop and who/what started it, and any captions linked to the session. Nothing is in-memory-only; a restart never loses a recorded session.
`,
  },
  {
    id: "transcription",
    group: "Running the show",
    title: "Live transcription",
    icon: "◴",
    hint: "Captions → transcript",
    body: `
Transcription turns a channel's audio into a running **transcript** — searchable, attached to the session, and available to the assistant.

# Turning it on
**Opt-in per channel, off by default.** Flip the **Transcribe** toggle (Analytics → Pulse capture panel). When that channel is live and recording, captions start flowing.

# How it behaves
- Captions arrive as short timed lines, each with a confidence score.
- They're persisted and **linked to the active session**, so a session's transcript is exactly the captions captured during its window.
- The **Transcript** view shows the live caption stream as it happens.
- Captions are kept out of the chat sentiment fold — they're transcript data, not crowd messages, so they never skew audience sentiment.

# Using it later
A recorded session's transcript shows in its **session report** (Analytics → Sessions). The assistant can pull it via \`get_transcript\` to answer "what did we say about the CPI print?"
`,
  },
  {
    id: "assistant",
    group: "Running the show",
    title: "The AI assistant",
    icon: "✺",
    hint: "Co-pilot grounded in show data",
    body: `
The **Assistant** is a chat co-pilot. For mods/admins it's *grounded* — it can call tools that read the show's real data, so answers reflect what's actually happening, not just general knowledge.

# Chats
- Opening the assistant starts a **new chat** by default.
- Keep multiple chats; each generates independently — switching away from one that's still answering won't show its typing indicator on another.
- **Forward** any reply into a room — it lands as a formatted **AI embed card**, full message (not truncated), clearly marked as from the assistant.

# Providers
- **Local (Ollama)** — the default; runs on the crew's own machine, no API key, nothing leaves the box.
- **Venice · OpenAI · Anthropic** — cloud providers; each needs an API key configured by an admin. Pick the provider per chat; status shows which are reachable.

# The live-data tools (mods/admins)
When grounded, it can call:

- **get_market_mood** — current crowd sentiment.
- **get_trends** — what's trending in chat.
- **get_stream_stats** — stats for a channel/range (optionally a specific one).
- **search_chat** — search chat history (indexed).
- **get_live_streams** — who's live right now.
- **get_portfolios** — portfolio positions.
- **get_sessions / get_session** — recorded shows / one session's detail.
- **get_transcript** — a session's transcript.
- **get_market_history** — historical prices.

Regular users get the assistant without these tools, plus a note that they're for mods/admins. The settings panel inside the assistant lists exactly which tools are on.
`,
  },
  {
    id: "analytics",
    group: "Running the show",
    title: "Analytics & reports",
    icon: "▦",
    hint: "Pulse, sessions, compare",
    body: `
**Analytics** answers two questions: *what's happening now* and *how did the show go.* It splits into **Now** and **Review**.

# Now
- **Pulse** — the live dashboard across all channels: sentiment, message rate, live viewers, top chatters, plus the capture/recording panel.
- **Reactions** — moment detection and coaching: spikes in chat reaction tied to what was happening on air.
- **Transcript** — the live speech-to-text stream as it happens (see *Live transcription*).

# Review
- **Sessions** — every recorded show. Open one for its **session report**: the arc of sentiment and activity, key moments, and the transcript if it was transcribed. Reports export.
- **Compare** — Market Bubble vs other streamers on normalized rates, with charts (a leaderboard bar with "us" marked) so differences read at a glance.

# How the numbers are computed
- Messages fold into **10-second buckets** as they arrive — a rolling live aggregate, not a query-on-demand scan.
- The sentiment in every chart is the score **stamped once at ingestion**, so live Pulse, recorded reports, and the assistant always report the same number.
- Snapshots are **cached briefly** (a couple of seconds) so the UI, exports, and AI read a consistent picture and the server isn't recomputing on every request.

# Access
Stats endpoints require a logged-in account; report generation is lightly rate-limited so exports can't hammer the server.
`,
  },
  {
    id: "markets",
    group: "The trading edge",
    title: "Markets, Portfolio & Trends",
    icon: "$",
    hint: "What feeds the show",
    body: `
The trading-edge surfaces answer "what's the market doing and where do we stand?" — the substance behind a trading broadcast.

- **Markets** — live prices for the instruments the show tracks; the ticker strip surfaces a subset everywhere.
- **Portfolio** — the show's positions. The assistant reads these via \`get_portfolios\` to reason about exposure on air.
- **Trends** — what's bubbling up in chat and the market right now: the topics and tickers gaining attention.

Used alongside the feed, these connect *what the crowd is reacting to* with *what the market is doing.*
`,
  },
  {
    id: "studio",
    group: "The trading edge",
    title: "Studio: planning & run-of-show",
    icon: "◷",
    hint: "Pre-show prep",
    body: `
**Studio** is where an episode is prepared before going live.

- **Planning** — lay out segments, talking points, what to cover.
- **Run of show** — a checklist the crew works through live, so nothing gets missed on air.

Keeping prep inside the same cockpit means the plan is one click from the live feed once the show starts.
`,
  },
  {
    id: "rooms",
    group: "The trading edge",
    title: "Rooms",
    icon: "#",
    hint: "The crew backchannel",
    body: `
**Rooms** are internal chat channels inside the app — for the team behind Market Bubble, separate from public platform chat.

Use them for the producer/mod backchannel, to forward AI replies for the crew to see (they arrive as embed cards), or to keep notes during a show. Messages here stay inside the app and never go out to Twitch/Kick.
`,
  },
  {
    id: "data",
    group: "Under the hood",
    title: "Data & storage",
    icon: "▤",
    hint: "What's stored, where",
    body: `
The app runs on a **real database from the first boot** — no in-memory mode, nothing lost on restart.

# The engine
By default it uses **PGlite** — an embedded Postgres that runs *inside the server process* and persists to disk at \`data/pgdata\`. No Docker, no separate database service, no daemon. It's real Postgres SQL underneath. Set a \`DATABASE_URL\` and the server uses that external Postgres instead — same code, same schema.

# What's stored
- **messages** — every ingested chat message: author, platform, timestamp, the stamped **sentiment** score, and any AI embed.
- **sessions** — each recorded show: start/stop, which channel, and whether it started automatically (on-live) or manually.
- **captions** — transcript lines, each linked by foreign key to the session it belongs to.

# Schema changes
The schema is managed by **versioned migrations** applied automatically on boot (tracked in a \`_migrations\` table), so upgrading the server brings the database forward with no manual steps. A one-time importer pulled any legacy \`sessions.json\` in the first time the new store ran.

# Retention
Today messages are kept **indefinitely**. A time-based prune is planned; its cutoff has to be at least as far back as the assistant should be able to search.
`,
  },
  {
    id: "architecture",
    group: "Under the hood",
    title: "Architecture",
    icon: "◫",
    hint: "How the pieces fit",
    body: `
A quick tour for anyone debugging or extending the system. Full diagrams: \`docs/ARCHITECTURE.md\`.

# The data path
1. **Connectors** ingest chat per platform (Twitch, Kick) and hand raw messages to the pipeline.
2. The **pipeline** normalises each message, scores sentiment once, and enriches it.
3. It fans out three ways: **broadcast** to all clients over the WebSocket, **fold** into the live stats aggregator, and **persist** to the database (when a session is recording).

# Realtime
The browser holds one **WebSocket**. The server sends \`welcome\` → \`backfill\` (recent history) → live \`message\` / \`status\` frames. A side-band ("SideBus") carries non-message signals like viewer counts and who's live.

# Live detection & recording
A **viewer poller** asks each platform who's actually streaming and how many are watching, on a timer. It publishes the live set, which the **session driver** uses to auto-start/stop sessions (the record-on-live behaviour).

# Analytics
The **stats aggregator** keeps a rolling fold in 10-second buckets and serves cached snapshots. The **session recorder** brackets recorded windows and writes them to the database. Both read the same stamped sentiment, so live and recorded numbers agree.

# Dev note
In development the server does **not** auto-reload — restart it manually (port 8787) after changing server code. The web app hot-reloads itself (port 5173). \`pnpm -r typecheck\` validates all three packages.
`,
  },
  {
    id: "admin",
    group: "Under the hood",
    title: "Admin & setup",
    icon: "★",
    hint: "Accounts, keys, config",
    body: `
Admin-only operations live under **Settings → Admin**.

# Accounts & roles
Manage who's on the team and at what level. Promote a trusted teammate to **mod** (posting, moderation, data tools) or **admin** (full control). See *Roles & access* for what each unlocks.

# Platform OAuth apps
To enable posting/moderation, register an OAuth app with the platform and paste its Client ID/Secret into **Settings → Connections**. The redirect URL you register must match the server's callback. Once set, mods connect their own accounts; the app credentials stay server-side.

# AI provider keys
The assistant runs on **local Ollama** with no key. To enable a cloud provider (Venice / OpenAI / Anthropic), add its API key (Settings / environment). The provider picker then offers it.

# Where config lives
Platform and integration settings persist under the server's \`data/\` directory; secrets stay on the server and never reach the browser. Database files live in \`data/pgdata\`.
`,
  },
  {
    id: "troubleshooting",
    group: "Under the hood",
    title: "Troubleshooting",
    icon: "?",
    hint: "Common gotchas",
    body: `
# "No tools available" in the assistant
The live-data tools are **mod/admin-only**. If you see a note that they're for moderators, you're signed in as a regular user — an admin can change your role. If you *are* a mod and still see nothing, hard-refresh; the tools list is fetched with your session.

# A channel isn't recording
Check three things: (1) is it actually **live**? The poller only records live channels. (2) Is **Record sessions** on for it? External channels default off. (3) Did it just go offline? Sessions close after a ~3-minute grace, so a recently-ended show may still read as recording briefly.

# No transcript for a session
**Transcribe** is off by default. It must be on for that channel *before/while* it's live — captions are captured going forward, never back-filled.

# Can't post or moderate
You need a **connected account** for that platform (Settings → Connections) and the right powers on the channel. Kick is read-only today. If Connect is disabled, an admin hasn't configured the platform's OAuth app yet.

# Server changes didn't take effect
In dev the server doesn't auto-reload — **restart it** (port 8787) after server-side changes. Web changes hot-reload automatically.

# Charts or stats look empty / stale
Snapshots cache for a couple of seconds and the fold is rolling — give it a moment after a fresh start. Stats endpoints also require being logged in.
`,
  },
];

const GROUPS = ["Start here", "Running the show", "The trading edge", "Under the hood"];

export function Handbook() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return TOPICS;
    return TOPICS.filter(
      (t) =>
        t.title.toLowerCase().includes(query) ||
        t.hint.toLowerCase().includes(query) ||
        t.body.toLowerCase().includes(query),
    );
  }, [query]);

  const open = openId ? TOPICS.find((t) => t.id === openId) ?? null : null;

  // ---- Reader ----
  if (open) {
    const idx = TOPICS.findIndex((t) => t.id === open.id);
    const prev = idx > 0 ? TOPICS[idx - 1]! : null;
    const next = idx < TOPICS.length - 1 ? TOPICS[idx + 1]! : null;
    return (
      <div className="hb hb-reader">
        <button className="hb-back" onClick={() => setOpenId(null)}>
          ← Handbook
        </button>
        <article className="hb-article">
          <header className="hb-arthead">
            <div className="hb-arthead-ico">{open.icon}</div>
            <div className="hb-arthead-txt">
              <div className="hb-kicker">{open.group}</div>
              <h1>{open.title}</h1>
              <p className="hb-lead">{open.hint}</p>
            </div>
          </header>
          <div className="hb-body" dangerouslySetInnerHTML={{ __html: mdToHtml(open.body) }} />
          <footer className="hb-pager">
            {prev ? (
              <button className="hb-pglink" onClick={() => setOpenId(prev.id)}>
                <span className="hb-pgdir">← Previous</span>
                <span className="hb-pgttl">{prev.title}</span>
              </button>
            ) : (
              <span />
            )}
            {next ? (
              <button className="hb-pglink next" onClick={() => setOpenId(next.id)}>
                <span className="hb-pgdir">Next →</span>
                <span className="hb-pgttl">{next.title}</span>
              </button>
            ) : (
              <span />
            )}
          </footer>
        </article>
      </div>
    );
  }

  // ---- Landing ----
  return (
    <div className="hb">
      <header className="hb-hero">
        <div className="hb-hero-mark">◍</div>
        <div className="hb-hero-txt">
          <div className="hb-hero-kicker">Market Bubble</div>
          <h1>Team Handbook</h1>
          <p>How the crew runs the show — moderation, recording, the data model, and everything in between.</p>
        </div>
      </header>

      <input
        className="hb-search"
        placeholder="Search the handbook…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />

      {GROUPS.map((group) => {
        const items = matches.filter((t) => t.group === group);
        if (items.length === 0) return null;
        return (
          <section className="hb-group" key={group}>
            <div className="hb-grouphead">{group}</div>
            <div className="hb-grid">
              {items.map((t) => (
                <button key={t.id} className="hb-card" onClick={() => setOpenId(t.id)}>
                  <span className="hb-card-ico">{t.icon}</span>
                  <span className="hb-card-txt">
                    <span className="hb-card-ttl">{t.title}</span>
                    <span className="hb-card-hint">{t.hint}</span>
                  </span>
                  <span className="hb-card-arrow">→</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {query && matches.length === 0 && (
        <div className="hb-empty">No topic matches “{q}”.</div>
      )}
    </div>
  );
}
