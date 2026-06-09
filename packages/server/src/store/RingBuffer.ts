import type { ChatMessage, Filters } from "@app/shared";

/**
 * Bounded append-only buffer of recent messages for fast backfill to
 * late-joining clients (port of plenus trade.rs recent-N log). When persistence
 * is added, this becomes the hot cache in front of Postgres.
 */
export class RingBuffer {
  private buf: ChatMessage[] = [];
  constructor(private readonly capacity: number = 5000) {}

  append(m: ChatMessage): void {
    this.buf.push(m);
    if (this.buf.length > this.capacity) {
      this.buf.splice(0, this.buf.length - this.capacity);
    }
  }

  /** most recent `n` messages matching the filters, oldest-first */
  recent(filters: Filters, n: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = this.buf.length - 1; i >= 0 && out.length < n; i--) {
      const m = this.buf[i]!;
      if (matches(filters, m)) out.push(m);
    }
    return out.reverse();
  }

  /** most recent `n` tracked-account posts (kind:'post'), oldest-first — so the
   * News rail is reliable even when fast chat would evict them from `recent`. */
  recentPosts(n: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = this.buf.length - 1; i >= 0 && out.length < n; i--) {
      const m = this.buf[i]!;
      if (m.kind === "post") out.push(m);
    }
    return out.reverse();
  }

  /** most recent `n` native MB-room messages (platform 'mb'), oldest-first — kept in
   * backfill like posts so low-traffic rooms survive the high-volume chat window. */
  recentRooms(n: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = this.buf.length - 1; i >= 0 && out.length < n; i--) {
      const m = this.buf[i]!;
      if (m.platform === "mb") out.push(m);
    }
    return out.reverse();
  }

  /** the conversation around a message id: its same-channel neighbours, oldest-first */
  around(id: string, before: number, after: number): ChatMessage[] {
    const idx = this.buf.findIndex((m) => m.id === id);
    if (idx < 0) return [];
    const hit = this.buf[idx]!;
    const ch = hit.channel;
    const out: ChatMessage[] = [hit];
    for (let i = idx - 1, c = 0; i >= 0 && c < before; i--) {
      if (this.buf[i]!.channel === ch) {
        out.unshift(this.buf[i]!);
        c++;
      }
    }
    for (let i = idx + 1, c = 0; i < this.buf.length && c < after; i++) {
      if (this.buf[i]!.channel === ch) {
        out.push(this.buf[i]!);
        c++;
      }
    }
    return out;
  }

  /** newest-first text search over the hot buffer (used when no DB is configured) */
  search(needle: string, opts: { platform?: string; channel?: string; limit: number }): ChatMessage[] {
    const q = needle.trim().toLowerCase();
    if (!q) return [];
    const out: ChatMessage[] = [];
    for (let i = this.buf.length - 1; i >= 0 && out.length < opts.limit; i--) {
      const m = this.buf[i]!;
      if (opts.platform && m.platform !== opts.platform) continue;
      if (opts.channel && m.channel !== opts.channel) continue;
      const hay = `${m.text} ${m.author.displayName} ${m.author.username} ${m.channelLabel}`.toLowerCase();
      if (!hay.includes(q)) continue;
      out.push(m);
    }
    return out;
  }

  size(): number {
    return this.buf.length;
  }
}

export function matches(filters: Filters, m: ChatMessage): boolean {
  // tolerate malformed/partial filters (a bad client `hello` must not crash fan-out)
  const platforms = filters?.platforms ?? [];
  const channels = filters?.channels ?? [];
  if (platforms.length && !platforms.includes(m.platform)) return false;
  if (channels.length && !channels.includes(m.channel)) return false;
  return true;
}
