import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PriceLevels, PriceTick } from "@app/shared";
import { useDashboard } from "../state/DashboardProvider";
import { useAuth } from "../state/useAuth";
import { useMarketHistory } from "../lib/marketHistory";
import { fetchMarketBrief } from "../lib/report";
import { ReportModal } from "../analytics/ReportModal";
import { PerformanceCompare } from "../finance/PerformanceCompare";
import { MarketMood } from "../finance/MarketMood";
import { Sparkline } from "../finance/Sparkline";
import { fmtPrice as fmt, pricePrefix } from "../finance/format";

const C = { muted: "#978c7f", grid: "rgba(236,232,220,0.05)", axis: "rgba(236,232,220,0.12)", up: "#34a56a", down: "#d14b40" };
const TF: { id: string; days: number; label: string }[] = [
  { id: "1M", days: 31, label: "1M" },
  { id: "3M", days: 92, label: "3M" },
  { id: "1Y", days: 370, label: "1Y" },
];
// category accent colors for Polymarket cards
const CAT_COLOR: Record<string, string> = {
  Crypto: "#53fc18",
  AI: "#7dd3fc",
  Finance: "#fcd34d",
  Tech: "#b18cff",
  Politics: "#ff8ad1",
  Economy: "#ffd24a",
  Sports: "#5ad1ff",
  Culture: "#ff8ad1",
};
const catColor = (c?: string) => (c && CAT_COLOR[c]) || "#c49a40";
const tint = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const CRYPTO_ORDER = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "AVAX", "LINK", "SUI", "HYPE"];
const MACRO_ORDER = ["SPX", "NASDAQ", "NDX", "DOW", "DXY", "US10Y", "GOLD", "SILVER", "COPPER", "WTI", "VIX"];

const pct = (open: number, live: number) => (open ? (live - open) / open : 0);
const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
const cls = (v: number) => (v >= 0 ? "up" : "down");
const fmtDay = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

interface Chg {
  d: number;
  w: number;
  m: number;
  y: number;
}
const changesOf = (lv: PriceLevels, live: number): Chg => ({
  d: pct(lv.dailyOpen, live),
  w: pct(lv.weekOpen, live),
  m: pct(lv.monthOpen, live),
  y: pct(lv.yearOpen, live),
});

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-h">{new Date(label).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}</div>
      <div className="chart-tip-row">
        <b>{Number(payload[0].value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>
      </div>
    </div>
  );
}

