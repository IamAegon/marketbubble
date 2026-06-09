import { useLocation } from "react-router-dom";
import { useDashboard } from "../state/DashboardProvider";
import { SourceFilters } from "../feed/SourceFilters";
import { SearchBox } from "../feed/SearchBox";
import { streamSources } from "../video/playerUrls";

const titleFor = (p: string): string =>
  p.startsWith("/app/rooms")
    ? "Rooms"
    : p.startsWith("/app/markets")
      ? "Markets"
      : p.startsWith("/app/portfolio")
      ? "Portfolio"
      : p.startsWith("/app/studio")
      ? "Studio"
      : p.startsWith("/app/analytics/transcript")
      ? "Live Transcript"
      : p.startsWith("/app/trends")
        ? "Trends"
        : p.startsWith("/app/assistant")
          ? "Assistant"
          : p.startsWith("/app/analytics")
            ? "Analytics"
            : p.startsWith("/app/settings")
              ? "Settings"
              : "Live";

export function TopBar() {
  const d = useDashboard();
  const { pathname } = useLocation();
  const isLive = pathname === "/app";
  const title = titleFor(pathname);
  // stream sources carry a real `live` flag (Twitch/Kick from the live API, X from
  // connection) — derive both the total and the live count from them so the headline
  // reflects who's actually streaming, not just who has a chat socket open.
  const streams = streamSources(d.connectors, location.hostname, d.liveStreams);
  const allStreams = streams.length;
  const rooms = d.connectors.filter((c) => c.platform === "mb").length;
  const newsFeeds = Math.max(0, d.connectors.length - allStreams - rooms);
  const streamsLive = streams.filter((s) => s.live).length;
  // total live viewers across all currently-live streams (Twitch/Kick from their APIs)
  const liveViewers = streams.reduce((a, s) => a + (s.live ? d.viewers[s.id] ?? 0 : 0), 0);
  const fmtViews = (n: number): string =>
    n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  return (
    <header className="cc-top">
      <div className="cc-view-title">
        {isLive && <span className="live-pip" title="On air" />}
        {title}
      </div>

      {isLive && (
        <div className="cc-top-controls">
          <div className="view-toggle">
            <button className={d.view === "unified" ? "active" : ""} onClick={() => d.setView("unified")}>
              Unified
            </button>
            <button className={d.view === "columns" ? "active" : ""} onClick={() => d.setView("columns")}>
              Columns
            </button>
          </div>
          {d.view === "unified" && (
            <button
              className={`cc-chip ${d.layout.feedCentered ? "active" : ""}`}
              onClick={d.layout.toggleFeedCentered}
              title={d.layout.feedCentered ? "Chat is centered — switch to full width" : "Center the chat column"}
            >
              {d.layout.feedCentered ? "⊟ Centered" : "▭ Wide"}
            </button>
          )}
          <SourceFilters
            enabled={d.enabled}
            onToggle={d.togglePlatform}
            connectors={d.connectors}
            showNews={d.showNews}
            onToggleNews={d.toggleNews}
          />
          <span className="cc-sep" />
          <button
            className={`cc-chip ${!d.layout.videoCollapsed ? "active" : ""}`}
            onClick={d.layout.toggleVideo}
            title="Toggle the video dock"
          >
            ▶ Video
          </button>
          {!d.layout.videoCollapsed && (
            <div className="view-toggle vdock-mode">
              <button className={d.videoMode === "theater" ? "active" : ""} onClick={() => d.setVideoMode("theater")}>
                Theater
              </button>
              <button className={d.videoMode === "grid" ? "active" : ""} onClick={() => d.setVideoMode("grid")}>
                Grid
              </button>
            </div>
          )}
        </div>
      )}

      {!isLive && <div className="header-spacer" />}
      <div className="cc-top-right">
        <SearchBox />
        <div
          className="conn-count"
          title={
            d.connected
              ? `${streamsLive} of ${allStreams} streams live${liveViewers > 0 ? ` · ${liveViewers.toLocaleString()} viewers` : ""} · ${newsFeeds} X-news accounts · ${rooms} rooms`
              : "disconnected"
          }
        >
          {!d.connected && <span className="live-dot off" />}
          {!d.connected ? (
            <span className="cc-stat-off">connecting…</span>
          ) : liveViewers > 0 ? (
            <div className="cc-stat">
              <span className="cc-stat-l">{streamsLive} live · watching</span>
              <span className="cc-stat-n">{fmtViews(liveViewers)}</span>
            </div>
          ) : (
            <div className="cc-stat">
              <span className="cc-stat-l">streams live</span>
              <span className="cc-stat-n">
                {streamsLive}
                <span className="cc-stat-sub">/{allStreams}</span>
              </span>
            </div>
          )}
        </div>
        {isLive && (
          <button
            className={`cc-icon-btn ${d.layout.railHidden ? "" : "active"}`}
            onClick={d.layout.toggleRail}
            title="Toggle right rail"
          >
            ▦
          </button>
        )}
      </div>
    </header>
  );
}
