import { memo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ActivityBucket, SentimentPoint } from "@app/shared";
import type { BinDetail, Driver } from "../lib/perfLab";

// theme literals (recharts fills resolve cleaner with hex than CSS vars)
const C = { twitch: "#9146ff", kick: "#53fc18", x: "#eceae4", mb: "#c49a40", danger: "#d14b40", muted: "#978c7f" };
const GRID = "rgba(236,232,220,0.05)";
const AXIS = "rgba(236,232,220,0.12)";
const PLAT_NAME: Record<string, string> = { twitch: "Twitch", kick: "Kick", x: "X", mb: "MB" };

const fmtClock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const axisTick = { fontSize: 11, fill: C.muted };

function ActivityTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0);
  return (
    <div className="chart-tip">
      <div className="chart-tip-h">
        {fmtClock(label)} · {total} msgs
      </div>
      {payload
        .filter((p: any) => p.value > 0)
        .map((p: any) => (
          <div className="chart-tip-row" key={p.dataKey}>
            <span className="chart-tip-dot" style={{ background: p.color }} />
            {PLAT_NAME[p.dataKey] ?? p.dataKey}
            <b>{p.value}</b>
          </div>
        ))}
    </div>
  );
}

/** Per-platform stacked activity timeline (Recharts) with a peak marker.
 * memo'd so frequent parent re-renders (WS churn) don't churn the chart —
 * it only re-renders when the data reference actually changes (each poll). */
export const StackedBars = memo(function StackedBars({
  buckets,
  peakAt,
  spikes,
}: {
  buckets: ActivityBucket[];
  peakAt: number;
  /** bucket start times to flag as reaction spikes */
  spikes?: number[];
}) {
  const hasPeak = buckets.some((b) => b.t === peakAt && b.total > 0);
  const bucketTs = new Set(buckets.map((b) => b.t));
  const spikeTs = (spikes ?? []).filter((t) => bucketTs.has(t) && t !== peakAt).slice(0, 16);
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={buckets} margin={{ top: 14, right: 6, left: 0, bottom: 0 }} barCategoryGap={1}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tickFormatter={fmtClock} tick={axisTick} stroke={AXIS} minTickGap={44} tickLine={false} />
        <YAxis tick={axisTick} stroke={AXIS} allowDecimals={false} width={34} tickLine={false} />
        <Tooltip content={<ActivityTip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} isAnimationActive={false} />
        <Bar dataKey="twitch" stackId="a" fill={C.twitch} isAnimationActive={false} />
        <Bar dataKey="kick" stackId="a" fill={C.kick} isAnimationActive={false} />
        <Bar dataKey="x" stackId="a" fill={C.x} isAnimationActive={false} />
        <Bar dataKey="mb" stackId="a" fill={C.mb} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        {spikeTs.map((t) => (
          <ReferenceLine key={t} x={t} stroke={C.danger} strokeDasharray="2 4" strokeOpacity={0.65} />
        ))}
        {hasPeak && (
          <ReferenceLine
            x={peakAt}
            stroke={C.mb}
            strokeDasharray="3 3"
            label={{ value: "peak", fill: C.mb, fontSize: 10, position: "top" }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
});

/** One streamer's value for the comparison chart. */
export interface CmpRow {
  id: string;
  name: string;
  value: number;
  /** true for the Market Bubble row */
  ours: boolean;
}

function CmpTip({ active, payload, metricLabel, fmt, ourValue }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as CmpRow;
  const pct = ourValue > 0 ? Math.round((r.value / ourValue) * 100) : null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-h">
        {r.name}
        {r.ours ? " · us" : ""}
      </div>
      <div className="chart-tip-row">
        {metricLabel}
        <b>{fmt(r.value)}</b>
      </div>
      {!r.ours && pct != null && <div className="chart-tip-row chart-tip-sub">{pct}% of Market Bubble</div>}
    </div>
  );
}

/** Horizontal leaderboard of one normalized metric across streamers. Market Bubble
 * is gold; others are green when they beat us and muted when they trail. A dashed
 * "us" line marks Market Bubble's level so standing reads at a glance. */
export const ComparisonBars = memo(function ComparisonBars({
  rows,
  ourValue,
  metricLabel,
  fmt,
}: {
  /** every streamer (incl. Market Bubble), already sorted */
  rows: CmpRow[];
  /** Market Bubble's value for this metric (reference line + color threshold) */
  ourValue: number;
  metricLabel: string;
  fmt: (v: number) => string;
}) {
  const height = Math.max(150, rows.length * 38 + 28);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={rows} margin={{ top: 6, right: 64, left: 6, bottom: 6 }} barCategoryGap={9}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={axisTick} stroke={AXIS} tickLine={false} tickFormatter={fmt} />
        <YAxis type="category" dataKey="name" tick={axisTick} stroke={AXIS} width={118} tickLine={false} interval={0} />
        <Tooltip
          content={<CmpTip metricLabel={metricLabel} fmt={fmt} ourValue={ourValue} />}
          cursor={{ fill: "rgba(255,255,255,0.05)" }}
          isAnimationActive={false}
        />
        {ourValue > 0 && (
          <ReferenceLine
            x={ourValue}
            stroke={C.mb}
            strokeDasharray="3 3"
            label={{ value: "us", fill: C.mb, fontSize: 10, position: "top" }}
          />
        )}
        <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.id} fill={r.ours ? C.mb : r.value >= ourValue ? C.kick : C.muted} />
          ))}
          <LabelList dataKey="value" position="right" formatter={(v: any) => fmt(Number(v))} fill={C.muted} fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

function SentTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as SentimentPoint;
  const lab = p.net > 0.15 ? "Bullish" : p.net < -0.15 ? "Bearish" : "Flat";
  return (
    <div className="chart-tip">
      <div className="chart-tip-h">{fmtClock(label)}</div>
      <div className="chart-tip-row">
        {lab}
        <b>
          {p.net >= 0 ? "+" : ""}
          {(p.net * 100).toFixed(0)}
        </b>
      </div>
      <div className="chart-tip-row chart-tip-sub">
        {p.bullish}↑ / {p.bearish}↓
      </div>
    </div>
  );
}

function driverLine(label: string, items: Driver[], prefix = "") {
  if (!items?.length) return null;
  return (
    <div className="chart-tip-row chart-tip-sub">
      {label}: {items.slice(0, 4).map((d) => `${prefix}${d.label}`).join(", ")}
    </div>
  );
}

function ReactionTip({ active, payload, label, source, sessionDrivers }: any) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload as BinDetail;
  const sentLab = b.net > 0.15 ? "Bullish" : b.net < -0.15 ? "Bearish" : "Flat";
  const sess = source === "session";
  const cashtags = sess ? sessionDrivers?.cashtags ?? [] : b.cashtags;
  return (
    <div className="chart-tip pl-tip">
      <div className="chart-tip-h">
        {fmtClock(label)} · {b.rate}/min{b.lift >= 1.5 ? ` · ×${b.lift}` : ""}
      </div>
      <div className="chart-tip-row">
        {sentLab}
        <b>
          {b.net >= 0 ? "+" : ""}
          {Math.round(b.net * 100)}
        </b>
        {(b.bull > 0 || b.bear > 0) && <span className="chart-tip-sub" style={{ marginLeft: "auto" }}>{b.bull}↑ / {b.bear}↓</span>}
      </div>
      {driverLine("cashtags", cashtags, "$")}
      {b.said ? (
        <div className="pl-tip-said">🎙 “{b.said}”</div>
      ) : (
        <div className="pl-tip-said pl-tip-said-empty">no transcript captured at this moment</div>
      )}
    </div>
  );
}

/** Interactive energy chart: activity bars (reaction moments hot) + a sentiment
 * line on a right axis, with a rich hover tooltip (rate/lift, sentiment, drivers,
 * and the spoken transcript at that moment). Drives both Live and Session replay. */
