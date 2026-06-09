import type { ChatMessage } from "@app/shared";
import type { AroundOpts, ChatStore, SearchOpts } from "./ChatStore.js";
import type { Db } from "./db.js";
import { logger } from "../observability/logger.js";

function rowToMessage(r: any): ChatMessage {
  return {
    id: r.id,
    platform: r.platform,
    platformMsgId: r.platform_msg_id,
    channel: r.channel,
    channelLabel: r.channel_label ?? r.channel,
    author: {
      username: r.author_username ?? "anon",
      displayName: r.author_display ?? r.author_username ?? "anon",
      color: r.author_color ?? undefined,
      avatarUrl: r.author_avatar ?? undefined,
      platformUserId: r.author_platform_user_id ?? undefined,
    },
    text: r.text,
    emotes: r.emotes ?? undefined,
    badges: r.badges ?? undefined,
    cashtags: r.cashtags ?? undefined,
    replyTo: r.reply_to ?? undefined,
    embed: r.embed ?? undefined,
    kind: r.kind ?? undefined,
    category: r.category ?? undefined,
    link: r.link ?? undefined,
    sentiment: r.sentiment != null ? Number(r.sentiment) : undefined,
    conf: r.conf != null ? Number(r.conf) : undefined,
    timestamp: Number(r.ts),
    receivedAt: Number(r.received_at),
  };
}

/** Durable Postgres-backed history + search over the shared {@link Db} (PGlite by
 * default, managed Postgres via DATABASE_URL). Writes are batched off the hot
 * path; search uses ILIKE over text/author with channel/platform filters. The
 * schema is owned by the migration runner, not this class. */
export class PgChatStore implements ChatStore {
  private queue: ChatMessage[] = [];
  private flushing = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: Db) {}

  async init(): Promise<void> {
    this.timer = setInterval(() => void this.flush(), 1000);
    this.timer.unref?.();
    logger.info({ backend: this.db.kind }, "durable chat store ready");
  }

  put(m: ChatMessage): void {
    this.queue.push(m);
    if (this.queue.length >= 200) void this.flush();
  }

  /** drain the pending write queue (called on the 1s timer and on shutdown) */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      const cols = 23;
      const values: any[] = [];
      const tuples = batch.map((m, i) => {
        const o = i * cols;
        values.push(
          m.id, m.platform, m.platformMsgId, m.channel, m.channelLabel,
          m.author.username, m.author.displayName, m.author.color ?? null, m.text,
          m.kind ?? null, m.category ?? null, m.link ?? null,
          JSON.stringify(m.emotes ?? null), JSON.stringify(m.badges ?? null),
          JSON.stringify(m.cashtags ?? null), JSON.stringify(m.replyTo ?? null),
          m.timestamp, m.receivedAt,
          m.author.avatarUrl ?? null, m.author.platformUserId ?? null,
          JSON.stringify(m.embed ?? null), m.sentiment ?? null, m.conf ?? null,
        );
        return `(${Array.from({ length: cols }, (_, k) => `$${o + k + 1}`).join(",")})`;
      });
      await this.db.query(
        `INSERT INTO messages (id, platform, platform_msg_id, channel, channel_label,
           author_username, author_display, author_color, text, kind, category, link,
           emotes, badges, cashtags, reply_to, ts, received_at,
           author_avatar, author_platform_user_id, embed, sentiment, conf)
         VALUES ${tuples.join(",")}
         ON CONFLICT (platform, platform_msg_id) DO NOTHING`,
        values,
      );
    } catch (e) {
      logger.warn({ err: String(e) }, "PgChatStore flush failed");
      // re-queue the batch so a transient DB error doesn't drop durable history
      // (bounded so a persistent outage can't grow the queue without limit)
      if (this.queue.length < 5000) this.queue.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }

  /** flush + stop the timer (shutdown); the underlying Db is closed by its owner */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  async search({ q, platform, channel, limit = 60 }: SearchOpts): Promise<ChatMessage[]> {
    const needle = q.trim();
    if (!needle) return [];
    const r = await this.db.query(
      `SELECT * FROM messages
        WHERE ($2::text IS NULL OR platform = $2)
          AND ($3::text IS NULL OR channel = $3)
          AND (text ILIKE '%' || $1 || '%' OR author_display ILIKE '%' || $1 || '%' OR author_username ILIKE '%' || $1 || '%')
        ORDER BY ts DESC
        LIMIT $4`,
      [needle, platform ?? null, channel ?? null, limit],
    );
    return r.rows.map(rowToMessage);
  }

  async around(id: string, { before = 12, after = 12 }: AroundOpts = {}): Promise<ChatMessage[]> {
    const h = await this.db.query(`SELECT channel, ts FROM messages WHERE id = $1`, [id]);
    if (!h.rows[0]) return [];
    const { channel, ts } = h.rows[0];
    // Split on the (ts, id) tuple with a stable tiebreaker so same-ms messages
    // (common for captions / busy chat) land deterministically and the hit is
    // included exactly once.
    const pre = await this.db.query(
      `SELECT * FROM messages WHERE channel = $1 AND (ts < $2 OR (ts = $2 AND id <= $3)) ORDER BY ts DESC, id DESC LIMIT $4`,
      [channel, ts, id, before + 1],
    );
    const post = await this.db.query(
      `SELECT * FROM messages WHERE channel = $1 AND (ts > $2 OR (ts = $2 AND id > $3)) ORDER BY ts ASC, id ASC LIMIT $4`,
      [channel, ts, id, after],
    );
    return [...pre.rows.reverse(), ...post.rows].map(rowToMessage);
  }

  async recent({ sinceMs, limit = 50_000 }: { sinceMs?: number; limit?: number } = {}): Promise<ChatMessage[]> {
    const from = sinceMs ? Date.now() - sinceMs : null;
    const r = await this.db.query(
      `SELECT * FROM messages WHERE ($1::bigint IS NULL OR ts > $1) ORDER BY ts DESC LIMIT $2`,
      [from, limit],
    );
    return r.rows.map(rowToMessage).reverse(); // most-recent window, returned oldest-first for replay
  }

  /** recent native MB-room messages (platform 'mb'), oldest-first — durable source for reload
   *  backfill so low-traffic rooms survive the in-memory ring evicting them under live chat. */
  async recentRooms({ limit = 80 }: { limit?: number } = {}): Promise<ChatMessage[]> {
    const r = await this.db.query(
      `SELECT * FROM messages WHERE platform = 'mb' ORDER BY ts DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map(rowToMessage).reverse(); // most-recent window, oldest-first for replay
  }

  /** recent tracked-account posts (kind 'post'), oldest-first — durable backfill so every
   *  X category stays populated and survives reloads instead of evicting from the ring. */
  async recentPosts({ limit = 300 }: { limit?: number } = {}): Promise<ChatMessage[]> {
    const r = await this.db.query(
      `SELECT * FROM messages WHERE kind = 'post' ORDER BY ts DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map(rowToMessage).reverse();
  }

  durable(): boolean {
    return true;
  }
}
