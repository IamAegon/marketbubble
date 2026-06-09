import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { PriceLevels } from "@app/shared";

/** distinct color per asset */
const COLORS: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#627eea",
  SOL: "#14c38e",
  HYPE: "#00b8d9",
  SPX: "#c0e218",
  NASDAQ: "#4dabf7",
  NDX: "#9775fa",
  DOW: "#fa5252",
  DXY: "#868e96",
  US10Y: "#fab005",
  GOLD: "#ffa94d",
  SILVER: "#ced4da",
  COPPER: "#e8590c",
  WTI: "#38d9a9",
  VIX: "#f06595",
};
const CRYPTO = ["BTC", "ETH", "SOL", "HYPE"];
const MACRO = ["SPX", "NASDAQ", "NDX", "DOW", "DXY", "US10Y", "GOLD", "SILVER", "COPPER", "WTI", "VIX"];
const TF: { id: string; days: number }[] = [
  { id: "1M", days: 31 },
  { id: "3M", days: 92 },
  { id: "1Y", days: 370 },
];
// %-anchored gridlines (mapped to index = 100*(1+p/100)) so the log axis still reads in %
const PCT_ANCHORS = [-90, -75, -50, -30, -15, 0, 25, 50, 100, 200, 400, 900];

const fmtDay = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const idxToPct = (v: number) => `${v - 100 >= 0 ? "+" : ""}${(v - 100).toFixed(0)}%`;

/** Spaghetti chart: every asset rebased to an index of 100 at the start of the
 * window, overlaid so relative performance is directly comparable. Log scale lets
 * a +100% mover and the flat cluster both stay readable. Click the legend to toggle. */
export function PerformanceCompare({ levels }: { levels: Record<string, PriceLevels> }) {
  const all = [...CRYPTO, ...MACRO].filter((s) => levels[s]);
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set([...CRYPTO, "SPX", "NDX", "GOLD", "DXY", "VIX"]));
  const [tf, setTf] = useState("3M");
  const [logScale, setLogScale] = useState(false);
  const [hover, setHover] = useState<Record<string, number> | null>(null);
  const days = TF.find((t) => t.id === tf)!.days;

  const active = all.filter((s) => enabled.has(s));

  // merge active series onto a common timeline (forward-filled) + rebase to an index of 100
  const { data, lastPct, lo, hi } = useMemo(() => {
    const sliced: Record<string, { t: number; c: number }[]> = {};
    const union = new Set<number>();
    for (const s of active) {
      const ser = (levels[s]?.series ?? []).slice(-days);
      if (ser.length) {
        sliced[s] = ser;
        for (const p of ser) union.add(p.t);
      }
    }
    const ts = [...union].sort((a, b) => a - b);
    const baseline: Record<string, number> = {};
    const ptr: Record<string, number> = {};
    const last: Record<string, number | undefined> = {};
    for (const s of active) {
      baseline[s] = sliced[s]?.[0]?.c ?? 0;
      ptr[s] = 0;
    }
    let lo = Infinity;
    let hi = -Infinity;
    const rows = ts.map((t) => {
      const row: Record<string, number> = { t };
      for (const s of active) {
        const ser = sliced[s];
        if (!ser) continue;
        while (ptr[s]! < ser.length && ser[ptr[s]!]!.t <= t) last[s] = ser[ptr[s]!++]!.c;
        if (last[s] != null && baseline[s]) {
          const idx = (last[s]! / baseline[s]!) * 100;
          row[s] = idx;
          if (idx < lo) lo = idx;
          if (idx > hi) hi = idx;
        }
      }
      return row;
    });
    const lastRow = rows[rows.length - 1] ?? {};
    const lastPct: Record<string, number> = {};
    for (const s of active) lastPct[s] = (lastRow[s] ?? 100) - 100;
    return { data: rows, lastPct, lo: lo === Infinity ? 90 : lo, hi: hi === -Infinity ? 110 : hi };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels, days, enabled]);

  const logTicks = useMemo(
    () => PCT_ANCHORS.map((p) => 100 * (1 + p / 100)).filter((v) => v >= lo * 0.92 && v <= hi * 1.08),
    [lo, hi],
  );

  const toggle = (s: string) =>
    setEnabled((prev) => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  const setMany = (syms: string[]) => setEnabled(new Set(syms.filter((s) => levels[s])));

  const vals = hover ?? lastPct;

  const chip = (s: string) => {
    const on = enabled.has(s);
    const v = vals[s];
    return (
      <button key={s} className={`perf-chip ${on ? "on" : "off"}`} onClick={() => toggle(s)} title={`${s} · click to toggle`}>
        <span className="perf-dot" style={{ background: on ? COLORS[s] : "var(--surface-3)" }} />
        <span className="perf-sym">{s}</span>
        {on && v != null && <span className={`perf-val ${v >= 0 ? "up" : "down"}`}>{fmtPct(v)}</span>}
      </button>
    );
  };

  return (
    <section className="acard perf">
      <div className="acard-h">
        <div>
          <h3>Relative performance</h3>
          <div className="perf-sub">
            all assets rebased to 0% at the window start · {logScale ? "log scale (equal % moves = equal height)" : "linear %"}
          </div>
        </div>
        <div className="perf-head-ctl">
          <div className="range-toggle">
            <button className={!logScale ? "active" : ""} onClick={() => setLogScale(false)}>
              %
            </button>
            <button className={logScale ? "active" : ""} onClick={() => setLogScale(true)}>
              Log
            </button>
          </div>
          <div className="range-toggle">
            {TF.map((t) => (
              <button key={t.id} className={tf === t.id ? "active" : ""} onClick={() => setTf(t.id)}>
                {t.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="cc-empty-sm" style={{ height: 360 }}>
          Select assets below to chart their relative performance.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={360}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 54, left: 4, bottom: 0 }}
            onMouseMove={(st: any) => {
              if (st?.activePayload?.length) {
                const m: Record<string, number> = {};
                for (const p of st.activePayload) if (p.value != null) m[p.dataKey] = p.value - 100;
                setHover(m);
              }
            }}
            onMouseLeave={() => setHover(null)}
          >
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="t" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: "#978c7f" }} stroke="rgba(236,232,220,0.12)" minTickGap={64} tickLine={false} />
            <YAxis
              orientation="right"
              width={54}
              tick={{ fontSize: 11, fill: "#978c7f" }}
              stroke="rgba(236,232,220,0.12)"
              tickLine={false}
              scale={logScale ? "log" : "linear"}
              domain={logScale ? [lo * 0.96, hi * 1.04] : ["auto", "auto"]}
              ticks={logScale ? logTicks : undefined}
              allowDataOverflow={logScale}
              tickFormatter={idxToPct}
            />
            <ReferenceLine y={100} stroke="rgba(255,255,255,0.22)" />
            {active.map((s) => (
              <Line key={s} type="monotone" dataKey={s} stroke={COLORS[s]} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      <div className="perf-controls">
        <div className="perf-quick">
          <button className="cc-chip sm" onClick={() => setMany(all)}>All</button>
          <button className="cc-chip sm" onClick={() => setMany([])}>None</button>
          <button className="cc-chip sm" onClick={() => setMany(CRYPTO)}>Crypto</button>
          <button className="cc-chip sm" onClick={() => setMany(MACRO)}>Macro</button>
          {hover && <span className="perf-hint">values at cursor</span>}
        </div>
        <div className="perf-legend">
          <div className="perf-group">{CRYPTO.filter((s) => levels[s]).map(chip)}</div>
          <div className="perf-group">{MACRO.filter((s) => levels[s]).map(chip)}</div>
        </div>
      </div>
    </section>
  );
}
