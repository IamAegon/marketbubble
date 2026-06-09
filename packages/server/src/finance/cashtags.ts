import type { Cashtag } from "@app/shared";

// Known tickers we resolve (avoids $GG / $LOL false positives).
export const KNOWN_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "HYPE", "DOGE", "XRP", "BNB", "ADA", "AVAX", "LINK",
  "SUI", "PEPE", "WIF", "BONK", "TRUMP", "USDT", "USDC", "TIA", "APT", "ARB", "OP",
]);

const RE = /\$([A-Za-z]{2,6})\b/g;

/** Detect `$SYMBOL` cashtags in text → code-point spans. */
export function detectCashtags(text: string): Cashtag[] {
  const out: Cashtag[] = [];
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(text)) !== null) {
    const sym = m[1]!.toUpperCase();
    if (!KNOWN_SYMBOLS.has(sym)) continue;
    const start = Array.from(text.slice(0, m.index)).length;
    const end = start + Array.from(m[0]).length - 1;
    out.push({ symbol: sym, start, end });
  }
  return out;
}
