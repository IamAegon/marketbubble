import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ConnectorInfo, Platform } from "@app/shared";
import { ColumnFeed } from "./ColumnFeed";
import { useDashboard } from "../state/DashboardProvider";

const PER_COLUMN = 600;
const PILL: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };

export function ColumnsView({
  connectors,
  messages,
  posts,
  enabled,
  showNews,
  focus,
}: {
  connectors: ConnectorInfo[];
  messages: ChatMessage[];
  posts: ChatMessage[];
  enabled: Set<Platform>;
  showNews: boolean;
  /** reveal+flash this column when it changes (set after you send to it) */
  focus?: { id: string; n: number } | null;
}) {
  const { layout } = useDashboard();
  const hidden = useMemo(() => new Set(layout.hiddenColumns), [layout.hiddenColumns]);
  const [manage, setManage] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);

  // scroll the just-sent-to column into view + flash it
  useEffect(() => {
    if (!focus) return;
    const safe = window.CSS && CSS.escape ? CSS.escape(focus.id) : focus.id.replace(/["\\]/g, "\\$&");
    const el = colsRef.current?.querySelector<HTMLElement>(`[data-col="${safe}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    el.classList.add("col-flash");
    const t = window.setTimeout(() => el.classList.remove("col-flash"), 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  // live CHAT sources (tracked-account news feeds are aggregated into one News column)
  const chatCols = connectors.filter((c) => enabled.has(c.platform) && !c.id.startsWith("xnews:"));
  // when News is on, prepend a single aggregated "News" column of tracked-account posts
  const newsCol = showNews
    ? ({ id: "xnews:all", platform: "x", label: "News", status: { kind: "connected" } } as ConnectorInfo)
    : null;
  const allCols = newsCol ? [newsCol, ...chatCols] : chatCols;
  // toggling News ON is an explicit "show it" — never let a stale hidden-columns entry
  // swallow the News column (otherwise it silently vanishes among hidden chat columns)
  const cols = allCols.filter((c) => c.id === "xnews:all" || !hidden.has(c.id));

  const byChannel = new Map<string, ChatMessage[]>();
  for (const c of cols) byChannel.set(c.id, []);
  for (const m of messages) {
    if (m.kind === "post") continue; // news posts go to the aggregated News column
    const arr = byChannel.get(m.channel);
    if (arr) arr.push(m);
  }
  if (newsCol && byChannel.has("xnews:all")) byChannel.set("xnews:all", posts);

  const close = (id: string) => {
    // the News column is force-shown above and gated by the News source filter (showNews),
    // NOT the hidden-columns list — so closing it must turn News off, or it stays pinned.
    if (id === "xnews:all") layout.toggleNews();
    else layout.toggleColumn(id); // hides a visible chat column (persisted)
  };
  const show = (id: string) => layout.toggleColumn(id); // restores a hidden one
  const restoreAll = () => layout.showAllColumns();

  const bar = (
    <div className="columns-bar">
      <button className="col-manage-btn" onClick={() => setManage((m) => !m)}>
        ⚙ Columns{hidden.size ? ` · ${hidden.size} hidden` : ""}
      </button>
      {manage && (
        <>
          <div className="col-manage-backdrop" onClick={() => setManage(false)} />
          <div className="col-manage">
            <div className="col-manage-head">
              <span>Manage columns</span>
              <button disabled={hidden.size === 0} onClick={restoreAll}>
                Restore all
              </button>
            </div>
            {allCols.length === 0 && <div className="cc-empty-sm">No chat sources enabled.</div>}
            {allCols.map((c) => {
              // News is force-shown (gated by the News filter, not hidden-columns), so always
              // treat it as visible — its button then turns News off via close().
              const isHidden = c.id !== "xnews:all" && hidden.has(c.id);
              return (
                <div className={`col-manage-row ${isHidden ? "off" : ""}`} key={c.id}>
                  <span className={`pill ${c.platform}`}>{PILL[c.platform]}</span>
                  <span className="col-manage-lbl">{c.label}</span>
                  <button onClick={() => (isHidden ? show(c.id) : close(c.id))}>{isHidden ? "Show" : "Hide"}</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  if (cols.length === 0) {
    return (
      <div className="feed">
        {bar}
        <div className="empty">
          No chat columns. Enable a source above{hidden.size ? " or restore a hidden column (⚙ Columns)." : "."}
        </div>
      </div>
    );
  }

  return (
    <div className="columns-wrap">
      {bar}
      <div className="columns" ref={colsRef}>
        {cols.map((c) => {
          const all = byChannel.get(c.id) ?? [];
          const recent = all.length > PER_COLUMN ? all.slice(all.length - PER_COLUMN) : all;
          return <ColumnFeed key={c.id} connector={c} messages={recent} onClose={close} />;
        })}
      </div>
    </div>
  );
}
