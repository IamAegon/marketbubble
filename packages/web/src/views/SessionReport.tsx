import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Platform, SessionSummary } from "@app/shared";
import { fetchSessions, fmtDuration } from "../lib/sessions";
import { fetchSessionReport } from "../lib/report";
import { StackedBars, TrendLine } from "../analytics/charts";
import { ReportModal } from "../analytics/ReportModal";
import { UserLink } from "../components/UserLink";

const PLAT_LABEL: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };
const fmtClock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const when = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const sentText = (n: number) => (n > 0.15 ? "Bullish" : n < -0.15 ? "Bearish" : "Flat");
const sentCls = (n: number) => (n > 0.15 ? "bull" : n < -0.15 ? "bear" : "flat");

/** Per-session deep report (Review): a recorded show rendered from its durable
 * summary — KPIs, activity + sentiment timelines, top chatters/cashtags/emotes,
 * and the LaTeX PDF. Moment reels stay on live Reactions (raw chat isn't stored). */
export function SessionReport() {
  const { id } = useParams();
  const [s, setS] = useState<SessionSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const all = await fetchSessions();
      if (!alive) return;
      const found = all.find((x) => x.id === id) ?? null;
      setS(found);
      setMissing(!found);
    };
    load();
    // keep a still-recording session fresh; ended sessions are immutable
    const t = setInterval(() => {
      if (!s || s.status === "recording") load();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (missing) {
    return (
      <div className="aview">
        <Link to="/app/analytics/sessions" className="sreport-back">
          ← Sessions
        </Link>
        <div className="cc-empty-sm">Session not found — it may have been pruned from history.</div>
      </div>
    );
  }
  if (!s) return <div className="aview"><div className="cc-empty-sm">Loading session…</div></div>;

  const live = s.status === "recording";
  const platEntries = Object.entries(s.byPlatform).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const maxPlat = Math.max(1, ...platEntries.map(([, n]) => n));
  const maxTag = Math.max(1, ...s.topCashtags.map((c) => c.count));
  const maxEmote = Math.max(1, ...s.topEmotes.map((e) => e.count));
  const perChatter = s.chatters ? s.messages / s.chatters : 0;

  return (
    <div className="aview">
      <Link to="/app/analytics/sessions" className="sreport-back">
        ← Sessions
      </Link>

      <div className="aview-top">
        <div className="aview-title">
          {s.streamerName} <span className={`spick-tag ${s.owned ? "" : "ext"}`}>{s.owned ? "MB" : "ext"}</span>
          {live && <span className="sreport-live"><span className="rec-dot" /> recording</span>}
          <span className="aview-sub">
            {when(s.startedAt)}
            {s.endedAt ? ` – ${fmtClock(s.endedAt)}` : ""} · {fmtDuration(s.durationMs)} · started by {s.startedBy}
          </span>
        </div>
        <div className="aview-controls">
          <button className="cc-chip" onClick={() => setShowReport(true)} title="LaTeX-compiled PDF report">
            ⤓ Export PDF
          </button>
        </div>
      </div>

      {showReport && (
        <ReportModal
          fetcher={() => fetchSessionReport(s.id)}
          filename={`marketbubble-session-${s.streamerName}-${s.id}.pdf`}
          title={`${s.streamerName} · session report`}
          onClose={() => setShowReport(false)}
        />
      )}

      <div className="aview-cards">
        <div className="astat">
          <div className="astat-n">{s.messages.toLocaleString()}</div>
          <div className="astat-l">messages</div>
        </div>
        <div className="astat">
          <div className="astat-n">{s.avgPerMin.toFixed(1)}</div>
          <div className="astat-l">avg msgs / min</div>
        </div>
        <div className="astat">
          <div className="astat-n">{Math.round(s.peakPerMin).toLocaleString()}</div>
          <div className="astat-l">peak / min{s.peakPerMin > 0 ? ` · ${fmtClock(s.peakAt)}` : ""}</div>
        </div>
        <div className="astat">
          <div className="astat-n">{s.chatters.toLocaleString()}</div>
          <div className="astat-l">unique chatters</div>
        </div>
        <div className="astat">
          <div className="astat-n">{perChatter ? perChatter.toFixed(1) : "—"}</div>
          <div className="astat-l">msgs / chatter</div>
        </div>
        <div className={`astat sent-${sentCls(s.net)}`}>
          <div className="astat-n">{sentText(s.net)}</div>
          <div className="astat-l">net sentiment · {s.net >= 0 ? "+" : ""}{(s.net * 100).toFixed(0)}</div>
        </div>
      </div>

      <section className="acard">
        <div className="acard-h">
          <h3>Chat activity</h3>
          <div className="acard-legend">
            <span className="lg lg-twitch">Twitch</span>
            <span className="lg lg-kick">Kick</span>
            <span className="lg lg-x">X</span>
          </div>
        </div>
        {s.activity.length > 1 ? (
          <StackedBars buckets={s.activity} peakAt={s.peakAt} />
        ) : (
          <div className="cc-empty-sm">Too short to chart — needs a couple minutes of chat.</div>
        )}
        <div className="aaxis center">{s.messages.toLocaleString()} msgs · 60s buckets</div>
      </section>

      <section className="acard">
        <div className="acard-h">
          <h3>Chat sentiment over time</h3>
          <span className={`sent-pill sent-${sentCls(s.net)}`}>
            {sentText(s.net)} {s.net >= 0 ? "+" : ""}
            {(s.net * 100).toFixed(0)}
          </span>
        </div>
        <TrendLine points={s.sentiment} />
      </section>

      <div className="aview-cols">
        <section className="acard">
          <h3>By platform</h3>
          {platEntries.length === 0 && <div className="cc-empty-sm">No messages recorded.</div>}
          {platEntries.map(([p, n]) => (
            <div className="aplat" key={p}>
              <span className={`pill ${p}`}>{PLAT_LABEL[p as Platform]}</span>
              <div className="aplat-bar">
                <div className={`aplat-fill src-${p}`} style={{ width: `${(n / maxPlat) * 100}%` }} />
              </div>
              <span className="aplat-n">{compact(n)}</span>
            </div>
          ))}
        </section>

        <section className="acard">
          <h3>Top chatters</h3>
          {s.topChatters.length === 0 && <div className="cc-empty-sm">No messages recorded.</div>}
          <ol className="atop">
            {s.topChatters.slice(0, 10).map((u, i) => (
              <li key={`${u.platform}:${u.username}`}>
                <span className="atop-rank">{i + 1}</span>
                <span className={`pill ${u.platform}`}>{PLAT_LABEL[u.platform]}</span>
                <UserLink platform={u.platform} username={u.username} name={u.name} className="atop-name" />
                <span className="atop-rate">{u.perMin.toFixed(1)}/min</span>
                <span className="atop-count">{u.count}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="aview-cols">
        <section className="acard">
          <h3>Top cashtags</h3>
          {s.topCashtags.length === 0 ? (
            <div className="cc-empty-sm">No cashtags mentioned this session.</div>
          ) : (
            <div className="tags">
              {s.topCashtags.map((c) => (
                <div className="tag" key={c.symbol}>
                  <span className="tag-sym">${c.symbol}</span>
                  <div className="tag-bar">
                    <div className="tag-fill" style={{ width: `${(c.count / maxTag) * 100}%` }} />
                  </div>
                  <span className="tag-n">{c.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="acard">
          <h3>Top emotes</h3>
          {s.topEmotes.length === 0 ? (
            <div className="cc-empty-sm">No emotes seen this session.</div>
          ) : (
            <div className="emotes">
              {s.topEmotes.map((e) => (
                <div className="emote" key={e.url} title={e.name}>
                  <img src={e.url} alt={e.name} loading="lazy" />
                  <span className="emote-n" style={{ width: `${(e.count / maxEmote) * 100}%` }} />
                  <span className="emote-c">{compact(e.count)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
