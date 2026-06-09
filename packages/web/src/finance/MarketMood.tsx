import { useMarketSentiment } from "../lib/useMarketSentiment";

const fngColor = (v: number) =>
  v <= 25 ? "#d14b40" : v <= 45 ? "#cf7a3a" : v <= 55 ? "#c8893a" : v <= 75 ? "#6fa05a" : "#34a56a";

function Gauge({ label, value, caption, hint }: { label: string; value: number; caption: string; hint: string }) {
  const c = fngColor(value);
  return (
    <div className="mood-card">
      <div className="mood-label">{label}</div>
      <div className="mood-row">
        <span className="mood-value" style={{ color: c }}>
          {value}
        </span>
        <span className="mood-class" style={{ color: c }}>
          {caption}
        </span>
      </div>
      <div className="mood-bar">
        <div className="mood-fill" style={{ width: `${value}%`, background: c }} />
        <div className="mood-mark" style={{ left: `${value}%` }} />
      </div>
      <div className="mood-hint">{hint}</div>
    </div>
  );
}

/** The three market-sentiment gauges shown on the Markets page header. */
export function MarketMood() {
  const s = useMarketSentiment();
  if (!s.cryptoFng && !s.stockFng && !s.aaii) return null;
  const aaiiTone =
    s.aaii && s.aaii.bullish - s.aaii.bearish > 5
      ? { t: "Bullish", c: "#53fc18" }
      : s.aaii && s.aaii.bearish - s.aaii.bullish > 5
        ? { t: "Bearish", c: "#ff5252" }
        : { t: "Mixed", c: "#fcd34d" };

  return (
    <div className="mkt-mood">
      {s.cryptoFng && (
        <Gauge
          label="Crypto Fear & Greed"
          value={s.cryptoFng.value}
          caption={s.cryptoFng.label}
          hint="Current sentiment only — no real predictive value; read it as a vibe check, not a signal."
        />
      )}
      {s.stockFng && (
        <Gauge
          label="Stocks Fear & Greed"
          value={s.stockFng.score}
          caption={s.stockFng.rating}
          hint="CNN composite — rough gauge, reliability unproven. Treat with caution."
        />
      )}
      {s.aaii && (
        <div className="mood-card" title="Contrarian signal — statistically extreme bearishness has marked bottoms (e.g. the tariff selloff).">
          <div className="mood-label">AAII Investor Sentiment</div>
          <div className="mood-row">
            <span className="mood-class" style={{ color: aaiiTone.c }}>
              {aaiiTone.t}
            </span>
            <span className="mood-aaii-date">{s.aaii.date}</span>
          </div>
          <div className="mood-aaii">
            <span className="aaii-seg bull" style={{ width: `${s.aaii.bullish}%` }} title={`Bullish ${s.aaii.bullish}%`} />
            <span className="aaii-seg neu" style={{ width: `${s.aaii.neutral}%` }} title={`Neutral ${s.aaii.neutral}%`} />
            <span className="aaii-seg bear" style={{ width: `${s.aaii.bearish}%` }} title={`Bearish ${s.aaii.bearish}%`} />
          </div>
          <div className="mood-aaii-legend">
            <span style={{ color: "var(--up)" }}>▲ {s.aaii.bullish}%</span>
            <span style={{ color: "var(--text-muted)" }}>● {s.aaii.neutral}%</span>
            <span style={{ color: "var(--down)" }}>▼ {s.aaii.bearish}%</span>
          </div>
          <div className="mood-hint">Contrarian — extreme bearishness has marked bottoms (worked in the tariff selloff).</div>
        </div>
      )}
    </div>
  );
}
