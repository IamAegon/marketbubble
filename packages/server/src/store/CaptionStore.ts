import type { Db } from "./db.js";
import { logger } from "../observability/logger.js";

export interface CaptionRow {
  id: string;
  channel: string;
  /** the open session this caption belongs to, if any (FK) */
  sessionId?: string;
  streamerId?: string;
  text: string;
  conf?: number;
  startMs: number;
  endMs?: number;
  receivedAt: number;
}

function rowToCaption(r: any): CaptionRow {
  return {
    id: r.id,
    channel: r.channel,
    sessionId: r.session_id ?? undefined,
    streamerId: r.streamer_id ?? undefined,
    text: r.text,
    conf: r.conf != null ? Number(r.conf) : undefined,
    startMs: Number(r.start_ms),
    endMs: r.end_ms != null ? Number(r.end_ms) : undefined,
    receivedAt: Number(r.received_at),
  };
}

/** Durable transcript store: live STT captions persisted as first-class rows
 * (FK channel + optional session), so transcripts survive ring eviction and are
 * queryable per-stream / per-session. Writes are fire-and-forget off the hot path. */
export class CaptionStore {
  constructor(private readonly db: Db) {}

  put(c: CaptionRow): void {
    void this.db
      .query(
        `INSERT INTO captions (id, channel, session_id, streamer_id, text, conf, start_ms, end_ms, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.channel, c.sessionId ?? null, c.streamerId ?? null, c.text, c.conf ?? null, c.startMs, c.endMs ?? null, c.receivedAt],
      )
      .catch((e) => logger.warn({ err: String(e) }, "caption persist failed"));
  }

  /** newest-first captions for a channel */
  async recent(channel: string, limit = 200): Promise<CaptionRow[]> {
    const { rows } = await this.db.query(`SELECT * FROM captions WHERE channel = $1 ORDER BY start_ms DESC LIMIT $2`, [channel, limit]);
    return rows.map(rowToCaption);
  }

  /** the full transcript for one recorded session, oldest-first */
  async forSession(sessionId: string, limit = 10_000): Promise<CaptionRow[]> {
    const { rows } = await this.db.query(`SELECT * FROM captions WHERE session_id = $1 ORDER BY start_ms ASC LIMIT $2`, [sessionId, limit]);
    return rows.map(rowToCaption);
  }
}
