import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionSummary } from "@app/shared";
import { useDashboard } from "../state/DashboardProvider";
import { useToasts } from "../state/toasts";
import { analyzeSession, coachPrompt, type Moment } from "../lib/perfLab";
import { useReactions } from "../lib/reactions";
import { fetchSessionCaptions, fetchSessions, fmtDuration, type SessionCaption } from "../lib/sessions";
import { askAssistant } from "../lib/assistant";
import { mdToHtml } from "../lib/markdown";
import { TranscribeControl } from "../feed/TranscribeControl";
import { CaptionStream } from "../feed/CaptionStream";
import { ReactionChart } from "../analytics/charts";

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const clockS = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const WINDOWS = [
  { label: "20m", ms: 20 * 60_000, bin: 30_000 },
  { label: "1h", ms: 60 * 60_000, bin: 60_000 },
  { label: "Session", ms: 0, bin: 60_000 },
];

function Chips({ items, prefix = "" }: { items: { label: string; n: number }[]; prefix?: string }) {
  if (!items.length) return null;
  return (
    <>
      {items.map((d) => (
        <span key={prefix + d.label} className="pl-chip">
          {prefix}
          {d.label} <em>{d.n}</em>
        </span>
      ))}
    </>
  );
}

function MomentCard({ m, rank }: { m: Moment; rank: number }) {
  const { push } = useToasts();
  const copyClip = () => {
    const txt = `Clip window: ${clockS(m.startT)} – ${clockS(m.endT)} (peak ${clockS(m.peakT)}, ${m.peakPerMin}/min, ×${m.lift} normal)`;
    navigator.clipboard?.writeText(txt);
    push({ title: "📋 Clip window copied", body: txt, kind: "info" });
  };
  return (
    <div className="pl-moment">
      <div className="pl-moment-head">
        <span className="pl-rank">#{rank}</span>
        <span className="pl-lift">×{m.lift}</span>
        <span className="pl-when">
          {clock(m.startT)}–{clock(m.endT)}
        </span>
        <span className="pl-rate">{m.peakPerMin}/min peak</span>
        <button className="cc-chip sm" onClick={copyClip} title="Copy the clip window">
          📋 Clip
        </button>
      </div>
      {m.said ? (
        <div className="pl-said">
          <span className="pl-said-ic">🎙</span> “{m.said}”
        </div>
      ) : (
        <div className="pl-said pl-said-empty">No transcript here — turn on Transcribe to capture what was said.</div>
      )}
      {(m.cashtags.length > 0 || m.keywords.length > 0) && (
        <div className="pl-drivers">
          <Chips items={m.cashtags} prefix="$" />
          <Chips items={m.keywords} prefix="#" />
        </div>
      )}
      <div className="pl-moment-foot">
        {m.chatters.length > 0 && (
          <span className="pl-loud">
            loudest:{" "}
            {m.chatters.map((c, i) => (
              <span key={c.label}>
                {i > 0 ? ", " : ""}
                {c.href ? (
                  <a className="pl-chatter" href={c.href} target="_blank" rel="noopener noreferrer">
                    {c.label}
                  </a>
                ) : (
                  c.label
                )}
              </span>
            ))}
          </span>
        )}
        <span className="pl-plats">
          {Object.entries(m.platforms)
            .sort((a, b) => b[1] - a[1])
            .map(([p, n]) => `${p} ${n}`)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}

/** Stream Performance Lab — reaction attribution, an interactive energy + sentiment
 * chart, a clip-worthy moment reel, the live/recorded transcript, and an AI coach.
 * Works on the LIVE stream or by replaying a recorded session. */
export function PerformanceLab() {
  const d = useDashboard();
  const { push } = useToasts();
  const isMod = d.user?.role === "mod" || d.user?.role === "admin";

  // source: "live" or a recorded session id
  const [source, setSource] = useState<string>("live");
  const live = source === "live";
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionCaps, setSessionCaps] = useState<SessionCaption[]>([]);
  const [capsLoading, setCapsLoading] = useState(false);

  const [win, setWin] = useState(1); // default 1h (live only)
  const [channel, setChannel] = useState("all");
  const [liveAlerts, setLiveAlerts] = useState(false);
  const [coach, setCoach] = useState<string | null>(null);
  const [coaching, setCoaching] = useState(false);
  const [mock, setMock] = useState(false);

  // recorded sessions for the picker
  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => {});
  }, []);
  // load a recorded session's transcript when picked
  useEffect(() => {
    if (live) {
      setSessionCaps([]);
      return;
    }
    setCapsLoading(true);
    let alive = true;
    fetchSessionCaptions(source)
      .then((c) => alive && setSessionCaps(c))
      .finally(() => alive && setCapsLoading(false));
    return () => {
      alive = false;
    };
  }, [source, live]);

  // streams present in chat (live picker) — exclude news + internal MB rooms.
  // Messages now arrive in batched flushes, so deriving from d.messages is cheap.
  const channels = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of d.messages) if (msg.kind !== "post" && msg.platform !== "mb") m.set(msg.channel, msg.channelLabel);
    return [...m.entries()].map(([id, label]) => ({ id, label }));
  }, [d.messages]);

  const w = WINDOWS[win]!;
  const sessionObj = live ? null : sessions.find((s) => s.id === source) ?? null;
  const scopeLabel = live ? (channel === "all" ? "all streams" : channels.find((c) => c.id === channel)?.label ?? channel) : sessionObj?.streamerName ?? "session";

  // LIVE: the heavy per-bucket reaction fold runs on the server (off the main thread),
  // polled here. RECORDED: cheap aggregate fold stays client-side.
  const liveRx = useReactions({ binMs: w.bin, sinceMs: w.ms || undefined, channel }, live);
  const sessionAnalysis = useMemo(
    () => (!live && sessionObj ? analyzeSession(sessionObj, sessionCaps) : null),
    [live, sessionObj, sessionCaps],
  );
  const analysis = live ? liveRx.analysis : sessionAnalysis;

  // live spike detector — a dedicated, more-sensitive server poll (10m / 30s window) drives toasts
  const alertRx = useReactions({ binMs: 30_000, sinceMs: 10 * 60_000, channel, z: 2.2 }, live && liveAlerts);
  const lastAlert = useRef(0);
  useEffect(() => {
    if (!live || !liveAlerts || !alertRx.analysis) return;
    const now = Date.now();
    const m = alertRx.analysis.moments.find((x) => x.endT >= now - 45_000);
    if (m && now - lastAlert.current > 90_000) {
      lastAlert.current = now;
      push({
        title: `🔥 Reaction spike${channel !== "all" ? " · " + scopeLabel : ""}`,
        body: `${m.peakPerMin}/min · ×${m.lift} normal — clip it now (${clock(m.startT)})`,
        kind: "highlight",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertRx.analysis, live, liveAlerts, channel, scopeLabel]);

  // transcript lines for the panel — live captions or the session transcript
  const liveCaps = useMemo(() => {
    if (!live) return [];
    return d.messages
      .filter((m) => m.kind === "caption" && (channel === "all" || m.channel === channel))
      .slice(-400)
      .map((m) => ({ id: m.id, t: m.timestamp, text: m.text, channelLabel: m.channelLabel }));
  }, [d.messages, channel, live]);
  const sessLines = useMemo(() => sessionCaps.map((c, i) => ({ id: `s${i}`, t: c.t, text: c.text })), [sessionCaps]);

  const genCoach = async () => {
    if (!analysis) return;
    setCoaching(true);
    setCoach(null);
    try {
      const { reply, mock } = await askAssistant([{ role: "user", content: coachPrompt(analysis, scopeLabel) }]);
      setCoach(reply);
      setMock(mock);
    } catch {
      setCoach("Couldn’t reach the coach. Try again.");
    } finally {
      setCoaching(false);
    }
  };
  const shareCoach = () => {
    if (!coach) return;
    d.post("mb:mod", `📊 **Coach report — ${scopeLabel}**\n\n${coach}`);
    push({ title: "Shared to #mod", body: "Coach report posted to the mod room.", kind: "room" });
  };
  const copyCoach = () => {
    if (coach) navigator.clipboard?.writeText(coach);
    push({ title: "Copied", body: "Coach report copied.", kind: "info" });
  };

  const a = analysis;
  const endedSessions = sessions.filter((s) => s.status === "ended").sort((x, y) => y.startedAt - x.startedAt);

  return (
    <div className="pl-view">
      <div className="pl-top">
        <div>
          <h2>Reactions</h2>
          <p className="cc-empty-sm">
            Where the room reacted, what drove it, and what was said — live, or replayed from a recorded show.
          </p>
        </div>
        <div className="pl-controls">
          <select className="pf-in" value={source} onChange={(e) => setSource(e.target.value)} title="Live, or a recorded session">
            <option value="live">● Live</option>
            {endedSessions.length > 0 && (
              <optgroup label="Recorded sessions">
                {endedSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.streamerName} · {new Date(s.startedAt).toLocaleDateString([], { month: "short", day: "numeric" })}{" "}
                    {new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {fmtDuration(s.durationMs)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {live && (
            <>
              <select className="pf-in sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="all">All streams</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <div className="range-toggle">
                {WINDOWS.map((x, i) => (
                  <button key={x.label} className={win === i ? "active" : ""} onClick={() => setWin(i)}>
                    {x.label}
                  </button>
                ))}
              </div>
              <button
                className={`cc-chip ${liveAlerts ? "active" : ""}`}
                onClick={() => setLiveAlerts((v) => !v)}
                title="Toast me when the room spikes — clip it in real time"
              >
                {liveAlerts ? "🔴 Live alerts on" : "○ Live alerts"}
              </button>
              <TranscribeControl channels={channels} />
            </>
          )}
        </div>
      </div>

      {!a ? (
        <div className="pl-card">
          <div className="cc-empty-sm" style={{ padding: 24 }}>{capsLoading ? "Loading session…" : live ? "Reading the room…" : "Select a source."}</div>
        </div>
      ) : (
        <>
          <div className="pl-kpis">
            <div className="pl-kpi">
              <div className="pl-kpi-n">{a.peakPerMin}</div>
              <div className="pl-kpi-l">peak msgs/min · {clock(a.peakAt)}</div>
            </div>
            <div className="pl-kpi">
              <div className={`pl-kpi-n ${a.net > 0.05 ? "up" : a.net < -0.05 ? "down" : ""}`}>
                {a.net >= 0 ? "+" : ""}
                {Math.round(a.net * 100)}
              </div>
              <div className="pl-kpi-l">net sentiment</div>
            </div>
            <div className="pl-kpi">
              <div className="pl-kpi-n">{a.moments.length}</div>
              <div className="pl-kpi-l">reaction moments</div>
            </div>
            <div className="pl-kpi">
              <div className="pl-kpi-n">{a.baseline}</div>
              <div className="pl-kpi-l">baseline msgs/min</div>
            </div>
            <div className="pl-kpi">
              <div className="pl-kpi-n">{a.chatters}</div>
              <div className="pl-kpi-l">unique chatters</div>
            </div>
            <div className="pl-kpi">
              <div className={`pl-kpi-n ${a.lullPct > 40 ? "warn" : ""}`}>{a.lullPct}%</div>
              <div className="pl-kpi-l">time in a lull</div>
            </div>
          </div>

          <div className="pl-card">
            <div className="pl-card-h">
              Energy &amp; sentiment <span className="pl-sub">bars = chat rate · line = sentiment · hover for the moment</span>
            </div>
            <div className="pl-chart">
              <ReactionChart
                bins={a.bins}
                baseline={a.baseline}
                binMs={a.binMs}
                momentSpans={a.moments.map((m) => ({ startT: m.startT, endT: m.endT }))}
                source={a.source}
                sessionDrivers={a.sessionDrivers}
              />
            </div>
          </div>

          <div className="pl-grid">
            <div className="pl-card">
              <div className="pl-card-h">
                Key moments <span className="pl-sub">where the room popped — what was said &amp; who drove it</span>
              </div>
              {a.moments.length === 0 ? (
                <div className="cc-empty-sm">No standout reactions in this window — the room was steady.</div>
              ) : (
                <div className="pl-moments">
                  {a.moments.slice(0, 12).map((m, i) => (
                    <MomentCard key={m.startT} m={m} rank={i + 1} />
                  ))}
                </div>
              )}
            </div>

            <div className="pl-card">
              <div className="pl-card-h">
                Transcript <span className="pl-sub">{live ? "live speech-to-text" : "recorded"}</span>
              </div>
              <CaptionStream
                lines={live ? liveCaps : sessLines}
                showChannel={live && channel === "all"}
                pin={live}
                empty={
                  live ? (
                    <p className="cc-empty-sm">
                      Open <b>🎙 Transcribe</b> above and turn on a Twitch/Kick stream — lines appear here as they’re spoken.
                    </p>
                  ) : (
                    <p className="cc-empty-sm">{capsLoading ? "Loading transcript…" : "This session wasn’t transcribed."}</p>
                  )
                }
              />
            </div>
          </div>

          <div className="pl-card">
            <div className="pl-card-h">
              Coach report <span className="pl-sub">{mock ? "demo" : "AI"}</span>
            </div>
            {!coach && !coaching && (
              <div className="pl-coach-empty">
                <p className="cc-empty-sm">An AI read of this {live ? "session" : "show"} — what landed, what dragged, and what to change next time.</p>
                <button className="cc-chip active" onClick={genCoach} disabled={a.total < 5}>
                  ✦ Generate coach report
                </button>
              </div>
            )}
            {coaching && (
              <div className="pl-coach-empty">
                <div className="report-spin" />
                <span className="cc-empty-sm">Coaching…</span>
              </div>
            )}
            {coach && !coaching && (
              <>
                <div className="pl-coach" dangerouslySetInnerHTML={{ __html: mdToHtml(coach) }} />
                <div className="pl-coach-acts">
                  <button className="cc-chip" onClick={genCoach}>
                    ↻ Regenerate
                  </button>
                  <button className="cc-chip" onClick={copyCoach}>
                    Copy
                  </button>
                  {isMod && (
                    <button className="cc-chip active" onClick={shareCoach}>
                      Share to #mod
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
