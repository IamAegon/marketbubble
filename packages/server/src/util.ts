/** Sleep that resolves early if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    const onAbort = () => done();
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function jitter(ms: number, ratio = 0.2): number {
  const delta = ms * ratio;
  // deterministic-enough spread without Math.random dependency concerns
  return ms - delta + Math.random() * 2 * delta;
}

/** Bounded LRU set of recently-seen string keys. */
export class LruSet {
  private set = new Set<string>();
  constructor(private max: number) {}
  /** returns true if newly added (not seen before) */
  add(key: string): boolean {
    if (this.set.has(key)) {
      this.set.delete(key);
      this.set.add(key);
      return false;
    }
    this.set.add(key);
    if (this.set.size > this.max) {
      const oldest = this.set.values().next().value as string | undefined;
      if (oldest !== undefined) this.set.delete(oldest);
    }
    return true;
  }
}