export function MarketsView() {
  const d = useDashboard();
  const { user } = useAuth();
  const hist = useMarketHistory();
  const prices = d.prices;
  const [sel, setSel] = useState("BTC");
  const [tf, setTf] = useState("3M");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [showBrief, setShowBrief] = useState(false);
  const isMod = user?.role === "mod" || user?.role === "admin";

  const briefAssets = Object.values(prices).map((t) => ({
    symbol: t.symbol,
    name: t.name,
    kind: t.kind,
    price: t.price,
    dailyOpen: hist[t.symbol]?.dailyOpen,
    weekOpen: hist[t.symbol]?.weekOpen,
    monthOpen: hist[t.symbol]?.monthOpen,
    yearOpen: hist[t.symbol]?.yearOpen,
  }));
  const briefMarkets = d.markets.map((m) => ({ question: m.question, yes: m.yes, category: m.category }));

  const liveOf = (sym: string): number => prices[sym]?.price ?? hist[sym]?.series.at(-1)?.c ?? 0;

  const selLevel = hist[sel];
  const selLive = liveOf(sel);
  const selTick = prices[sel];
  const selChg = selLevel ? changesOf(selLevel, selLive) : null;

  // chart data for the selected timeframe + live tail point
  const days = TF.find((t) => t.id === tf)!.days;
  const base = (selLevel?.series ?? []).slice(-days).map((p) => ({ t: p.t, c: p.c }));
  const chartData = selLive && base.length ? [...base, { t: Date.now(), c: selLive }] : base;
  const ys = chartData.map((p) => p.c);
  const lo = ys.length ? Math.min(...ys) : 0;
  const hi = ys.length ? Math.max(...ys) : 1;
  const pad = (hi - lo) * 0.06 || hi * 0.02;
  const up = chartData.length > 1 ? chartData[chartData.length - 1]!.c >= chartData[0]!.c : true;
  const levelLines = selLevel
    ? ([
        { y: selLevel.dailyOpen, label: "D" },
        { y: selLevel.weekOpen, label: "W" },
        { y: selLevel.monthOpen, label: "M" },
        { y: selLevel.yearOpen, label: "Y" },
      ] as const).filter((l) => l.y >= lo && l.y <= hi)
    : [];
  const range52 = selLevel && selLevel.yearHigh && selLevel.yearLow && selLevel.yearHigh > selLevel.yearLow
    ? Math.max(0, Math.min(1, (selLive - selLevel.yearLow) / (selLevel.yearHigh - selLevel.yearLow)))
    : null;

  const chip = (label: string, v: number) => (
    <div className={`mchip ${cls(v)}`} key={label}>
      <span className="mchip-l">{label}</span>
      <span className="mchip-v">{fmtPct(v)}</span>
    </div>
  );

  const row = (sym: string) => {
    const t = prices[sym];
    const lv = hist[sym];
    const live = liveOf(sym);
    const c = lv ? changesOf(lv, live) : null;
    const spark = (lv?.series ?? []).slice(-60).map((p) => p.c);
    return (
      <tr key={sym} className={sel === sym ? "sel" : ""} onClick={() => setSel(sym)}>
        <td className="mkt-tsym">
          {sym} <span className="mkt-tname">{t?.name ?? lv?.symbol ?? ""}</span>
        </td>
        <td className="mkt-tpx">
          {pricePrefix(t ?? ({ symbol: sym } as PriceTick))}
          {fmt(live)}
        </td>
        <td className={c ? cls(c.d) : ""}>{c ? fmtPct(c.d) : "—"}</td>
        <td className={c ? cls(c.w) : ""}>{c ? fmtPct(c.w) : "—"}</td>
        <td className={c ? cls(c.m) : ""}>{c ? fmtPct(c.m) : "—"}</td>
        <td className={c ? cls(c.y) : ""}>{c ? fmtPct(c.y) : "—"}</td>
        <td className="mkt-spark">{spark.length > 1 ? <Sparkline data={spark} up={(c?.m ?? 0) >= 0} /> : null}</td>
      </tr>
    );
  };

  const table = (title: string, syms: string[]) => {
    const present = syms.filter((s) => prices[s] || hist[s]);
    if (present.length === 0) return null;
    return (
      <section className="acard">
        <h3>{title}</h3>
        <table className="mkt-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Price</th>
              <th>1D</th>
              <th>1W</th>
              <th>1M</th>
              <th>YTD</th>
              <th>90d</th>
            </tr>
          </thead>
          <tbody>{present.map(row)}</tbody>
        </table>
      </section>
    );
  };

  // category chips, ordered by how many active markets each has
  const catCounts = new Map<string, number>();
  for (const m of d.markets) catCounts.set(m.category ?? "Other", (catCounts.get(m.category ?? "Other") ?? 0) + 1);
  const cats = ["All", ...[...catCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)];
  const markets = d.markets
    .filter((m) => cat === "All" || (m.category ?? "Other") === cat)
    .filter((m) => m.question.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mview">
      <MarketMood />
      {showBrief && (
        <ReportModal
          fetcher={() => fetchMarketBrief(briefAssets, briefMarkets)}
          filename="marketbubble-brief.pdf"
          title="Market Brief"
          onClose={() => setShowBrief(false)}
        />
      )}

      {/* selected-asset detail: price, since-open changes, 52w range, chart w/ levels */}
      <section className="acard mkt-detail">
        <div className="mkt-detail-head">
          <div className="mkt-id">
            <div className="mkt-sym">{sel}</div>
            <div className="mkt-name">{selTick?.name ?? selLevel?.symbol ?? ""}</div>
            <div className="mkt-price">
              {pricePrefix(selTick ?? ({ symbol: sel } as PriceTick))}
              {fmt(selLive)}
            </div>
          </div>
          {selChg && (
            <div className="mkt-chips">
              {chip("1D", selChg.d)}
              {chip("1W", selChg.w)}
              {chip("1M", selChg.m)}
              {chip("YTD", selChg.y)}
            </div>
          )}
          <div className="range-toggle mkt-tf">
            {TF.map((t) => (
              <button key={t.id} className={tf === t.id ? "active" : ""} onClick={() => setTf(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {isMod && (
            <button
              className="cc-chip mkt-brief-btn"
              onClick={() => setShowBrief(true)}
              title="Generate a PDF market brief for stream"
            >
              ⤓ Brief PDF
            </button>
          )}
        </div>

        {range52 != null && selLevel && (
          <div className="m52">
            <span className="m52-end">{fmt(selLevel.yearLow!)}</span>
            <div className="m52-bar">
              <div className="m52-mark" style={{ left: `${range52 * 100}%` }} />
            </div>
            <span className="m52-end">{fmt(selLevel.yearHigh!)}</span>
            <span className="m52-cap">52-week range</span>
          </div>
        )}

        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ top: 10, right: 52, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="mfill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={up ? C.up : C.down} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={up ? C.up : C.down} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="t" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: C.muted }} stroke={C.axis} minTickGap={64} tickLine={false} />
              <YAxis
                domain={[lo - pad, hi + pad]}
                allowDataOverflow
                orientation="right"
                width={66}
                tick={{ fontSize: 11, fill: C.muted }}
                stroke={C.axis}
                tickLine={false}
                tickFormatter={(v: number) => fmt(v)}
              />
              <Tooltip content={<ChartTip />} isAnimationActive={false} />
              {levelLines.map((l) => (
                <ReferenceLine
                  key={l.label}
                  y={l.y}
                  stroke="rgba(255,255,255,0.28)"
                  strokeDasharray="4 3"
                  label={{ value: l.label, position: "right", fill: C.muted, fontSize: 10 }}
                />
              ))}
              <Area type="monotone" dataKey="c" stroke={up ? C.up : C.down} strokeWidth={2} fill="url(#mfill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="cc-empty-sm" style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
            Loading {sel} history…
          </div>
        )}
        <div className="mkt-levels-legend">
          D · W · M · Y = open of today / this week / this month / this year. Lines show where {sel} sits vs each level.
        </div>
      </section>

      <PerformanceCompare levels={hist} />

      <div className="mkt-lists">
        {table("Crypto", CRYPTO_ORDER)}
        {table("Macro", MACRO_ORDER)}
      </div>

      <section className="mview-markets">
        <div className="mview-h">
          <h3>Prediction markets — Polymarket</h3>
          <input className="cc-search" placeholder="Search markets…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="pm-cats">
          {cats.map((c) => (
            <button key={c} className={`cc-chip ${cat === c ? "active" : ""}`} onClick={() => setCat(c)}>
              {c}
              {c !== "All" && <span className="pm-cat-n">{catCounts.get(c)}</span>}
            </button>
          ))}
        </div>
        {markets.length === 0 ? (
          <div className="cc-empty-sm">{d.markets.length ? "No markets in this category." : "Loading live Polymarket odds…"}</div>
        ) : (
          <div className="cc-markets big">
            {markets.map((m) => {
              const yes = Math.round(m.yes * 100);
              const vol = m.volume ?? 0;
              const volLabel = vol >= 1e6 ? `$${(vol / 1e6).toFixed(1)}M` : `$${Math.round(vol / 1000)}k`;
              const col = catColor(m.category);
              return (
                <a
                  className="cc-mkt"
                  key={m.id}
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: `linear-gradient(135deg, ${tint(col, 0.1)}, transparent 62%)` }}
                >
                  {m.category && <span className="pm-ghost" style={{ color: tint(col, 0.06) }}>{m.category}</span>}
                  <div className="cc-mkt-top">
                    {m.category && (
                      <span className="pm-tag" style={{ color: col, borderColor: tint(col, 0.5), background: tint(col, 0.12) }}>
                        {m.category}
                      </span>
                    )}
                    <span className="pm-vol">{volLabel} 24h</span>
                  </div>
                  <div className="cc-mkt-q">{m.question}</div>
                  <div className="cc-mkt-bar">
                    <div className="cc-mkt-yes" style={{ width: `${yes}%`, background: col }} />
                  </div>
                  <div className="cc-mkt-odds">
                    <span className="yes" style={{ color: col }}>
                      YES {yes}%
                    </span>
                    <span className="no">NO {100 - yes}%</span>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
