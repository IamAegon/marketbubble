import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Episode, EpisodeStatus, GuestPost, ShowGuest, SessionSummary } from "@app/shared";
import { useDashboard } from "../state/DashboardProvider";
import { useToasts } from "../state/toasts";
import { askAssistant } from "../lib/assistant";
import { mdToHtml } from "../lib/markdown";
import { createEpisode, deleteEpisode, fetchEpisodes, fetchGuestPosts, updateEpisode } from "../lib/show";
import { useMarketHistory } from "../lib/marketHistory";
import { useTrends } from "../lib/useTrends";
import { fetchSessions } from "../lib/sessions";
import { fetchPerformance } from "../lib/portfolio";

const fp = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

const STATUS: { id: EpisodeStatus; label: string }[] = [
  { id: "planned", label: "Planned" },
  { id: "live", label: "Live" },
  { id: "done", label: "Done" },
];
const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (s: string) => new Date(s).getTime();
const dateLabel = (ms: number) =>
  new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const postAgo = (t: number) => {
  const h = Math.round((Date.now() - t) / 3_600_000);
  return h < 1 ? "just now" : h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
};
/** human countdown/recency for the detail meta strip */
const untilLabel = (ms: number, status: EpisodeStatus): string => {
  if (status === "live") return "● Live now";
  if (status === "done") return "Aired";
  const diff = ms - Date.now();
  if (diff <= 0) return "Starting soon";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
};

