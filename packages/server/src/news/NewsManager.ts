import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ConnectorInfo } from "@app/shared";
import { SupervisedConnector } from "../connectors/SupervisedConnector.js";
import type { Pipeline } from "../pipeline/ingest.js";
import type { HealthRegistry } from "../observability/health.js";
import { NitterPool } from "../connectors/x/nitterPool.js";
import { XNitterConnector } from "../connectors/x/XNitterConnector.js";
import { curlText, NITTER_UA } from "../connectors/x/curlFetch.js";
import { parseNitterRss } from "../connectors/x/nitterRss.js";
import { fetchSyndicationTimeline } from "../connectors/x/xSyndication.js";
import { sleep } from "../util.js";
import type { GuestPost } from "@app/shared";
import { logger } from "../observability/logger.js";

export interface TrackedAccount {
  handle: string;
  category: string;
}

// breaking-news categories worth keeping fresh; everything else polls on the slow tier.
// (mirrors the Rust version, which polled "News" every 60s and the rest every 5 min — that
// tiering is what kept total request volume under the public Nitter rate limits.)
const HOT_CATEGORIES = new Set(["News", "Politics", "Macro"]);
const HOT_POLL_MS = 90_000;
const COLD_POLL_MS = 300_000;
const pollMsFor = (category: string): number => (HOT_CATEGORIES.has(category) ? HOT_POLL_MS : COLD_POLL_MS);

export interface NewsManagerDeps {
  pipeline: Pipeline;
  health: HealthRegistry;
  userAgent: string;
  onStatus: (info: ConnectorInfo) => void;
  persistPath?: string;
}

/** Manages tracked X accounts as Nitter-polling connectors (runtime add/remove). */
export class NewsManager {
  private entries = new Map<string, { abort: AbortController; account: TrackedAccount }>();
  private pool = new NitterPool();

  constructor(private readonly deps: NewsManagerDeps) {}

  /** On-demand recent posts for any handle (guest intel).
   *  PRIMARY: X's own syndication timeline (direct, ~100 posts, no rate limit). FALLBACK:
   *  the Nitter pool with failover + wait-for-slot (which guards two failure modes — instances
   *  flipping 200/403/502/429, and the background pollers starving a single-shot pick). */
  async recentForHandle(handle: string, limit = 8): Promise<GuestPost[]> {
    const h = handle.replace(/^@/, "").trim();
    if (!h) return [];
    // primary: syndication
    try {
      const syn = await fetchSyndicationTimeline(h);
      if (syn && syn.items.length) {
        return syn.items.slice(0, limit).map((i) => ({ text: i.text, link: i.link, at: i.pubMs, author: i.author || `@${h}` }));
      }
    } catch {
      /* fall back to nitter */
    }
    // fallback: nitter pool
    const deadline = Date.now() + 12_000;
    const maxFetches = Math.min(3, Math.max(2, this.pool.size()));
    let fetches = 0;
    while (Date.now() < deadline && fetches < maxFetches) {
      const base = this.pool.pick();
      if (!base) {
        // every healthy instance is mid-spacing — wait for the soonest slot, don't give up
        await sleep(Math.min(this.pool.waitMs() + 250, 3_000));
        continue;
      }
      fetches++;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 11_000);
      try {
        const { ok, body, status } = await curlText(`${base}/${h}/rss`, NITTER_UA, ac.signal);
        if (!ok || !body.includes("<rss")) {
          this.pool.report(base, false, status);
          continue;
        }
        const { items, error } = parseNitterRss(body, h);
        // a syntactically-valid feed can still be a rate-limit/whitelist notice — fail over
        if (error) {
          this.pool.report(base, false, status);
          continue;
        }
        this.pool.report(base, true);
        return items.slice(0, limit).map((i) => ({ text: i.text, link: i.link, at: i.pubMs, author: i.author }));
      } catch {
        this.pool.report(base, false);
      } finally {
        clearTimeout(timer);
      }
    }
    return [];
  }

  private idFor(handle: string): string {
    return `xnews:${handle.replace(/^@/, "").trim().toLowerCase()}`;
  }

  list(): { handle: string; category: string; id: string; status: string }[] {
    return [...this.entries.values()].map((e) => {
      const id = this.idFor(e.account.handle);
      const c = this.deps.health.get(id);
      return { handle: e.account.handle, category: e.account.category, id, status: c?.status.kind ?? "connecting" };
    });
  }

  add(handle: string, category: string): TrackedAccount {
    const h = handle.replace(/^@/, "").trim();
    const id = this.idFor(h);
    const account: TrackedAccount = { handle: h, category: category?.trim() || "News" };
    const existing = this.entries.get(id);
    if (existing) {
      existing.account.category = account.category;
      this.persist();
      return existing.account;
    }
    const conn = new XNitterConnector(h, account.category, this.pool, pollMsFor(account.category));
    const abort = new AbortController();
    this.entries.set(id, { abort, account });
    this.deps.health.register(id, "x", `@${h}`);
    const sup = new SupervisedConnector(conn, {
      onMessage: (m) => this.deps.pipeline.ingest(id, m),
      onStatus: (cid, status) => {
        this.deps.health.setStatus(cid, status);
        const comp = this.deps.health.get(cid);
        if (comp) this.deps.onStatus({ id: comp.id, platform: comp.platform, label: comp.label, status });
      },
    });
    sup.run(abort.signal).catch((e) => logger.error({ err: String(e), id }, "nitter supervisor crashed"));
    logger.info({ handle: h, category: account.category }, "tracked account added");
    this.persist();
    return account;
  }

  remove(handle: string): boolean {
    const id = this.idFor(handle);
    const e = this.entries.get(id);
    if (!e) return false;
    e.abort.abort();
    this.entries.delete(id);
    this.deps.health.remove(id);
    this.deps.onStatus({ id, platform: "x", label: `@${handle}`, status: { kind: "idle", reason: "removed" } });
    this.persist();
    return true;
  }

  stopAll(): void {
    for (const e of this.entries.values()) e.abort.abort();
  }

  initial(seed: TrackedAccount[]): TrackedAccount[] {
    if (this.deps.persistPath && existsSync(this.deps.persistPath)) {
      try {
        return JSON.parse(readFileSync(this.deps.persistPath, "utf8")) as TrackedAccount[];
      } catch {
        /* ignore */
      }
    }
    return seed;
  }

  private persist(): void {
    if (!this.deps.persistPath) return;
    try {
      mkdirSync(dirname(this.deps.persistPath), { recursive: true });
      writeFileSync(this.deps.persistPath, JSON.stringify([...this.entries.values()].map((e) => e.account), null, 2));
    } catch (e) {
      logger.warn({ err: String(e) }, "persist tracked accounts failed");
    }
  }
}
