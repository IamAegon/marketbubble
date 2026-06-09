import type { MarketOdds } from "@app/shared";

export function MarketsRail({ markets }: { markets: MarketOdds[] }) {
  if (!markets.length) return <div className="cc-empty-sm">Loading live Polymarket odds…</div>;
  return (
    <div className="cc-markets">
      {markets.map((m) => {
        const yes = Math.round(m.yes * 100);
        return (
          <a className="cc-mkt" key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" title={m.question}>
            <div className="cc-mkt-q">{m.question}</div>
            <div className="cc-mkt-bar">
              <div className="cc-mkt-yes" style={{ width: `${yes}%` }} />
            </div>
            <div className="cc-mkt-odds">
              <span className="yes">YES {yes}%</span>
              <span className="no">NO {100 - yes}%</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}
