import { useEffect, useState } from "react";
import type { ConnectorInfo } from "@app/shared";
import { streamSources } from "./playerUrls";
import { Player } from "./Player";
import { useDashboard } from "../state/DashboardProvider";

const PLAT: Record<string, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };

/** compact viewer count: 1234 → "1.2K", 1_200_000 → "1.2M" */
const fmtViews = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

export function VideoDock({ connectors, mode }: { connectors: ConnectorInfo[]; mode: "theater" | "grid" }) {
  const host = location.hostname;
  const { liveStreams, viewers } = useDashboard();
  const sources = streamSources(connectors, host, liveStreams);
  const viewersOf = (id: string): number => viewers[id] ?? 0;
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("mb.vdock.collapsed") || "[]"));
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (p: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      try {
        localStorage.setItem("mb.vdock.collapsed", JSON.stringify([...n]));
      } catch {
        /* ignore */
      }
      return n;
    });

  const ids = sources.map((s) => s.id).join(",");
  useEffect(() => {
    if (sources.length && (!featuredId || !sources.some((s) => s.id === featuredId))) {
      const f = sources.find((s) => s.embedUrl) ?? sources[0];
      setFeaturedId(f?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (sources.length === 0) {
    return <div className="cc-video-ph">Add a Twitch or Kick stream in Settings to watch it here.</div>;
  }

  const featured = sources.find((s) => s.id === featuredId) ?? sources[0]!;

  // group the switcher by platform (Twitch / Kick / X stacked under headers)
  const PLAT_ORDER = ["twitch", "kick", "x", "mb"] as const;
  const groups = PLAT_ORDER.map((p) => ({ platform: p, items: sources.filter((s) => s.platform === p) })).filter(
    (g) => g.items.length > 0,
  );

  // grid: fit every player in view (no scroll) so none get throttled/paused offscreen
  const cols = Math.max(1, Math.ceil(Math.sqrt(sources.length)));
  const rows = Math.max(1, Math.ceil(sources.length / cols));

  return (
    <div className="vdock">
      {mode === "theater" ? (
        <div className="vdock-theater">
          <div className="vdock-main">
            <Player s={featured} key={featured.id} />
          </div>
          {sources.length > 1 && (
            <div className="vdock-strip">
              {groups.map((g) => {
                const isCollapsed = collapsed.has(g.platform);
                const liveN = g.items.filter((s) => s.live).length;
                const liveViews = g.items.reduce((a, s) => a + (s.live ? viewersOf(s.id) : 0), 0);
                return (
                  <div className={`vstrip-group ${isCollapsed ? "collapsed" : ""}`} key={g.platform}>
                    <button
                      className="vstrip-ghead"
                      onClick={() => toggleGroup(g.platform)}
                      title={isCollapsed ? `Show ${PLAT[g.platform]} streams` : `Hide ${PLAT[g.platform]} streams`}
                      aria-expanded={!isCollapsed}
                    >
                      <span className="vstrip-chev" aria-hidden>
                        ▾
                      </span>
                      <span className={`pill ${g.platform}`}>{PLAT[g.platform]}</span>
                      <span className="vstrip-gn">
                        {liveN > 0 && <span className="vstrip-dot live" />}
                        {liveN > 0 ? `${liveN}/${g.items.length}` : g.items.length}
                        {liveViews > 0 && <span className="vstrip-gviews">{fmtViews(liveViews)}</span>}
                      </span>
                    </button>
                    {!isCollapsed &&
                      g.items.map((s) => {
                        const v = viewersOf(s.id);
                        return (
                          <button
                            key={s.id}
                            className={`vstrip ${s.id === featured.id ? "active" : ""}`}
                            onClick={() => setFeaturedId(s.id)}
                            title={s.label}
                          >
                            <span className={`vstrip-dot ${s.live ? "live" : ""}`} />
                            <span className="vstrip-label">{s.label}</span>
                            {s.live && v > 0 && <span className="vstrip-views">{fmtViews(v)}</span>}
                          </button>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div
          className="vdock-grid"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
        >
          {sources.map((s) => (
            <div className="vgrid-cell" key={s.id}>
              <div className="vgrid-cap">
                <span className={`vstrip-dot ${s.live ? "live" : ""}`} />
                <span className={`pill ${s.platform}`}>{PLAT[s.platform]}</span>
                <span className="vstrip-label">{s.label}</span>
                {s.live && viewersOf(s.id) > 0 && <span className="vstrip-views">{fmtViews(viewersOf(s.id))}</span>}
              </div>
              <Player s={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
