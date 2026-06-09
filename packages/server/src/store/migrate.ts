import type { Db } from "./db.js";
import { logger } from "../observability/logger.js";

interface Migration {
  id: string;
  sql: string;
}

/**
 * Ordered, append-only schema migrations. Each runs once and is recorded in
 * `_migrations`; never edit an applied migration — add a new one. This replaces
 * the old inline `CREATE TABLE IF NOT EXISTS` so the schema is versioned and the
 * same on every backend (PGlite + managed Postgres).
 */
const MIGRATIONS: Migration[] = [
  {
    id: "0001_messages",
    sql: `
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        platform_msg_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        channel_label TEXT,
        author_username TEXT,
        author_display TEXT,
        author_color TEXT,
        text TEXT NOT NULL,
        kind TEXT,
        category TEXT,
        link TEXT,
        emotes JSONB,
        badges JSONB,
        cashtags JSONB,
        reply_to JSONB,
        ts BIGINT NOT NULL,
        received_at BIGINT NOT NULL,
        UNIQUE (platform, platform_msg_id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages (channel, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts DESC);
    `,
  },
  {
    // stop the silent field loss the audit flagged (avatar / platform user id /
    // AI embed were dropped on persist) and store the stamped enrichment so
    // replay is faithful and history is queryable
    id: "0002_message_fields",
    sql: `
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_avatar TEXT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_platform_user_id TEXT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS embed JSONB;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS sentiment SMALLINT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS conf REAL;
    `,
  },
  {
    // sessions + transcripts become first-class durable tables (was: sessions.json
    // rewritten whole, and captions only living in the volatile ring)
    id: "0003_sessions_captions",
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        streamer_id TEXT NOT NULL,
        streamer_name TEXT,
        owned BOOLEAN,
        started_by TEXT,
        started_at BIGINT NOT NULL,
        ended_at BIGINT,
        status TEXT,
        duration_ms BIGINT,
        messages INTEGER,
        chatters INTEGER,
        avg_per_min REAL,
        peak_per_min REAL,
        peak_at BIGINT,
        net REAL,
        by_platform JSONB,
        top_chatters JSONB,
        top_emotes JSONB,
        top_cashtags JSONB,
        activity JSONB,
        sentiment JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions (started_at DESC);

      CREATE TABLE IF NOT EXISTS captions (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        session_id TEXT,
        streamer_id TEXT,
        text TEXT NOT NULL,
        conf REAL,
        start_ms BIGINT NOT NULL,
        end_ms BIGINT,
        received_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_captions_channel_start ON captions (channel, start_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_captions_session ON captions (session_id, start_ms);
    `,
  },
];

/** Apply any pending migrations. Idempotent; safe to run on every boot. */
export async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at BIGINT NOT NULL);`);
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM _migrations`);
  const done = new Set(rows.map((r) => r.id));
  let applied = 0;
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.exec(m.sql);
    await db.query(`INSERT INTO _migrations (id, applied_at) VALUES ($1, $2)`, [m.id, Date.now()]);
    applied++;
    logger.info({ migration: m.id }, "migration applied");
  }
  logger.info({ applied, total: MIGRATIONS.length, backend: db.kind }, "schema up to date");
}
