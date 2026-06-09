import WebSocket from "ws";
import type { PriceStore } from "./PriceStore.js";
import { logger } from "../observability/logger.js";

// symbol -> Binance stream pair (no auth needed)
const PAIRS: Record<string, string> = {
  BTC: "btcusdt",
  SOL: "solusdt",
  ETH: "ethusdt",
  DOGE: "dogeusdt",
  XRP: "xrpusdt",
  BNB: "bnbusdt",
  AVAX: "avaxusdt",
  LINK: "linkusdt",
  SUI: "suiusdt",
};
const NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  SOL: "Solana",
  ETH: "Ethereum",
  DOGE: "Dogecoin",
  XRP: "XRP",
  BNB: "BNB",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  SUI: "Sui",
};

/** Live prices via Binance combined miniTicker stream, with auto-reconnect. */
export function startBinance(store: PriceStore, symbols: string[], signal: AbortSignal): void {
  const map = symbols.filter((s) => PAIRS[s]);
  if (!map.length) return;
  const streams = map.map((s) => `${PAIRS[s]}@miniTicker`).join("/");
  const byPair = new Map(map.map((s) => [PAIRS[s]!, s]));
  let ws: WebSocket | null = null;
  let backoff = 1000;
  let closed = false;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.on("open", () => {
      backoff = 1000;
      logger.info({ symbols: map }, "binance price feed connected");
    });
    ws.on("message", (d) => {
      try {
        const msg = JSON.parse(d.toString());
        const data = msg.data ?? msg;
        const sym = byPair.get(String(data.s).toLowerCase());
        if (!sym) return;
        const price = parseFloat(data.c);
        const openP = parseFloat(data.o);
        const ch = openP ? (price - openP) / openP : undefined;
        store.update(sym, price, ch, "binance", NAMES[sym]);
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => {
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    });
    ws.on("error", () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    });
  };

  open();
  signal.addEventListener(
    "abort",
    () => {
      closed = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
    { once: true },
  );
}
