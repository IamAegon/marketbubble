import type { PriceStore } from "./PriceStore.js";
import { logger } from "../observability/logger.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** display symbol -> { CNBC ticker, name } for the macro watch set */
const MACRO: Record<string, { c: string; name: string }> = {
  SPX: { c: ".SPX", name: "S&P 500" },
  NASDAQ: { c: ".IXIC", name: "Nasdaq Composite" },
  NDX: { c: ".NDX", name: "Nasdaq 100" },
  DOW: { c: ".DJI", name: "Dow Jones" },
  DXY: { c: ".DXY", name: "US Dollar Index" },
  US10Y: { c: "US10Y", name: "US 10Y Yield" },
  GOLD: { c: "@GC.1", name: "Gold" },
  SILVER: { c: "@SI.1", name: "Silver" },
  COPPER: { c: "@HG.1", name: "Copper" },
  WTI: { c: "@CL.1", name: "Crude Oil (WTI)" },
  VIX: { c: ".VIX", name: "Volatility (VIX)" },
};

/** parse CNBC's formatted numbers ("7,512.03", "4.536%", "-0.95%") to a float */
function num(s: unknown): number {
  return parseFloat(String(s ?? "").replace(/[,%+]/g, ""));
}

/**
 * Poll CNBC's public quote API for macro assets (indices, FX, metals, bonds,
 * vol) that the crypto feeds don't cover. One batched request per cycle, no key,
 * pipe-separated symbols. Best-effort: failures keep the last values.
 */
export function startMacro(store: PriceStore, signal: AbortSignal): void {
  const cnbcSyms = Object.values(MACRO).map((m) => m.c);
  const byCnbc = new Map(Object.entries(MACRO).map(([disp, m]) => [m.c, { disp, name: m.name }]));
  const url =
    `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(cnbcSyms.join("|"))}` +
    `&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  let timer: NodeJS.Timeout | null = null;

  const poll = async () => {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json" } });
      if (!r.ok) {
        logger.debug({ status: r.status }, "cnbc macro poll non-200");
        return;
      }
      const j = (await r.json()) as { FormattedQuoteResult?: { FormattedQuote?: any[] } };
      for (const q of j.FormattedQuoteResult?.FormattedQuote ?? []) {
        const meta = byCnbc.get(q.symbol);
        const price = num(q.last);
        if (!meta || !Number.isFinite(price)) continue;
        const chPct = num(q.change_pct);
        store.update(meta.disp, price, Number.isFinite(chPct) ? chPct / 100 : undefined, "cnbc", meta.name, "macro");
      }
    } catch (e) {
      logger.debug({ err: String(e) }, "cnbc macro poll failed");
    }
  };

  void poll();
  timer = setInterval(poll, 45_000);
  timer.unref?.();
  signal.addEventListener("abort", () => timer && clearInterval(timer), { once: true });
}

/** the macro display symbols, in ticker order */
export const MACRO_SYMBOLS = Object.keys(MACRO);
