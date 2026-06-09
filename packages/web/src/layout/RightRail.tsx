import type { ChatMessage, MarketOdds, Platform } from "@app/shared";
import { Panel } from "./Panel";
import type { LayoutApi } from "../state/useLayout";
import type { SavedStore } from "../state/useSaved";
import { AuthorLink } from "../feed/AuthorLink";
import { MarketsRail } from "../finance/MarketsRail";
import { NewsPanel } from "../news/NewsPanel";
import { StatsMini } from "../analytics/StatsMini";
import { useToasts } from "../state/toasts";
import { useTrends } from "../lib/useTrends";
import { useNews } from "../lib/useNews";
import { useModLog } from "../lib/useModLog";
import { useAuth } from "../state/useAuth";
import type { ModLogEntry, NewsFeed } from "@app/shared";

function TrendsBody() {
  const trends = useTrends();
  if (trends.length === 0) return <div className="cc-empty-sm">Loading what the market’s talking about…</div>;
  // lead with the most talkable lanes in the rail
  const top = trends.filter((t) => /Trending Searches|Mastodon/.test(t.source)).slice(0, 8);
  const list = top.length ? top : trends.slice(0, 8);
  return (
    <div className="trend-list">
      {list.map((t, i) => (
        <a className="trend-item" key={`${t.source}-${i}`} href={t.url} target="_blank" rel="noopener noreferrer">
          {t.icon && <img className="trend-ico" src={t.icon} alt="" loading="lazy" />}
          <div className="trend-main">
            <div className="trend-row1">
              <span className="trend-title">{t.title}</span>
              {t.traffic && <span className={`trend-traffic ${t.tone ?? ""}`}>{t.traffic}</span>}
            </div>
            <div className="trend-src">
              {t.source.split(" · ")[0]}
              {t.snippet ? ` · ${t.snippet}` : ""}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

/** Markets + crypto headlines (Finviz, via /api/news) — crypto-led, refreshed every 30s. */
function RailNewsBody({ feed }: { feed: NewsFeed & { loading: boolean } }) {
  if (feed.loading && !feed.articles.length) return <div className="cc-empty-sm">Loading the tape…</div>;
  if (!feed.articles.length) return <div className="cc-empty-sm">No headlines right now.</div>;
  const crypto = feed.articles.filter((a) => a.lane === "crypto").slice(0, 7);
  const markets = feed.articles.filter((a) => a.lane === "markets").slice(0, 5);
  const list = [...crypto, ...markets];
  return (
    <div className="news-list">
      {list.map((a, i) => (
        <a className="news-item" key={a.url + i} href={a.url} target="_blank" rel="noopener noreferrer">
          <div className="news-meta">
            <span className="news-handle">{a.source}</span>
            {a.tickers?.[0] && <span className="news-cat">{a.tickers[0]}</span>}
            {a.time && <span className="news-ago">{a.time}</span>}
          </div>
          <div className="news-text">{a.title}</div>
        </a>
      ))}
    </div>
  );
}

const PILL: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };

const ago = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

function NotifBody() {
  const { log, clearLog, dismissLog } = useToasts();
  if (log.length === 0) {
    return <div className="cc-empty-sm">Highlight &amp; price alerts collect here. Enable them in Settings → Notifications.</div>;
  }
  return (
    <>
      <button className="clear" onClick={clearLog}>
        Clear all
      </button>
      {log.map((n) => (
        <div key={n.id} className={`notif-item notif-${n.kind ?? "info"} ${n.onClick ? "clickable" : ""}`}>
          <button className="notif-main" onClick={() => n.onClick?.()} disabled={!n.onClick}>
            <div className="notif-head">
              <span className="notif-title">{n.title}</span>
              <span className="notif-ago">{ago(n.at)}</span>
            </div>
            {n.body && <div className="notif-text">{n.body}</div>}
          </button>
          <button className="notif-x" onClick={() => dismissLog(n.id)} title="Dismiss" aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </>
  );
}

function SavedBody({ store }: { store: SavedStore }) {
  if (store.items.length === 0) {
    return <div className="cc-empty-sm">Star (☆) or note (✎) a message to keep it here.</div>;
  }
  return (
    <>
      <button className="clear" onClick={store.clear}>
        Clear all
      </button>
      {store.items
        .slice()
        .reverse()
        .map((it) => (
          <div className="saved-item" key={it.message.id}>
            <div className="saved-meta">
              <span className={`pill ${it.message.platform}`}>{PILL[it.message.platform]}</span>
              <AuthorLink m={it.message} className="saved-author" />
              <span className="saved-ch">{it.message.channelLabel}</span>
              <button className="saved-x" onClick={() => store.remove(it.message.id)} title="Remove">
                ✕
              </button>
            </div>
            <div className="saved-text">{it.message.text}</div>
            <textarea
              className="note-input"
              value={it.note}
              placeholder="add a note…"
              spellCheck={false}
              onChange={(e) => store.updateNote(it.message.id, e.target.value)}
            />
          </div>
        ))}
    </>
  );
}

const fmtDur = (s: number) =>
  s >= 86400 ? `${Math.round(s / 86400)}d` : s >= 3600 ? `${Math.round(s / 3600)}h` : s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`;

function actLabel(e: ModLogEntry): string {
  switch (e.action) {
    case "timeout":
      return `timeout${e.durationSecs ? ` ${fmtDur(e.durationSecs)}` : ""}`;
    case "mode":
      return `${e.mode ?? "mode"} ${e.enabled ? "on" : "off"}`;
    case "clear":
      return "clear chat";
    default:
      return e.action; // ban | unban | delete
  }
}

function ModLogBody({ entries }: { entries: ModLogEntry[] }) {
  if (entries.length === 0) {
    return <div className="cc-empty-sm">No moderation actions yet. Timeouts, bans, unbans and mode changes are logged here.</div>;
  }
  return (
    <div className="ml-list">
      {entries.map((e) => (
        <div className={`ml-item ${e.ok ? "" : "ml-fail"}`} key={e.id}>
          <div className="ml-row1">
            <span className="ml-actor">{e.actorName}</span>
            <span className={`ml-act ml-act-${e.action}`}>{actLabel(e)}</span>
            {e.target && <span className="ml-target">{e.target}</span>}
            <span className="ml-ago">{ago(e.at)}</span>
          </div>
          {(e.channelLabel || e.reason || !e.ok) && (
            <div className="ml-row2">
              {e.channelLabel}
              {e.reason ? ` · “${e.reason}”` : ""}
              {!e.ok ? " · failed" : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function RightRail({
  store,
  layout,
  markets,
  posts,
  messages,
}: {
  store: SavedStore;
  layout: LayoutApi;
  markets: MarketOdds[];
  posts: ChatMessage[];
  messages: ChatMessage[];
}) {
  const { log } = useToasts();
  const news = useNews();
  const { user } = useAuth();
  const isMod = user?.role === "mod" || user?.role === "admin";
  const modlog = useModLog();
  return (
    <aside className="cc-rail">
      <Panel
        title="Notifications"
        badge={log.length || ""}
        collapsed={layout.isPanelCollapsed("notifications")}
        onToggle={() => layout.togglePanel("notifications")}
      >
        <NotifBody />
      </Panel>
      <Panel
        title="Polymarket"
        badge={markets.length || ""}
        collapsed={layout.isPanelCollapsed("markets")}
        onToggle={() => layout.togglePanel("markets")}
      >
        <MarketsRail markets={markets} />
      </Panel>
      <Panel
        title="X Feed"
        badge={posts.length || ""}
        collapsed={layout.isPanelCollapsed("xfeed")}
        onToggle={() => layout.togglePanel("xfeed")}
        grow
      >
        <NewsPanel posts={posts} />
      </Panel>
      <Panel
        title="News"
        badge={news.articles.length || ""}
        collapsed={layout.isPanelCollapsed("news")}
        onToggle={() => layout.togglePanel("news")}
        grow
      >
        <RailNewsBody feed={news} />
      </Panel>
      <Panel
        title="Trends"
        collapsed={layout.isPanelCollapsed("trends")}
        onToggle={() => layout.togglePanel("trends")}
      >
        <TrendsBody />
      </Panel>
      <Panel title="Stats" collapsed={layout.isPanelCollapsed("stats")} onToggle={() => layout.togglePanel("stats")}>
        <StatsMini messages={messages} />
      </Panel>
      <Panel
        title="Saved"
        badge={store.items.length || ""}
        collapsed={layout.isPanelCollapsed("saved")}
        onToggle={() => layout.togglePanel("saved")}
      >
        <SavedBody store={store} />
      </Panel>
      {isMod && (
        <Panel
          title="Mod log"
          badge={modlog.length || ""}
          collapsed={layout.isPanelCollapsed("modlog")}
          onToggle={() => layout.togglePanel("modlog")}
        >
          <ModLogBody entries={modlog} />
        </Panel>
      )}
    </aside>
  );
}
