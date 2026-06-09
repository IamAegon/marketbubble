import { useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "@app/shared";
import { useDashboard } from "../state/DashboardProvider";
import { useToasts } from "../state/toasts";
import { getTracked, type TrackedAccountInfo } from "../lib/tracked";
import { createList, deleteList, getLists, updateList, type XList } from "../lib/xlists";
import { useAskAI, tweetAskPrompt } from "../lib/askAI";
import { UserLink } from "../components/UserLink";

const ago = (ts: number): string => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/** Account avatar: the post's own image if present, else resolved from the handle via
 * unavatar.io; falls back to a colored initial if the image fails to load. */
function Avatar({ handle, name, color, avatarUrl }: { handle: string; name: string; color?: string; avatarUrl?: string }) {
  const [failed, setFailed] = useState(false);
  const src = avatarUrl || (handle ? `https://unavatar.io/twitter/${encodeURIComponent(handle)}` : "");
  if (!src || failed) {
    const hue = [...(handle || name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    return (
      <span className="xf-av-ph" style={{ background: color || `hsl(${hue} 45% 42%)` }}>
        {name.replace(/^@/, "").charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

/** X Feed — a Twitter-style timeline of the tracked accounts' posts, filterable by
 * category or a user-defined list. The standalone home for tracked-account intel. */
export function XFeedView() {
  const d = useDashboard();
  const { push } = useToasts();
  const askAI = useAskAI();
  const [accounts, setAccounts] = useState<TrackedAccountInfo[]>([]);
  const [lists, setLists] = useState<XList[]>(getLists);
  const [view, setView] = useState<string>("all"); // "all" | "cat:<name>" | "list:<id>"
  const [editing, setEditing] = useState<XList | "new" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftHandles, setDraftHandles] = useState<Set<string>>(new Set());
  const [fwd, setFwd] = useState<ChatMessage | null>(null); // tweet being forwarded to a chat

  const doForward = (roomId: string) => {
    if (!fwd) return;
    const handle = fwd.author.username;
    const name = fwd.author.displayName || handle;
    d.post(roomId, `@${handle}: ${fwd.text}`, undefined, {
      kind: "x",
      title: name.toLowerCase() === handle.toLowerCase() ? `@${handle}` : `${name} · @${handle}`,
      markdown: fwd.text,
      ...(fwd.link ? { link: fwd.link } : {}),
    });
    const room = d.rooms.find((r) => r.id === roomId);
    setFwd(null);
    push({ title: "Forwarded", body: `Tweet sent to ${room?.label ?? "chat"}.`, kind: "room" });
  };

  useEffect(() => {
    getTracked().then(setAccounts).catch(() => {});
  }, []);

  const categories = useMemo(
    () => [...new Set(accounts.map((a) => a.category).filter(Boolean))].sort(),
    [accounts],
  );

  const posts = useMemo(() => d.messages.filter((m) => m.kind === "post"), [d.messages]);

  const matches = useMemo<(m: ChatMessage) => boolean>(() => {
    if (view.startsWith("cat:")) {
      const cat = view.slice(4);
      return (m) => (m.category ?? "") === cat;
    }
    if (view.startsWith("list:")) {
      const list = lists.find((l) => l.id === view.slice(5));
      const set = new Set(list?.handles ?? []);
      return (m) => set.has((m.author.username ?? "").toLowerCase());
    }
    return () => true;
  }, [view, lists]);

  const timeline = useMemo(
    () => posts.filter(matches).sort((a, b) => b.timestamp - a.timestamp).slice(0, 200),
    [posts, matches],
  );

  const viewTitle =
    view === "all"
      ? "All accounts"
      : view.startsWith("cat:")
        ? view.slice(4)
        : lists.find((l) => l.id === view.slice(5))?.name ?? "List";

  const openEditor = (l: XList | "new") => {
    setEditing(l);
    setDraftName(l === "new" ? "" : l.name);
    setDraftHandles(new Set(l === "new" ? [] : l.handles));
  };
  const toggleHandle = (h: string) =>
    setDraftHandles((prev) => {
      const next = new Set(prev);
      next.has(h) ? next.delete(h) : next.add(h);
      return next;
    });
  const saveDraft = () => {
    const handles = [...draftHandles];
    const next = editing === "new" ? createList(draftName, handles) : updateList((editing as XList).id, { name: draftName, handles });
    setLists(next);
    setEditing(null);
    // select the saved list
    const saved = editing === "new" ? next[next.length - 1] : next.find((l) => l.id === (editing as XList).id);
    if (saved) setView(`list:${saved.id}`);
  };
  const removeList = (id: string) => {
    setLists(deleteList(id));
    if (view === `list:${id}`) setView("all");
    if (editing !== "new" && editing?.id === id) setEditing(null);
  };

  const NavItem = ({ id, label, count, onEdit, onDelete }: { id: string; label: string; count?: number; onEdit?: () => void; onDelete?: () => void }) => (
    <div className={`xf-navitem ${view === id ? "active" : ""}`}>
      <button className="xf-navitem-main" onClick={() => setView(id)} title={label}>
        <span className="asub-lbl">{label}</span>
        {count != null && <span className="xf-navitem-n">{count}</span>}
      </button>
      {onEdit && (
        <button className="xf-navitem-x" onClick={onEdit} title="Edit list">
          ✎
        </button>
      )}
      {onDelete && (
        <button className="xf-navitem-x" onClick={onDelete} title="Delete list">
          ✕
        </button>
      )}
    </div>
  );

  return (
    <div className="asection xfeed">
      <nav className="asub">
        <div className="asub-title">X Feed</div>
        <div className="asub-group">
          <NavItem id="all" label="All accounts" count={accounts.length} />
        </div>
        {categories.length > 0 && (
          <div className="asub-group">
            <div className="asub-grouphead">Categories</div>
            {categories.map((c) => (
              <NavItem key={c} id={`cat:${c}`} label={c} count={accounts.filter((a) => a.category === c).length} />
            ))}
          </div>
        )}
        <div className="asub-group">
          <div className="asub-grouphead">My lists</div>
          {lists.map((l) => (
            <NavItem
              key={l.id}
              id={`list:${l.id}`}
              label={l.name}
              count={l.handles.length}
              onEdit={() => openEditor(l)}
              onDelete={() => removeList(l.id)}
            />
          ))}
          <button className="xf-newlist" onClick={() => openEditor("new")}>
            + New list
          </button>
        </div>
      </nav>

      <div className="asection-body">
        {editing ? (
          <div className="xf-editor">
            <div className="xf-editor-h">{editing === "new" ? "New list" : "Edit list"}</div>
            <input
              className="pf-in"
              placeholder="List name (e.g. Macro desk)"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              autoFocus
            />
            <div className="xf-editor-sub">Pick the accounts in this list</div>
            <div className="xf-pick">
              {accounts.length === 0 && <div className="cc-empty-sm">No tracked accounts yet — add some in Settings → Tracked X.</div>}
              {accounts.map((a) => {
                const h = a.handle.toLowerCase();
                const on = draftHandles.has(h);
                return (
                  <button key={a.id} className={`xf-pick-item ${on ? "on" : ""}`} onClick={() => toggleHandle(h)}>
                    <span className={`xf-check ${on ? "on" : ""}`}>{on ? "✓" : ""}</span>
                    <span className="xf-pick-handle">@{a.handle}</span>
                    {a.category && <span className="xf-cat">{a.category}</span>}
                  </button>
                );
              })}
            </div>
            <div className="xf-editor-acts">
              <button className="cc-chip active" onClick={saveDraft} disabled={!draftName.trim() || draftHandles.size === 0}>
                {editing === "new" ? "Create list" : "Save"}
              </button>
              <button className="cc-chip" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="xf-timeline">
            <div className="xf-top">
              <h2>{viewTitle}</h2>
              <span className="cc-empty-sm">{timeline.length} recent post{timeline.length !== 1 ? "s" : ""}</span>
            </div>
            {timeline.length === 0 ? (
              <div className="cc-empty-sm" style={{ padding: 18 }}>
                No posts yet for this view. Tracked X accounts poll ~every minute — add or manage them in Settings → Tracked X.
              </div>
            ) : (
              <div className="xf-posts">
                {timeline.map((p) => {
                  const name = p.author.displayName || p.author.username;
                  const handle = p.author.username;
                  const showHandle = !!handle && handle.toLowerCase() !== name.toLowerCase();
                  return (
                    <article className="xf-tweet" key={p.id}>
                      <UserLink platform="x" username={handle} kind="streamer" className="xf-av">
                        <Avatar handle={handle} name={name} color={p.author.color} avatarUrl={p.author.avatarUrl} />
                      </UserLink>
                      <div className="xf-body">
                        <div className="xf-line">
                          <UserLink platform="x" username={handle} kind="streamer" className="xf-name">
                            {name}
                          </UserLink>
                          {showHandle && <span className="xf-handle2">@{handle}</span>}
                          <span className="xf-dot">·</span>
                          <a className="xf-time" href={p.link} target="_blank" rel="noopener noreferrer">
                            {ago(p.timestamp)}
                          </a>
                          <span className="xf-line-right">
                            {p.category && <span className="xf-cat">{p.category}</span>}
                            <button className="xf-fwd" title="Ask the AI about this tweet" onClick={() => askAI(tweetAskPrompt(p))}>
                              ✦
                            </button>
                            <button className="xf-fwd" title="Forward to a Market Bubble chat" onClick={() => setFwd(p)}>
                              ➦
                            </button>
                          </span>
                        </div>
                        <a className="xf-text" href={p.link} target="_blank" rel="noopener noreferrer">
                          {p.text}
                        </a>
                        {p.media && p.media.length > 0 && (
                          <div className={`xf-media count-${Math.min(p.media.length, 4)}`}>
                            {p.media.slice(0, 4).map((src, i) => (
                              <a key={i} className="xf-media-cell" href={p.link} target="_blank" rel="noopener noreferrer">
                                <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {fwd && (
        <div className="fwd-overlay" onClick={() => setFwd(null)}>
          <div className="fwd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fwd-head">Forward tweet to a chat</div>
            <div className="fwd-quote">
              <div className="fwd-quote-text">
                @{fwd.author.username}: {fwd.text.slice(0, 220)}
              </div>
            </div>
            <div className="fwd-rooms">
              {d.rooms.map((r) => (
                <button key={r.id} onClick={() => doForward(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
            <button className="fwd-cancel" onClick={() => setFwd(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
