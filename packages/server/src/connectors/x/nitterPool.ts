const DEFAULTS =
  process.env.NITTER_INSTANCES?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ??
  [
    // verified serving real RSS (June 2026). The rest sit behind Cloudflare/anti-bot and
    // return a 403 challenge page, so they only waste failover attempts and pollute the
    // pool — keep the default set to the ones that actually work and add more via
    // NITTER_INSTANCES if you find healthy ones. (dropped: xcancel, tiekoetter — 302;
    // nitter.space, lightbrd.com — persistent 403 Cloudflare challenge.)
    "https://nitter.net",
    "https://nitter.privacyredirect.com",
    "https://nitter.poast.org",
  ];

// public instances rate-limit hard (nitter.net 429s after ~3 rapid hits), so never send
// two requests to the SAME instance inside this window — this is what spreads many tracked
// accounts across instances instead of bursting one and getting throttled. Kept generous
// (8s) because only ~2 free instances survive at a time; hitting them faster just trips 429s
// and cascades the whole pool to empty.
const SPACING_MS = 8000;

interface Inst {
  url: string;
  score: number;
  downUntil: number;
  /** earliest time (epoch ms) this instance may be hit again (rate-limit spacing) */
  nextFree: number;
}

/** Health-checked, rate-limited, rotating pool of Nitter instances (public instances
 * are flaky and throttle aggressively). `lease()` both load-balances across healthy
 * instances and enforces per-instance spacing so we never burst one into a 429. */
export class NitterPool {
  private insts: Inst[];
  constructor(urls: string[] = DEFAULTS) {
    this.insts = urls.map((url) => ({ url, score: 1, downUntil: 0, nextFree: 0 }));
  }

  size(): number {
    return this.insts.length;
  }

  /** Reserve the best instance that is both healthy and past its spacing window. Returns
   *  null if every healthy instance is still cooling down — callers should wait (see
   *  `waitMs`) and retry rather than hammer. Reserving pushes the instance's next slot
   *  out, so concurrent callers naturally fan out across instances. */
  lease(): string | null {
    const now = Date.now();
    const ready = this.insts
      .filter((i) => i.downUntil <= now && i.nextFree <= now)
      .sort((a, b) => b.score - a.score || a.nextFree - b.nextFree);
    const chosen = ready[0];
    if (!chosen) return null;
    chosen.nextFree = now + SPACING_MS;
    return chosen.url;
  }

  /** ms until the soonest instance frees up (for a caller to back off when lease() is null) */
  waitMs(): number {
    const now = Date.now();
    const healthy = this.insts.filter((i) => i.downUntil <= now);
    if (!healthy.length) return 60_000; // everything circuit-broken — back off a while
    return Math.max(0, Math.min(...healthy.map((i) => i.nextFree - now)));
  }

  /** one-shot pick for ad-hoc fetches (e.g. guest intel) — same spacing/health rules */
  pick(): string | null {
    return this.lease();
  }

  report(url: string, ok: boolean, status?: number): void {
    const i = this.insts.find((x) => x.url === url);
    if (!i) return;
    if (ok) {
      i.score = Math.min(i.score + 1, 5);
      i.downUntil = 0;
    } else {
      // a 429 means "you're throttled — back off hard". Cooling the instance for several
      // minutes (instead of retrying it into more 429s) is what stops one throttle from
      // cascading the whole pool to empty.
      const throttled = status === 429;
      i.score = Math.max(i.score - (throttled ? 2 : 1), -3);
      i.downUntil = Date.now() + (throttled || i.score < 0 ? 5 * 60_000 : 60_000);
    }
  }

  status(): { healthy: number; total: number } {
    const now = Date.now();
    return { healthy: this.insts.filter((i) => i.downUntil <= now).length, total: this.insts.length };
  }
}
