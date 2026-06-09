import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Platform, StatsRange } from "@app/shared";
import { useStats } from "../lib/stats";
import { fetchReport } from "../lib/report";
import { StackedBars, TrendLine } from "../analytics/charts";
import { ReportModal } from "../analytics/ReportModal";
import { RecordingStrip } from "../analytics/RecordingStrip";
import { UserLink } from "../components/UserLink";
import { useDashboard } from "../state/DashboardProvider";
import { renderRich } from "../render/emotes";

interface Inspected {
  platform: Platform;
  username: string;
  name: string;
}

const PLAT_LABEL: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };
const RANGES: { id: StatsRange; label: string }[] = [
  { id: "5m", label: "5m" },
  { id: "20m", label: "20m" },
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "session", label: "Session" },
];

const fmtClock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

/** Pulse — Market Bubble's live war-room: all our streams combined, or one of
 * ours, in real time. The recording strip up top is the bridge to Review —
 * watch the pulse, hit record, and the session flows into Sessions → Report. */
export function AnalyticsView() {
  const [range, setRange] = useState<StatsRange>("20m");
  const [streamer, setStreamer] = useState<string | undefined>(undefined);
  const [showReport, setShowReport] = useState(false);
  const { data, loading, error } = useStats(range, "owned", streamer);
  const { viewers, messages } = useDashboard();
  // click a chatter → inspect just their messages from the live session buffer (works
  // during and after the stream while the session is still loaded)
  const [inspect, setInspect] = useState<Inspected | null>(null);
  const inspectMsgs = useMemo(
    () =>
      inspect
        ? messages.filter(
            (m) =>
              m.kind !== "post" &&
              m.platform === inspect.platform &&
              m.author.username.toLowerCase() === inspect.username.toLowerCase(),
          )
        : [],
    [inspect, messages],
  );

  const ours = (data?.streamers ?? []).filter((s) => s.owned);
  const viewLabel = data?.streamerName ?? "All Market Bubble streams";

  const sent = data?.sentiment ?? [];
  const net = sent.length ? sent[sent.length - 1]!.net : 0;
  const bull = sent.length ? sent[sent.length - 1]!.bullish : 0;
  const bear = sent.length ? sent[sent.length - 1]!.bearish : 0;
  const sentLabel = net > 0.15 ? "Bullish" : net < -0.15 ? "Bearish" : "Flat";
  const perChatter = data && data.chatters ? data.sessionTotal / data.chatters : 0;
  const platEntries = data ? Object.entries(data.byPlatform).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : [];
  const maxPlat = Math.max(1, ...platEntries.map(([, n]) => n));
  const maxChannel = Math.max(1, ...(data?.channels ?? []).map((c) => c.count));
  const maxTag = Math.max(1, ...(data?.cashtags ?? []).map((c) => c.count));
  const maxEmote = Math.max(1, ...(data?.emotes ?? []).map((e) => e.count));

  return (
    <div className="aview">
      <div className="aview-top">
        <div className="aview-title">
          {viewLabel}
          <span className="aview-sub">
            {data?.streamerName ? "Market Bubble streamer" : "Market Bubble — all streams combined"}
            {data ? ` · ${data.durable ? "durable" : "live"} · since ${fmtClock(data.startedAt)}` : ""}
          </span>
        </div>
        <div className="aview-controls">
          <div className="range-toggle">
            {RANGES.map((r) => (
              <button key={r.id} className={range === r.id ? "active" : ""} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <button
            className="cc-chip"
            onClick={() => setShowReport(true)}
            disabled={!data}
            title="Generate a LaTeX-compiled PDF report"
          >
            ⤓ Export PDF
          </button>
        </div>
      </div>

      <RecordingStrip />

      {/* our streams — "All combined" or focus one of ours */}
      {data && ours.length > 0 && (
        <div className="streamer-picker">
          <button
            className={`spick owned all ${!streamer ? "active" : ""}`}
            onClick={() => setStreamer(undefined)}
            title="All Market Bubble streams combined"
          >
            <span className="spick-name">All combined</span>
            <span className="spick-n">{compact(data.comparison.owned.total)}</span>
          </button>
          {ours.map((s) => (
            <button
              key={s.id}
              className={`spick owned ${streamer === s.id ? "active" : ""}`}
              onClick={() => setStreamer(streamer === s.id ? undefined : s.id)}
              title={`${s.name} · Market Bubble`}
            >
              <span className={`spick-dot ${s.recording ? "rec" : ""}`} />
              <span className="spick-name">{s.name}</span>
              <span className="spick-n">{compact(s.total)}</span>
            </button>
          ))}
        </div>
      )}

      {showReport && (
        <ReportModal
          fetcher={() => fetchReport(range, "owned", streamer)}
          filename={`marketbubble-${streamer ?? "combined"}.pdf`}
          title={`${viewLabel} report`}
          onClose={() => setShowReport(false)}
        />
      )}

      {error && !data && <div className="cc-empty-sm">Couldn’t reach the analytics service. Retrying…</div>}
      {loading && !data && <div className="cc-empty-sm">Loading analytics…</div>}

      {data && (
        <>
          <div className="aview-cards">
            <div className="astat">
              <div className="astat-n">{data.sessionTotal.toLocaleString()}</div>
              <div className="astat-l">messages · session</div>
            </div>
            <div className="astat">
              <div className="astat-n">{data.perMin.toFixed(1)}</div>
              <div className="astat-l">msgs / min · now</div>
            </div>
            <div className="astat">
              <div className="astat-n">{data.peakPerMin.toFixed(0)}</div>
              <div className="astat-l">peak / min{data.peakPerMin > 0 ? ` · ${fmtClock(data.peakAt)}` : ""}</div>
            </div>
            <div className="astat">
              <div className="astat-n">{data.chatters.toLocaleString()}</div>
              <div className="astat-l">unique chatters</div>
            </div>
            <div className="astat">
              <div className="astat-n">{perChatter ? perChatter.toFixed(1) : "—"}</div>
              <div className="astat-l">msgs / chatter</div>
            </div>
            <div className={`astat sent-${net > 0.15 ? "bull" : net < -0.15 ? "bear" : "flat"}`}>
              <div className="astat-n">{sentLabel}</div>
              <div className="astat-l">
                sentiment · {bull}↑ / {bear}↓
              </div>
            </div>
            {data.hype && (
              <div className={`astat ${data.hype.score >= 66 ? "sent-bull" : data.hype.score >= 33 ? "" : "sent-flat"}`}>
                <div className="astat-n">{data.hype.score}</div>
                <div className="astat-l">
                  hype score{data.hype.acceleration ? ` · ${data.hype.acceleration > 0 ? "▲" : "▼"}${Math.abs(data.hype.acceleration).toFixed(1)}/min` : ""}
                </div>
              </div>
            )}
            {Object.keys(viewers).length > 0 && (
              <div className="astat">
                <div className="astat-n">{compact(Object.values(viewers).reduce((a, b) => a + b, 0))}</div>
                <div className="astat-l">live viewers</div>
              </div>
            )}
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
            <StackedBars buckets={data.buckets} peakAt={data.peakAt} spikes={data.hype?.spikes} />
            <div className="aaxis center">
              {data.total.toLocaleString()} msgs in range · {compact(Math.round(data.bucketMs / 1000))}s buckets
            </div>
          </section>

          <section className="acard">
            <div className="acard-h">
              <h3>Chat sentiment over time</h3>
              <span className={`sent-pill sent-${net > 0.15 ? "bull" : net < -0.15 ? "bear" : "flat"}`}>
                {sentLabel} {net >= 0 ? "+" : ""}
                {(net * 100).toFixed(0)}
              </span>
            </div>
            <TrendLine points={sent} />
          </section>

          <div className="aview-cols">
            <section className="acard">
              <h3>By platform</h3>
              {platEntries.length === 0 && <div className="cc-empty-sm">No messages yet.</div>}
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
              <h3>Busiest streams</h3>
              {(data.channels ?? []).length === 0 && <div className="cc-empty-sm">No messages yet.</div>}
              {data.channels.map((c) => (
                <div className="aplat" key={c.channel}>
                  <span className={`pill ${c.platform}`}>{PLAT_LABEL[c.platform]}</span>
                  <span className="achan-name" title={c.channel}>
                    {c.label}
                  </span>
                  {viewers[c.channel] != null && <span className="chan-viewers">{compact(viewers[c.channel]!)} 👁</span>}
                  <div className="aplat-bar">
                    <div className={`aplat-fill src-${c.platform}`} style={{ width: `${(c.count / maxChannel) * 100}%` }} />
                  </div>
                  <span className="aplat-n">{compact(c.count)}</span>
                </div>
              ))}
            </section>
          </div>

          <div className="aview-cols">
            <section className="acard">
              <h3>Top chatters</h3>
              {data.topChatters.length === 0 && <div className="cc-empty-sm">No messages yet.</div>}
              <ol className="atop">
                {data.topChatters.map((u, i) => (
                  <li key={`${u.platform}:${u.username}`}>
                    <span className="atop-rank">{i + 1}</span>
                    <span className={`pill ${u.platform}`}>{PLAT_LABEL[u.platform]}</span>
                    <UserLink platform={u.platform} username={u.username} name={u.name} className="atop-name" />
                    <button
                      className="atop-view"
                      title={`View ${u.name}'s messages`}
                      onClick={() => setInspect({ platform: u.platform, username: u.username, name: u.name })}
                    >
                      ⧉
                    </button>
                    <span className="atop-rate">{u.perMin.toFixed(1)}/min</span>
                    <span className="atop-count">{u.count}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="acard">
              <h3>Trending cashtags</h3>
              {(data.cashtags ?? []).length === 0 ? (
                <div className="cc-empty-sm">No cashtags yet — they appear when chat mentions $BTC, $SOL, etc.</div>
              ) : (
                <div className="tags">
                  {data.cashtags.map((c) => (
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
          </div>

          <section className="acard">
            <h3>Top emotes</h3>
            {(data.emotes ?? []).length === 0 ? (
              <div className="cc-empty-sm">No emotes seen yet.</div>
            ) : (
              <div className="emotes">
                {data.emotes.map((e) => (
                  <div className="emote" key={e.url} title={`${e.name} · ${e.count.toLocaleString()}`}>
                    <span className="emote-img">
                      <img src={e.url} alt={e.name} loading="lazy" />
                    </span>
                    <span className="emote-bar">
                      <span className="emote-fill" style={{ width: `${(e.count / maxEmote) * 100}%` }} />
                    </span>
                    <span className="emote-c">{compact(e.count)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="aview-cols">
            <section className="acard">
              <h3>Hype &amp; velocity</h3>
              {data.hype ? (
                <>
                  <div className="hype-big">
                    <span className={`hype-score ${data.hype.score >= 66 ? "hot" : data.hype.score >= 33 ? "warm" : ""}`}>
                      {data.hype.score}
                    </span>
                    <span className="hype-of">/ 100</span>
                  </div>
                  <div className="statchips">
                    <div className="statchip">
                      <span className="statchip-v">{data.hype.perMinNow.toFixed(1)}</span>
                      <span className="statchip-k">now /min</span>
                    </div>
                    <div className="statchip">
                      <span className="statchip-v">{data.hype.baselinePerMin.toFixed(1)}</span>
                      <span className="statchip-k">baseline</span>
                    </div>
                    <div className={`statchip ${data.hype.acceleration >= 0 ? "up" : "down"}`}>
                      <span className="statchip-v">
                        {data.hype.acceleration >= 0 ? "▲" : "▼"} {Math.abs(data.hype.acceleration).toFixed(1)}
                      </span>
                      <span className="statchip-k">accel /min</span>
                    </div>
                    <div className="statchip">
                      <span className="statchip-v">{data.hype.spikes.length}</span>
                      <span className="statchip-k">spike{data.hype.spikes.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="cc-empty-sm">Collecting…</div>
              )}
            </section>

            <section className="acard">
              <h3>New vs returning chatters</h3>
              {data.chatterInsights ? (
                <div className="statchips">
                  <div className="statchip">
                    <span className="statchip-v">{data.chatterInsights.newChatters.toLocaleString()}</span>
                    <span className="statchip-k">new</span>
                  </div>
                  <div className="statchip">
                    <span className="statchip-v">{data.chatterInsights.returning.toLocaleString()}</span>
                    <span className="statchip-k">returning</span>
                  </div>
                  <div className="statchip">
                    <span className="statchip-v">{(data.chatterInsights.returningRate * 100).toFixed(0)}%</span>
                    <span className="statchip-k">return rate</span>
                  </div>
                  <div className="statchip">
                    <span className="statchip-v">{data.chatterInsights.activeUniquesPerMin.toFixed(1)}</span>
                    <span className="statchip-k">active /min</span>
                  </div>
                </div>
              ) : (
                <div className="cc-empty-sm">Collecting…</div>
              )}
            </section>
          </div>

          <div className="aview-cols">
            <section className="acard">
              <h3>Sentiment by stream</h3>
              {(data.channelSentiment ?? []).length === 0 ? (
                <div className="cc-empty-sm">Not enough sentiment yet.</div>
              ) : (
                data.channelSentiment!.map((c) => (
                  <div className="aplat" key={c.channel}>
                    <span className={`pill ${c.platform}`}>{PLAT_LABEL[c.platform]}</span>
                    <span className="achan-name" title={c.channel}>
                      {c.label}
                    </span>
                    <span className={`sent-pill sent-${c.net > 0.15 ? "bull" : c.net < -0.15 ? "bear" : "flat"}`}>
                      {c.net >= 0 ? "+" : ""}
                      {(c.net * 100).toFixed(0)}
                    </span>
                  </div>
                ))
              )}
            </section>

            <section className="acard">
              <h3>Rising now</h3>
              {[...(data.emoteMomentum ?? []), ...(data.cashtagMomentum ?? [])].length === 0 ? (
                <div className="cc-empty-sm">No momentum yet.</div>
              ) : (
                <div className="mom-list">
                  {[...(data.emoteMomentum ?? []), ...(data.cashtagMomentum ?? [])]
                    .sort((a, b) => b.delta - a.delta)
                    .slice(0, 10)
                    .map((m) => (
                      <div className="mom-row" key={m.key}>
                        {m.url ? <img className="mom-ic" src={m.url} alt="" /> : <span className="mom-tag">{m.label ?? m.key}</span>}
                        {m.url && <span className="mom-name">{m.label ?? m.key}</span>}
                        <span className="mom-delta">▲{m.delta}</span>
                      </div>
                    ))}
                </div>
              )}
            </section>
          </div>

          <section className="acard">
            <h3>Most-reacted messages</h3>
            {(data.mostReacted ?? []).length === 0 ? (
              <div className="cc-empty-sm">No emote reactions yet.</div>
            ) : (
              <ol className="react-list">
                {data.mostReacted!.map((r) => {
                  const plat = (r.channel.split(":")[0] || "twitch") as Platform;
                  return (
                    <li key={r.id}>
                      <span className="react-badge">
                        <span className="react-fire">🔥</span>
                        <b>{compact(r.emoteCount)}</b>
                      </span>
                      <div className="react-body">
                        <div className="react-meta">
                          <span className={`pill ${plat}`}>{PLAT_LABEL[plat] ?? plat}</span>
                          <span className="react-chan" title={r.channel}>
                            {r.label}
                          </span>
                          <span className="react-auth">{r.author}</span>
                        </div>
                        <div className="react-quote">{r.text}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}
      {inspect &&
        createPortal(
          <div className="ci-overlay" onClick={() => setInspect(null)}>
            <div className="ci-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ci-head">
                <span className={`pill ${inspect.platform}`}>{PLAT_LABEL[inspect.platform]}</span>
                <b className="ci-name">{inspect.name}</b>
                <span className="ci-sub">
                  {inspectMsgs.length} message{inspectMsgs.length !== 1 ? "s" : ""} in session
                </span>
                <button className="ci-x" onClick={() => setInspect(null)} title="Close">
                  ✕
                </button>
              </div>
              <div className="ci-list">
                {inspectMsgs.length === 0 ? (
                  <div className="cc-empty-sm">No messages from {inspect.name} in the current session buffer.</div>
                ) : (
                  inspectMsgs.map((m) => (
                    <div className="ci-row" key={m.id}>
                      <time className="ci-time">{fmtClock(m.timestamp)}</time>
                      <span className="ci-text">{renderRich(m.text, { emotes: m.emotes, cashtags: m.cashtags })}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