/** Inline expandable guest intel — recent X posts for a handle. */
function GuestIntel({ g }: { g: ShowGuest }) {
  const [open, setOpen] = useState(false);
  const [posts, setPosts] = useState<GuestPost[] | null>(null);
  const load = () => {
    if (!g.handle) return;
    setOpen((v) => !v);
    if (posts === null) fetchGuestPosts(g.handle).then(setPosts);
  };
  return (
    <div className={`sp-guest ${open ? "open" : ""}`}>
      <button className="sp-guest-head" onClick={load} disabled={!g.handle}>
        <span className="sp-guest-name">{g.name}</span>
        {g.handle && <span className="sp-guest-h">@{g.handle}</span>}
        {g.note && <span className="sp-guest-note">{g.note}</span>}
        {g.handle && <span className="sp-guest-caret">{open ? "▾ intel" : "▸ intel"}</span>}
      </button>
      {open && (
        <div className="sp-intel">
          {posts === null && <div className="cc-empty-sm">Pulling recent posts…</div>}
          {posts !== null && posts.length === 0 && <div className="cc-empty-sm">No recent posts found (Nitter may be rate-limited).</div>}
          {(posts ?? []).map((p, i) => (
            <a key={i} className="sp-post" href={p.link} target="_blank" rel="noopener noreferrer">
              <span className="sp-post-when">{postAgo(p.at)}</span>
              <span className="sp-post-text">{p.text}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface BriefCtx {
  tone: string;
  line: string;
  btc: number | null;
  movers: { s: string; p: number }[];
  topTags: string[];
  lastShow: SessionSummary | null;
  leader: { name: string; finalReturnPct: number } | null;
}

/** AI go-live dossier — grounds the host in the live tape, the audience, the last
 * show, portfolio standings, and each guest's recent posts, then turns it into
 * talking points + a cold open + a run order for THIS episode. */
function BriefModal({ ep, onClose }: { ep: Episode; onClose: () => void }) {
  const d = useDashboard();
  const { push } = useToasts();
  const hist = useMarketHistory();
  const trends = useTrends();
  const isMod = d.user?.role === "mod" || d.user?.role === "admin";
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mock, setMock] = useState(false);
  const [ctx, setCtx] = useState<BriefCtx | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      // ----- the tape: today's movers + risk tone -----
      const pct = (open?: number, price?: number) => (open && price ? ((price - open) / open) * 100 : null);
      const day = (sym: string) => pct(hist[sym]?.dailyOpen, d.prices[sym]?.price);
      const movers = Object.keys(d.prices)
        .map((s) => ({ s, p: day(s) }))
        .filter((x): x is { s: string; p: number } => x.p != null)
        .sort((a, b) => Math.abs(b.p) - Math.abs(a.p))
        .slice(0, 5);
      const btc = day("BTC");
      const spx = day("SPX");
      const vix = day("VIX");
      let tone = "mixed";
      let line = "Markets chopping sideways — no clear tone.";
      if ((vix != null && vix > 4) || (btc != null && btc < -2.5)) {
        tone = "risk-off";
        line = "Risk-off — money stepping back, fear getting bid.";
      } else if ((btc != null && btc > 2.5 && (spx == null || spx > -0.3)) || (vix != null && vix < -6)) {
        tone = "risk-on";
        line = "Risk-on — appetite is back and the bid is broad.";
      }

      // ----- audience: what chat's been on about (recent cashtags) -----
      const tagCount = new Map<string, number>();
      for (const m of d.messages.slice(-1500)) {
        if (m.kind === "post" || m.kind === "caption" || m.platform === "mb") continue;
        for (const c of m.cashtags ?? []) tagCount.set(c.symbol.toUpperCase(), (tagCount.get(c.symbol.toUpperCase()) ?? 0) + 1);
      }
      const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s]) => s);

      // ----- last show + portfolio standings (fetched) -----
      const [sessions, perf] = await Promise.all([fetchSessions().catch(() => []), fetchPerformance().catch(() => null)]);
      const lastShow = sessions.filter((s) => s.status === "ended").sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
      const standings = (perf?.series ?? []).slice().sort((a, b) => b.finalReturnPct - a.finalReturnPct);
      const leader = standings[0] ? { name: standings[0].name, finalReturnPct: standings[0].finalReturnPct } : null;

      // ----- guest intel: recent X posts -----
      const intel: string[] = [];
      for (const g of ep.guests.filter((x) => x.handle).slice(0, 3)) {
        const posts = await fetchGuestPosts(g.handle!);
        if (posts.length) intel.push(`${g.name} (@${g.handle}) recent posts:\n` + posts.slice(0, 4).map((p) => `  - ${p.text}`).join("\n"));
      }

      if (!dead) setCtx({ tone, line, btc, movers: movers.slice(0, 4), topTags, lastShow, leader });

      const prompt = [
        "You are the producer prepping the host for a LIVE trading/markets show. Write a tight, specific go-live dossier using the live data below — cite real numbers, no fluff.",
        "",
        `SHOW: ${ep.title}`,
        `WHEN: ${dateLabel(ep.scheduledAt)} (${untilLabel(ep.scheduledAt, ep.status)})`,
        `GUESTS: ${ep.guests.map((g) => g.name + (g.handle ? ` (@${g.handle})` : "")).join(", ") || "none"}`,
        `PLANNED TOPICS: ${ep.topics.join("; ") || "none yet"}`,
        ep.notes ? `NOTES: ${ep.notes}` : "",
        "",
        "LIVE MARKET DATA (right now):",
        `- Tone: ${tone} — ${line}`,
        `- BTC ${fp(btc)} · S&P ${fp(spx)} · VIX ${fp(vix)} (vs day's open)`,
        movers.length ? `- Biggest movers: ${movers.map((m) => `${m.s} ${fp(m.p)}`).join(", ")}` : "",
        trends.length ? `TRENDING NOW: ${trends.slice(0, 6).map((t) => t.title).join(" · ")}` : "",
        topTags.length ? `AUDIENCE (recent chat cashtags): ${topTags.map((t) => "$" + t).join(", ")}` : "",
        lastShow
          ? `LAST SHOW (${lastShow.streamerName}): ${Math.round(lastShow.avgPerMin)} msg/min, net sentiment ${lastShow.net >= 0 ? "+" : ""}${Math.round(lastShow.net * 100)}, top cashtags ${(lastShow.topCashtags ?? []).slice(0, 4).map((c) => "$" + c.symbol).join(", ") || "—"}`
          : "",
        standings.length ? `PORTFOLIO STANDINGS: ${standings.slice(0, 4).map((s) => `${s.name} ${fp(s.finalReturnPct)}`).join(", ")}` : "",
        intel.length ? "\nGUEST INTEL:\n" + intel.join("\n\n") : "",
        "",
        "Write markdown with ## headers, in THIS order:",
        "## The tape — 2 lines on where markets are right now, using the numbers above.",
        "## Talking points — 4-5 specific things to cover; each a one-liner with a 'why now' hook tied to a mover, trend, or what chat's discussing.",
        "## Cold open — one punchy opening line for the host to actually say.",
        ep.guests.length ? "## Guest hooks — per guest: a sharp question + react to something they recently posted (use the intel)." : "",
        "## Segment order — a tight run order from the planned topics (suggest 3-4 from the data if none are planned).",
        "## Audience — what the community wants addressed, from the recent chat + last show.",
        "## Watch-outs — anything to handle carefully or avoid.",
      ]
        .filter(Boolean)
        .join("\n");
      try {
        const { reply, mock } = await askAssistant([{ role: "user", content: prompt }]);
        if (!dead) {
          setBrief(reply);
          setMock(mock);
        }
      } catch {
        if (!dead) setBrief("Couldn’t generate the dossier — try again.");
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, [ep.id]);

  return createPortal(
    <div className="ctx-overlay" onClick={onClose}>
      <div className="ctx-modal sp-brief-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ctx-head">
          <div className="ctx-title">
            <span className="ctx-ch">✦ Go-live dossier</span>
            <span className="ctx-at">{ep.title}{mock ? " · demo" : ""}</span>
          </div>
          <div className="ctx-acts">
            {brief && (
              <>
                <button className="cc-chip" onClick={() => navigator.clipboard?.writeText(brief)}>
                  Copy
                </button>
                {isMod && (
                  <button
                    className="cc-chip active"
                    onClick={() => {
                      d.post("mb:mod", `🎬 **Go-live dossier — ${ep.title}**\n\n${brief}`);
                      push({ title: "Shared to #mod", body: "Go-live dossier posted.", kind: "room" });
                    }}
                  >
                    Share to #mod
                  </button>
                )}
              </>
            )}
            <button className="cc-icon-btn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>
        <div className="ctx-body">
          {ctx && (
            <div className="sp-brief-strip">
              <span className={`sp-tone tone-${ctx.tone}`}>{ctx.tone}</span>
              {ctx.btc != null && (
                <span className="sp-strip-chip">
                  BTC <b className={ctx.btc >= 0 ? "up" : "down"}>{fp(ctx.btc)}</b>
                </span>
              )}
              {ctx.movers.map((m) => (
                <span key={m.s} className="sp-strip-chip">
                  {m.s} <b className={m.p >= 0 ? "up" : "down"}>{fp(m.p)}</b>
                </span>
              ))}
              {ctx.lastShow && <span className="sp-strip-chip">last show {Math.round(ctx.lastShow.avgPerMin)}/min</span>}
              {ctx.leader && (
                <span className="sp-strip-chip">
                  {ctx.leader.name} <b className={ctx.leader.finalReturnPct >= 0 ? "up" : "down"}>{fp(ctx.leader.finalReturnPct)}</b>
                </span>
              )}
            </div>
          )}
          {loading ? (
            <div className="ctx-loading">
              <div className="report-spin" />
              <span>Building the dossier…</span>
            </div>
          ) : (
            <div className="pl-coach" dangerouslySetInnerHTML={{ __html: mdToHtml(brief ?? "") }} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function EpisodeCard({ ep, onChange }: { ep: Episode; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(ep.title);
  const [when, setWhen] = useState(toLocalInput(ep.scheduledAt));
  const [status, setStatus] = useState<EpisodeStatus>(ep.status);
  const [notes, setNotes] = useState(ep.notes ?? "");
  const [guests, setGuests] = useState<ShowGuest[]>(ep.guests);
  const [topics, setTopics] = useState<string[]>(ep.topics);
  const [gName, setGName] = useState("");
  const [gHandle, setGHandle] = useState("");
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState(false);

  const save = async () => {
    await updateEpisode(ep.id, { title, scheduledAt: fromLocalInput(when), status, notes, guests, topics });
    setEditing(false);
    onChange();
  };

  return (
    <div className={`sp-card s-${ep.status}`}>
      <div className="sp-card-head">
        <span className={`sp-status s-${ep.status}`}>{ep.status}</span>
        {editing ? (
          <input className="pf-in" value={title} onChange={(e) => setTitle(e.target.value)} />
        ) : (
          <h3>{ep.title}</h3>
        )}
        <div className="sp-card-acts">
          <button className="cc-chip sm" onClick={() => setBrief(true)} title="AI go-live dossier — grounded in the live tape, audience & last show">
            ✦ Dossier
          </button>
          <button className="cc-icon-btn" onClick={() => setEditing((v) => !v)} title="Edit">
            ✎
          </button>
          <button
            className="cc-icon-btn"
            onClick={() => confirm(`Delete "${ep.title}"?`) && deleteEpisode(ep.id).then(onChange)}
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="sp-when">📅 {dateLabel(ep.scheduledAt)}</div>

      <div className="sp-card-body">
      {!editing ? (
        <div className="sp-read">
          <div className="sp-meta">
            <span className="sp-meta-chip">{untilLabel(ep.scheduledAt, ep.status)}</span>
            <span className="sp-meta-chip">
              {ep.guests.length} guest{ep.guests.length === 1 ? "" : "s"}
            </span>
            <span className="sp-meta-chip">
              {ep.topics.length} segment{ep.topics.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="sp-sec">
            <div className="sp-sec-h">Guests</div>
            {ep.guests.length > 0 ? (
              <div className="sp-guests">
                {ep.guests.map((g, i) => (
                  <GuestIntel key={`${g.handle || g.name}:${i}`} g={g} />
                ))}
              </div>
            ) : (
              <div className="sp-sec-empty">No guests yet — line one up with Edit ✎</div>
            )}
          </div>

          <div className="sp-sec">
            <div className="sp-sec-h">Topics / segments</div>
            {ep.topics.length > 0 ? (
              <div className="sp-topics">
                {ep.topics.map((t, i) => (
                  <span key={i} className="sp-topic">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <div className="sp-sec-empty">No segments yet — plan the run of show with Edit ✎</div>
            )}
          </div>

          <div className="sp-sec">
            <div className="sp-sec-h">Notes</div>
            {ep.notes ? <div className="sp-notes">{ep.notes}</div> : <div className="sp-sec-empty">No notes yet — jot prep notes with Edit ✎</div>}
          </div>
        </div>
      ) : (
        <div className="sp-edit">
          <div className="sp-edit-row">
            <label>
              <span>When</span>
              <input className="pf-in" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
            <label>
              <span>Status</span>
              <select className="pf-in sm" value={status} onChange={(e) => setStatus(e.target.value as EpisodeStatus)}>
                {STATUS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="sp-edit-block">
            <span className="sp-edit-lbl">Guests</span>
            {guests.map((g, i) => (
              <div key={i} className="sp-guest-edit">
                <span>
                  {g.name}
                  {g.handle ? ` · @${g.handle}` : ""}
                </span>
                <button className="ck-x" onClick={() => setGuests(guests.filter((_, k) => k !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <div className="sp-add">
              <input className="pf-in sm" placeholder="Guest name" value={gName} onChange={(e) => setGName(e.target.value)} />
              <input
                className="pf-in sm"
                placeholder="X handle"
                value={gHandle}
                onChange={(e) => setGHandle(e.target.value.replace(/^@/, ""))}
              />
              <button
                className="cc-chip sm"
                onClick={() => {
                  if (!gName.trim()) return;
                  setGuests([...guests, { name: gName.trim(), handle: gHandle.trim() || undefined }]);
                  setGName("");
                  setGHandle("");
                }}
              >
                + Guest
              </button>
            </div>
          </div>

          <div className="sp-edit-block">
            <span className="sp-edit-lbl">Topics / segments</span>
            <div className="sp-topics">
              {topics.map((t, i) => (
                <span key={i} className="sp-topic">
                  {t}
                  <button className="sp-topic-x" onClick={() => setTopics(topics.filter((_, k) => k !== i))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="sp-add">
              <input
                className="pf-in"
                placeholder="Add a topic…"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && topic.trim()) {
                    setTopics([...topics, topic.trim()]);
                    setTopic("");
                  }
                }}
              />
            </div>
          </div>

          <label className="sp-notes-edit">
            <span className="sp-edit-lbl">Notes</span>
            <textarea className="pf-in" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="sp-edit-acts">
            <button className="cc-chip active" onClick={save}>
              Save
            </button>
            <button className="cc-chip" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      </div>

      {brief && <BriefModal ep={ep} onClose={() => setBrief(false)} />}
    </div>
  );
}

/** Compact list row for the master pane. */
function ShowRow({ ep, active, onSelect }: { ep: Episode; active: boolean; onSelect: () => void }) {
  const guests = ep.guests.length;
  return (
    <button className={`sp-row s-${ep.status} ${active ? "active" : ""}`} onClick={onSelect}>
      <div className="sp-row-main">
        <div className="sp-row-title">{ep.title}</div>
        <div className="sp-row-sub">
          {dateLabel(ep.scheduledAt)}
          {guests > 0 ? ` · ${guests} guest${guests === 1 ? "" : "s"}` : ""}
        </div>
      </div>
      <span className={`sp-status s-${ep.status}`}>{ep.status}</span>
    </button>
  );
}

/** Show Planning — master–detail: a compact schedule list on the left, the selected
 * episode's full detail (guests + intel, topics, notes, AI brief) on the right. The
 * detail is its own column, so expanding guest intel never leaves a side-by-side void. */
export function ShowPlanningView() {
  const [eps, setEps] = useState<Episode[]>([]);
  const [title, setTitle] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const load = () => fetchEpisodes().then(setEps);
  useEffect(() => {
    load();
  }, []);

  const now = Date.now();
  const { upcoming, past } = useMemo(() => {
    const up: Episode[] = [];
    const pa: Episode[] = [];
    for (const e of eps) (e.status === "done" || e.scheduledAt < now - 6 * 3_600_000 ? pa : up).push(e);
    return { upcoming: up, past: pa.reverse() };
  }, [eps, now]);

  // keep a valid selection: default to the first upcoming (or any) show
  useEffect(() => {
    if (eps.length && !eps.some((e) => e.id === selectedId)) {
      setSelectedId((upcoming[0] ?? past[0])?.id ?? null);
    }
  }, [eps, selectedId, upcoming, past]);

  const selected = eps.find((e) => e.id === selectedId) ?? null;

  const create = async () => {
    const created = await createEpisode({ title: title.trim() || "New show", scheduledAt: Date.now() + 86_400_000 });
    setTitle("");
    await load();
    if (created?.id) setSelectedId(created.id);
  };

  return (
    <div className="sp-view">
      <div className="sp-top">
        <div>
          <h2>Show Planning</h2>
          <p className="cc-empty-sm">Schedule shows, line up guests, prep topics — then pull a go-live dossier grounded in the live tape, your audience &amp; last show.</p>
        </div>
        <div className="sp-new">
          <input
            className="pf-in"
            placeholder="New show title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button className="cc-chip active" onClick={create}>
            + New show
          </button>
        </div>
      </div>

      <div className="sp-md">
        <aside className="sp-list">
          <div className="sp-col-h">Upcoming</div>
          {upcoming.length === 0 && <div className="cc-empty-sm">Nothing scheduled — add a show.</div>}
          {upcoming.map((e) => (
            <ShowRow key={e.id} ep={e} active={e.id === selectedId} onSelect={() => setSelectedId(e.id)} />
          ))}
          {past.length > 0 && (
            <>
              <div className="sp-col-h">Past episodes</div>
              {past.map((e) => (
                <ShowRow key={e.id} ep={e} active={e.id === selectedId} onSelect={() => setSelectedId(e.id)} />
              ))}
            </>
          )}
        </aside>

        <div className="sp-detail">
          {selected ? (
            <EpisodeCard key={selected.id} ep={selected} onChange={load} />
          ) : (
            <div className="sp-detail-empty">Select a show on the left, or add one to start planning.</div>
          )}
        </div>
      </div>
    </div>
  );
}
