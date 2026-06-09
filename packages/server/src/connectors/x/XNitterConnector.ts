import { ulid } from "ulid";
import type { ChatMessage } from "@app/shared";
import type { Connector, ConnectorContext } from "../Connector.js";
import { LruSet, sleep, jitter } from "../../util.js";
import type { NitterPool } from "./nitterPool.js";
import { parseNitterRss } from "./nitterRss.js";
import { fetchSyndicationTimeline, type XPost } from "./xSyndication.js";
import { curlText, NITTER_UA } from "./curlFetch.js";
import { logger } from "../../observability/logger.js";

/** Polls a tracked X account's Nitter RSS and emits its tweets as `kind:'post'`. */
export class XNitterConnector implements Connector {
  readonly platform = "x" as const;
  readonly id: string;
  readonly label: string;
  private readonly handle: string;
  // learned from the Nitter channel each poll (account display name + avatar)
  private displayName?: string;
  private avatar?: string;

  constructor(
    handle: string,
    private readonly category: string,
    private readonly pool: NitterPool,
    // base poll interval — tiered by the caller so breaking-news handles stay fresh while
    // the long tail polls slowly (mirrors the Rust version's news-60s / rest-5min split,
    // which is what kept total load under the public instances' rate limits)
    private readonly pollMs: number = 300_000,
  ) {
    this.handle = handle.replace(/^@/, "").trim();
    this.id = `xnews:${this.handle.toLowerCase()}`;
    this.label = `@${this.handle}`;
  }

  async connect(ctx: ConnectorContext): Promise<void> {
    const seen = new LruSet(1200);
    let first = true;

    // light startup stagger (the primary source has no rate limit, so this is just to keep
    // the Nitter fallback from bursting if syndication is ever down at boot)
    await sleep(Math.floor(Math.random() * 8_000), ctx.signal);

    while (!ctx.signal.aborted) {
      let connected = false;
      let lastErr = "";

      // PRIMARY: X's own syndication timeline — direct from X, ~100 posts, effectively no
      // rate limit, no instance pool. This is the in-house equivalent of what a scraping
      // provider does, and it's the reliable path.
      try {
        const syn = await fetchSyndicationTimeline(this.handle, ctx.signal);
        if (syn && syn.items.length) {
          if (syn.avatar) this.avatar = syn.avatar;
          if (syn.name) this.displayName = syn.name;
          ctx.onStatus({ kind: "connected" });
          this.emitFresh(ctx, seen, syn.items, first);
          first = false;
          connected = true;
        } else {
          lastErr = "syndication empty";
        }
      } catch (e) {
        lastErr = `syndication: ${String(e)}`;
        logger.debug({ err: lastErr, handle: this.handle }, "syndication poll failed — falling back to nitter");
      }

      // FALLBACK: Nitter pool (only if syndication failed) — with failover across instances.
      let fetchTries = 0;
      const maxFetch = Math.max(2, this.pool.size());
      const deadline = Date.now() + 30_000;
      while (!connected && !ctx.signal.aborted && fetchTries < maxFetch && Date.now() < deadline) {
        const base = this.pool.lease();
        if (!base) {
          await sleep(Math.min(this.pool.waitMs() + jitter(400), 6_000), ctx.signal);
          continue;
        }
        fetchTries++;
        let lastStatus = 0;
        try {
          const { ok, body, status } = await curlText(`${base}/${this.handle}/rss`, NITTER_UA, ctx.signal);
          lastStatus = status;
          if (!ok) throw new Error(`HTTP ${status || "?"}`);
          if (!body.includes("<rss")) throw new Error(`not RSS (HTTP ${status})`);
          const { items, avatar, name, error } = parseNitterRss(body, this.handle);
          if (error) throw new Error(`instance notice: ${error}`);
          if (avatar) this.avatar = avatar;
          if (name) this.displayName = name;
          this.pool.report(base, true);
          ctx.onStatus({ kind: "connected" });
          this.emitFresh(ctx, seen, items, first);
          first = false;
          connected = true;
        } catch (e) {
          this.pool.report(base, false, lastStatus);
          lastErr = String(e);
          logger.debug({ err: lastErr, handle: this.handle, base, status: lastStatus }, "nitter poll failed — trying next instance");
        }
      }

      // tiered cadence (hot ~90s / cold ~5min) — keeps total volume modest for both sources.
      if (!connected) ctx.onStatus({ kind: "reconnecting", error: lastErr || "no source", attempt: 0, delayMs: this.pollMs });
      await sleep(this.pollMs + jitter(Math.round(this.pollMs * 0.25)), ctx.signal);
    }
  }

  /** dedupe against what we've already emitted, cap the very first poll to the latest few
   *  (so we don't dump 100 backfilled posts on startup), and emit oldest-first. */
  private emitFresh(ctx: ConnectorContext, seen: LruSet, items: XPost[], first: boolean): void {
    const fresh = items.filter((it) => seen.add(it.link));
    const toEmit = (first ? fresh.slice(0, 5) : fresh).reverse(); // oldest-first
    for (const it of toEmit) ctx.onMessage(this.toMessage(it));
  }

  private toMessage(it: { text: string; link: string; pubMs: number; images?: string[] }): ChatMessage {
    return {
      id: ulid(),
      platform: "x",
      platformMsgId: it.link,
      channel: this.id,
      channelLabel: `@${this.handle}`,
      author: {
        username: this.handle,
        displayName: this.displayName || this.handle,
        ...(this.avatar ? { avatarUrl: this.avatar } : {}),
      },
      text: it.text,
      timestamp: it.pubMs,
      receivedAt: Date.now(),
      kind: "post",
      category: this.category,
      link: it.link,
      ...(it.images?.length ? { media: it.images } : {}),
    };
  }
}