export const ReactionChart = memo(function ReactionChart({
  bins,
  baseline,
  binMs,
  momentSpans,
  source,
  sessionDrivers,
  onActiveBin,
}: {
  bins: BinDetail[];
  baseline: number;
  binMs: number;
  momentSpans: { startT: number; endT: number }[];
  source: "live" | "session";
  sessionDrivers?: { emotes: Driver[]; cashtags: Driver[]; chatters: Driver[] };
  onActiveBin?: (t: number | null) => void;
}) {
  if (bins.length < 2) return <div className="cc-empty-sm">Not enough chat in this window to chart.</div>;
  const baseCount = (baseline * binMs) / 60000;
  const hot = new Set<number>();
  for (const m of momentSpans) for (const b of bins) if (b.t >= m.startT && b.t < m.endT) hot.add(b.t);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart
        data={bins}
        margin={{ top: 14, right: 8, left: 0, bottom: 0 }}
        barCategoryGap={1}
        onMouseMove={(st: any) => onActiveBin?.(st?.activeLabel != null ? Number(st.activeLabel) : null)}
        onMouseLeave={() => onActiveBin?.(null)}
      >
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tickFormatter={fmtClock} tick={axisTick} stroke={AXIS} minTickGap={44} tickLine={false} />
        <YAxis yAxisId="act" tick={axisTick} stroke={AXIS} allowDecimals={false} width={34} tickLine={false} />
        <YAxis
          yAxisId="sent"
          orientation="right"
          domain={[-1, 1]}
          ticks={[-1, 0, 1]}
          tickFormatter={(v: number) => (v > 0 ? "Bull" : v < 0 ? "Bear" : "0")}
          tick={axisTick}
          stroke={AXIS}
          width={40}
          tickLine={false}
        />
        <Tooltip
          content={<ReactionTip source={source} sessionDrivers={sessionDrivers} />}
          cursor={{ fill: "rgba(255,255,255,0.05)" }}
          isAnimationActive={false}
        />
        {baseCount > 0 && <ReferenceLine yAxisId="act" y={baseCount} stroke={C.muted} strokeDasharray="2 4" strokeOpacity={0.5} />}
        <ReferenceLine yAxisId="sent" y={0} stroke="rgba(255,255,255,0.14)" />
        <Bar yAxisId="act" dataKey="n" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {bins.map((b) => (
            <Cell key={b.t} fill={hot.has(b.t) ? C.danger : C.mb} />
          ))}
        </Bar>
        <Line yAxisId="sent" type="monotone" dataKey="net" stroke={C.x} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

export interface SessionVol {
  id: string;
  label: string;
  messages: number;
  name: string;
  owned: boolean;
  whenLabel: string;
  dur: string;
}

function SessionVolTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload as SessionVol;
  return (
    <div className="chart-tip">
      <div className="chart-tip-h">
        {s.name}
        {s.owned ? " · MB" : " · ext"}
      </div>
      <div className="chart-tip-row">
        Messages<b>{s.messages.toLocaleString()}</b>
      </div>
      <div className="chart-tip-row chart-tip-sub">
        {s.whenLabel} · {s.dur}
      </div>
    </div>
  );
}

/** One bar per recorded session (oldest→newest), labeled + clickable — so "volume
 * per show" reads clearly instead of an anonymous mystery series. MB shows are gold,
 * external grey. */
export const SessionVolumeBars = memo(function SessionVolumeBars({
  data,
  onSelect,
}: {
  data: SessionVol[];
  onSelect: (id: string) => void;
}) {
  if (data.length === 0) return <div className="cc-empty-sm">No recorded sessions yet.</div>;
  const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} barCategoryGap={data.length > 16 ? 2 : 6}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} stroke={AXIS} tickLine={false} interval="preserveStartEnd" minTickGap={26} />
        <YAxis tick={axisTick} stroke={AXIS} width={40} tickLine={false} tickFormatter={fmtK} allowDecimals={false} />
        <Tooltip content={<SessionVolTip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} isAnimationActive={false} />
        <Bar dataKey="messages" radius={[3, 3, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={(d: any) => d?.id && onSelect(d.id)}>
          {data.map((s) => (
            <Cell key={s.id} fill={s.owned ? C.mb : C.muted} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

/** Sentiment-over-time area chart (Recharts), colored by the latest reading. */
export const TrendLine = memo(function TrendLine({ points }: { points: SentimentPoint[] }) {
  if (points.length < 2)
    return <div className="trend empty cc-empty-sm">Collecting sentiment… (needs a minute of live chat)</div>;
  const up = points[points.length - 1]!.net >= 0;
  const color = up ? C.kick : C.danger;
  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={points} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="sentFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tickFormatter={fmtClock} tick={axisTick} stroke={AXIS} minTickGap={50} tickLine={false} />
        <YAxis
          domain={[-1, 1]}
          ticks={[-1, 0, 1]}
          tickFormatter={(v: number) => (v > 0 ? "Bull" : v < 0 ? "Bear" : "0")}
          tick={axisTick}
          stroke={AXIS}
          width={34}
          tickLine={false}
        />
        <Tooltip content={<SentTip />} isAnimationActive={false} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
        <Area type="monotone" dataKey="net" stroke={color} strokeWidth={2} fill="url(#sentFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
});
