import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SessionSummary } from "@app/shared";
import { fetchSessions, fmtDuration } from "../lib/sessions";
import { SessionVolumeBars } from "../analytics/charts";

const when = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const shortDay = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
const sentCls = (n: number) => (n > 0.15 ? "bull" : n < -0.15 ? "bear" : "flat");
const sentText = (n: number) => (n > 0.15 ? "Bullish" : n < -0.15 ? "Bearish" : "Flat");

/** Sessions — the Review front door: every recorded show, with a volume trend.
 * Click a session to open its full report. */
export function HistoryView() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const nav = useNavigate();
  useEffect(() => {
    fetchSessions().then(setSessions);
    const t = setInterval(() => fetchSessions().then(setSessions), 8000);
    return () => clearInterval(t);
  }, []);

  const ended = sessions.filter((s) => s.status === "ended");
  const recording = sessions.filter((s) => s.status === "recording");
  const recent = ended.slice(0, 24).reverse(); // oldest→newest for the trend
  const volData = recent.map((s) => ({
    id: s.id,
    label: shortDay(s.startedAt),
    messages: s.messages,
    name: s.streamerName,
    owned: s.owned,
    whenLabel: when(s.startedAt),
    dur: fmtDuration(s.durationMs),
  }));

  return (
    <div className="aview">
      <div className="aview-top">
        <div className="aview-title">
          Sessions
          <span className="aview-sub">recorded broadcasts · click one to open its report</span>
        </div>
      </div>

      {recording.length > 0 && (
        <section className="acard">
          <h3>Recording now</h3>
          <div className="sess-live">
            {recording.map((s) => (
              <Link to={s.id} className="sess-live-chip" key={s.id}>
                <span className="rec-dot" /> {s.streamerName}
                <span className="sess-live-n">{s.messages.toLocaleString()} msgs · {fmtDuration(s.durationMs)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {ended.length === 0 ? (
        <div className="cc-empty-sm">
          No recorded sessions yet. Start (and stop) a recording from the strip on the <b>Pulse</b> page to build history.
        </div>
      ) : (
        <>
          <section className="acard">
            <div className="acard-h">
              <h3>Messages per session</h3>
              <span className="cmp-sub">each bar = one recorded show, oldest → newest · click to open</span>
            </div>
            <SessionVolumeBars data={volData} onSelect={(id) => nav(id)} />
          </section>

          <section className="acard">
            <h3>All sessions</h3>
            <table className="cmp-table sess-table">
              <thead>
                <tr>
                  <th>Stream</th>
                  <th>When</th>
                  <th>Duration</th>
                  <th>Messages</th>
                  <th>Peak/min</th>
                  <th>Chatters</th>
                  <th>Sentiment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ended.map((s) => (
                  <tr key={s.id} className="sess-row">
                    <td>
                      <Link to={s.id} className="sess-link">
                        {s.streamerName}
                      </Link>{" "}
                      <span className={`spick-tag ${s.owned ? "" : "ext"}`}>{s.owned ? "MB" : "ext"}</span>
                    </td>
                    <td>{when(s.startedAt)}</td>
                    <td>{fmtDuration(s.durationMs)}</td>
                    <td>{s.messages.toLocaleString()}</td>
                    <td>{Math.round(s.peakPerMin).toLocaleString()}</td>
                    <td>{s.chatters.toLocaleString()}</td>
                    <td className={`sent-${sentCls(s.net)}`}>{sentText(s.net)}</td>
                    <td>
                      <Link to={s.id} className="sess-open">
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
