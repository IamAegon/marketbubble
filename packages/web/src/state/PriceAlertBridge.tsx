import { useEffect, useRef } from "react";
import { useDashboard } from "./DashboardProvider";
import { useToasts } from "./toasts";
import { popupAllowed } from "./useLayout";

const WINDOW_MS = 60 * 60_000; // last hour
const SAMPLE_MS = 12_000; // sample cadence
const COOLDOWN_MS = 10 * 60_000; // per-symbol alert cooldown
const MIN_SAMPLES = 12;
const MIN_MOVE = 0.0005; // 0.05% floor so ultra-stable assets don't spam on tiny moves

/** Samples live prices into a rolling 1-hour window and fires a throttled desktop
 * notification when an asset's current price is >= priceSigma standard deviations
 * from that hour's mean. Renders nothing. */
export function PriceAlertBridge() {
  const d = useDashboard();
  const { push } = useToasts();
  const pricesRef = useRef(d.prices);
  pricesRef.current = d.prices;
  // read live inside the interval tick so page-gating changes apply without a restart
  const notifyPagesRef = useRef(d.layout.notifyPages);
  notifyPagesRef.current = d.layout.notifyPages;
  const hist = useRef<Map<string, { t: number; p: number }[]>>(new Map());
  const cooldown = useRef<Map<string, number>>(new Map());

  const enabled = d.layout.priceAlerts;
  const sigma = d.layout.priceSigma;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const now = Date.now();
      const prices = pricesRef.current;
      for (const sym of Object.keys(prices)) {
        const p = prices[sym]?.price;
        if (!p || !Number.isFinite(p)) continue;
        const arr = hist.current.get(sym) ?? [];
        arr.push({ t: now, p });
        const cutoff = now - WINDOW_MS;
        while (arr.length && arr[0]!.t < cutoff) arr.shift();
        hist.current.set(sym, arr);
        if (arr.length < MIN_SAMPLES) continue;

        const ps = arr.map((x) => x.p);
        const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
        const variance = ps.reduce((a, b) => a + (b - mean) ** 2, 0) / ps.length;
        const std = Math.sqrt(variance);
        if (std <= 0 || mean <= 0) continue;
        const z = (p - mean) / std;
        if (Math.abs(z) < sigma) continue;
        if (Math.abs(p - mean) / mean < MIN_MOVE) continue;
        if (now - (cooldown.current.get(sym) ?? 0) < COOLDOWN_MS) continue;

        cooldown.current.set(sym, now);
        const dir = z > 0 ? "▲" : "▼";
        const title = `${dir} ${sym} ${z >= 0 ? "+" : ""}${z.toFixed(1)}σ`;
        const body = `${prices[sym]?.name ?? sym} is ${Math.abs(z).toFixed(1)}σ ${z > 0 ? "above" : "below"} the last hour's average`;
        const allowed = popupAllowed(notifyPagesRef.current, "price");
        push({ title, body, kind: z > 0 ? "price-up" : "price-down" }, !allowed);
        if (allowed && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(title, { body, tag: `mb-price-${sym}` });
          } catch {
            /* ignore */
          }
        }
      }
    };
    const id = window.setInterval(tick, SAMPLE_MS);
    return () => clearInterval(id);
  }, [enabled, sigma]);

  return null;
}
