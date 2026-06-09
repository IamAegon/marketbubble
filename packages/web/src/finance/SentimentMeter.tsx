import type { SentimentGauge } from "@app/shared";

export function SentimentMeter({ g }: { g: SentimentGauge }) {
  // only surface a clear bull/bear read — no "Neutral" noise
  if (g.net >= -0.15 && g.net <= 0.15) return null;
  const pct = Math.round(((g.net + 1) / 2) * 100);
  const bull = g.net > 0;
  return (
    <div className="cc-sent" title={`Chat sentiment · ${g.bullish}↑ / ${g.bearish}↓ in ${Math.round(g.windowMs / 1000)}s`}>
      <span className="cc-sent-label">{bull ? "Bullish" : "Bearish"}</span>
      <div className="cc-sent-bar">
        <div className="cc-sent-fill" style={{ width: `${pct}%`, background: bull ? "var(--kick)" : "var(--danger)" }} />
      </div>
    </div>
  );
}
