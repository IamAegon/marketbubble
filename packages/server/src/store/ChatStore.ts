import type { ChatMessage } from "@app/shared";
import type { RingBuffer } from "./RingBuffer.js";

export interface SearchOpts {
  q: string;
  platform?: string;
  channel?: string;
  limit?: number;
}

export interface AroundOpts {
  before?: number;
  after?: number;
}

/** Pluggable message history + search. Ring-backed by default (session-only);
 * Postgres-backed when DATABASE_URL is set (durable across restarts). */
export interface ChatStore {
  /** fire-and-forget persistence on ingest */
  put(m: ChatMessage): void;
  /** newest-first text search */
  search(opts: SearchOpts): Promise<ChatMessage[]>;
  /** the conversation surrounding a message id (same channel), oldest-first */
  around(id: string, opts?: AroundOpts): Promise<ChatMessage[]>;
  /** recent messages (oldest-first) for boot-rebuild of in-memory analytics + ring */
  recent(opts?: { sinceMs?: number; limit?: number }): Promise<ChatMessage[]>;
  /** recent native MB-room messages (platform 'mb'), oldest-first — for reload backfill of
   * low-traffic rooms that heavy live chat would otherwise evict from the in-memory ring */
  recentRooms(opts?: { limit?: number }): Promise<ChatMessage[]>;
  /** recent tracked-account posts (kind 'post'), oldest-first — durable backfill so every
   * category stays populated and cached across reloads despite the ring evicting them */
  recentPosts(opts?: { limit?: number }): Promise<ChatMessage[]>;
  /** durable history available? */
  durable(): boolean;
  /** drain any pending writes (called periodically + on shutdown) */
  flush(): Promise<void>;
  /** flush + release resources on shutdown */
  close(): Promise<void>;
}

/** Default store: searches the in-memory hot buffer. No persistence. */
export class RingChatStore implements ChatStore {
  constructor(private readonly ring: RingBuffer) {}
  put(): void {
    /* ring is already populated by the pipeline */
  }
  async search({ q, platform, channel, limit = 60 }: SearchOpts): Promise<ChatMessage[]> {
    return this.ring.search(q, { platform, channel, limit });
  }
  async around(id: string, { before = 12, after = 12 }: AroundOpts = {}): Promise<ChatMessage[]> {
    return this.ring.around(id, before, after);
  }
  async recent({ sinceMs, limit = 5000 }: { sinceMs?: number; limit?: number } = {}): Promise<ChatMessage[]> {
    const msgs = this.ring.recent({ platforms: [], channels: [] }, limit);
    if (!sinceMs) return msgs;
    const from = Date.now() - sinceMs;
    return msgs.filter((m) => (m.receivedAt || m.timestamp) >= from);
  }
  async recentRooms({ limit = 80 }: { limit?: number } = {}): Promise<ChatMessage[]> {
    return this.ring.recentRooms(limit);
  }
  async recentPosts({ limit = 300 }: { limit?: number } = {}): Promise<ChatMessage[]> {
    return this.ring.recentPosts(limit);
  }
  durable(): boolean {
    return false;
  }
  async flush(): Promise<void> {
    /* nothing buffered */
  }
  async close(): Promise<void> {
    /* nothing to release */
  }
}
