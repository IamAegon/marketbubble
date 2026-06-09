import { useState } from "react";
import type { RollupSummary, StatsRange, StreamerSummary } from "@app/shared";
import { useStats } from "../lib/stats";
import { fetchReport } from "../lib/report";
import { ReportModal } from "../analytics/ReportModal";
import { ComparisonBars, type CmpRow } from "../analytics/charts";

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const sentText = (net: number) => (net > 0.15 ? "Bullish" : net < -0.15 ? "Bearish" : "Flat");
const sentCls = (net: number) => (net > 0.15 ? "bull" : net < -0.15 ? "bear" : "flat");

type MetricKey = "msgsPerMin" | "msgsPerChatter" | "peakPerMin";
interface Norm {
  id: string;
  name: string;
  msgsPerMin: number;
  msgsPerChatter: number;
  peakPerMin: number;
  net: number;
}
const METRICS: { key: MetricKey; label: string; fmt: (v: number) => string }[] = [
  { key: "msgsPerMin", label: "msgs / min", fmt: (v) => v.toFixed(1) },
  { key: "msgsPerChatter", label: "msgs / chatter", fmt: (v) => v.toFixed(1) },
  { key: "peakPerMin", label: "peak / min", fmt: (v) => compact(v) },
];

function normalize(s: Pick<StreamerSummary | RollupSummary, "total" | "chatters" | "perMin" | "peakPerMin" | "net">, id: string, name: string): Norm {
  return {
    id,
    name,
    msgsPerMin: s.perMin,
    msgsPerChatter: s.chatters ? s.total / s.chatters : 0,
    peakPerMin: s.peakPerMin,
    net: s.net,
  };
}

/** "For others": benchmark Market Bubble against external streamers on NORMALIZED
 * rates (per-minute, per-chatter) from recorded chat — not raw totals — so streams
 * with different audience sizes compare fairly. This is the only place comparison lives. */
export function ComparisonView() {
  // Comparison metrics are window-independent (live rate + session totals/peak), so a
  // range toggle moved nothing on screen — pin to the full session.
  const range: StatsRange = "session";
  const [metric, setMetric] = useState<MetricKey>("msgsPerMin");
  const [showReport, setShowReport] = useState(false);
  const { data, loading, error } = useStats(range, "all");

  const ours = data ? normalize(data.comparison.owned, "__ours", "Market Bubble") : null;
  const others = (data?.streamers ?? [])
    .filter((s) => !s.owned)
    .map((s) => normalize(s, s.id, s.name))
    .sort((a, b) => b.msgsPerMin - a.msgsPerMin);

  const indexVsOurs = (theirs: number, ourVal: number): string => (ourVal > 0 ? `${Math.round((theirs / ourVal) * 100)}%` : "—");

  // a ranked leaderboard for the selected metric (Market Bubble included) → bar chart
  const activeMetric = METRICS.find((m) => m.key === metric)!;
  const chartRows: CmpRow[] = ours
    ? [
        { id: ours.id, name: ours.name, value: ours[metric], ours: true },
        ...others.map((o) => ({ id: o.id, name: o.name, value: o[metric], ours: false })),
      ].sort((a, b) => b.value - a.value)
    : [];

  return (
    <div className="aview">
      <div className="aview-top">
        <div className="aview-title">
          Compare
          <span className="aview-sub">Market Bubble vs other streamers · normalized rates</span>
        </div>
        <div className="aview-controls">
          <button className="cc-chip" onClick={() => setShowReport(true)} disabled={!data} title="Export this comparison as PDF">
            ⤓ Export PDF
          </button>
        </div>
      </div>

      {showReport && (
        <ReportModal
          fetcher={() => fetchReport(range, "all")}
          filename="marketbubble-comparison.pdf"
          title="Comparison report"
          onClose={() => setShowReport(false)}
        />
      )}

      <p className="cmp-note">
        We record other streamers too, then compare on <b>normalized rates</b> — per-minute and per-chatter, not raw
        totals — so a small stream and a huge one can be compared fairly. Figures reflect each stream's current session
        (<b>msgs/min</b> is the live rate; <b>per-chatter</b> &amp; <b>peak</b> are session-wide). The <b>%</b> is each
        streamer relative to Market Bubble.
      </p>

      {loading && !data && <div className="cc-empty-sm">Loading comparison…</div>}
      {error && !data && <div className="cc-empty-sm">Couldn’t reach the analytics service. Retrying…</div>}

      {data && ours && others.length > 0 && (
        <section className="acard">
          <div className="acard-h">
            <h3>Engagement at a glance</h3>
            <div className="range-toggle">
              {METRICS.map((m) => (
                <button key={m.key} className={metric === m.key ? "active" : ""} onClick={() => setMetric(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <ComparisonBars rows={chartRows} ourValue={ours[metric]} metricLabel={activeMetric.label} fmt={activeMetric.fmt} />
          <div className="cmp-legend">
            <span className="cmp-leg cmp-leg-ours">Market Bubble</span>
            <span className="cmp-leg cmp-leg-up">Beats us</span>
            <span className="cmp-leg cmp-leg-down">Below us</span>
          </div>
        </section>
      )}

      {data && ours && (
        <section className="acard">
          <div className="acard-h">
            <h3>Detailed breakdown</h3>
            <span className="cmp-sub">{others.length} external streamer{others.length !== 1 ? "s" : ""} · vs Market Bubble</span>
          </div>
          {others.length === 0 ? (
            <div className="cc-empty-sm">
              No external streamers recorded yet. Add a stream on the Live page (anything that isn’t Ansem/Faze counts
              as external) to benchmark against.
            </div>
          ) : (
            <table className="cmp-table">
              <thead>
                <tr>
                  <th>Streamer</th>
                  {METRICS.map((m) => (
                    <th key={m.key}>{m.label}</th>
                  ))}
                  <th>sentiment</th>
                </tr>
              </thead>
              <tbody>
                <tr className="cmp-ours">
                  <td>
                    Market Bubble <span className="spick-tag">ours</span>
                  </td>
                  {METRICS.map((m) => (
                    <td key={m.key}>{m.fmt(ours[m.key])}</td>
                  ))}
                  <td className={`sent-${sentCls(ours.net)}`}>{sentText(ours.net)}</td>
                </tr>
                {others.map((o) => (
                  <tr key={o.id}>
                    <td className="cmp-name">{o.name}</td>
                    {METRICS.map((m) => (
                      <td key={m.key}>
                        {m.fmt(o[m.key])}{" "}
                        <span className={`cmp-idx ${o[m.key] >= ours[m.key] ? "up" : "down"}`}>
                          {indexVsOurs(o[m.key], ours[m.key])}
                        </span>
                      </td>
                    ))}
                    <td className={`sent-${sentCls(o.net)}`}>{sentText(o.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
