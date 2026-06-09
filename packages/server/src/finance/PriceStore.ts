import type { PriceTick } from "@app/shared";
import type { SideBus } from "../bus/SideBus.js";

/** Holds latest prices + per-symbol baseline (for "% since stream start").
 * Debounced broadcast to the side-band bus. */
export class PriceStore {
  private map = new Map<string, PriceTick>();
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sideBus: SideBus,
    /** preferred display order (the curated watch set) */
    private readonly order: string[],
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      if (this.dirty) {
        this.dirty = false;
        this.publishAll();
      }
    }, 1500);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  update(
    symbol: string,
    price: number,
    change24h: number | undefined,
    source: PriceTick["source"],
    name?: string,
    kind: PriceTick["kind"] = "crypto",
  ): void {
    if (!Number.isFinite(price)) return;
    const prev = this.map.get(symbol);
    const baseline = prev?.baseline ?? price;
    const startedAt = prev?.startedAt ?? Date.now();
    const changeSinceStart = baseline ? (price - baseline) / baseline : 0;
    this.map.set(symbol, {
      symbol,
      name: name ?? prev?.name,
      price,
      change24h: change24h ?? prev?.change24h,
      changeSinceStart,
      baseline,
      startedAt,
      source,
      kind: prev?.kind ?? kind,
    });
    this.dirty = true;
  }

  /** re-anchor "% since start" to current prices */
  resetBaseline(): void {
    const now = Date.now();
    for (const [s, t] of this.map) this.map.set(s, { ...t, baseline: t.price, startedAt: now, changeSinceStart: 0 });
    this.publishAll();
  }

  private publishAll(): void {
    const curated = this.order.map((s) => this.map.get(s)).filter(Boolean) as PriceTick[];
    const extras = [...this.map.values()].filter((t) => !this.order.includes(t.symbol));
    this.sideBus.publish({ type: "ticker", prices: [...curated, ...extras] });
  }
}
