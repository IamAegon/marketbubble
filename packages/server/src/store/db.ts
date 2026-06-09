import { resolve } from "node:path";
import { logger } from "../observability/logger.js";

/**
 * Minimal Postgres client interface shared by every durable store. Two backends,
 * same SQL (real Postgres dialect either way):
 *  - **PGlite** (default): embedded Postgres running in-process, persisting to
 *    `data/pgdata`. Zero setup, no Docker, no service — durable from first boot.
 *  - **node-postgres** (`pg`): used when `DATABASE_URL` is set, for a managed/
 *    remote Postgres in production. Identical SQL, so no query changes.
 */
export interface Db {
  kind: "pglite" | "pg";
  query<R = any>(sql: string, params?: any[]): Promise<{ rows: R[] }>;
  /** run one or more DDL statements (no params) */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Open the durable database. `DATABASE_URL` → managed Postgres; otherwise the
 * embedded PGlite at `data/pgdata`. Throws if the configured DB can't be opened
 * (the durable store is mandatory — there is no in-memory fallback). */
export async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query("SELECT 1"); // fail fast if the remote DB is unreachable
    logger.info("DB: connected to Postgres via DATABASE_URL");
    return {
      kind: "pg",
      query: (sql, params) => pool.query(sql, params).then((r) => ({ rows: r.rows })),
      exec: async (sql) => {
        await pool.query(sql);
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dir = resolve(process.cwd(), "data/pgdata");
  const pglite = new PGlite(dir);
  await pglite.waitReady;
  logger.info({ dir }, "DB: embedded Postgres (PGlite) ready");
  return {
    kind: "pglite",
    query: (sql, params) => pglite.query(sql, params).then((r) => ({ rows: r.rows as any[] })),
    exec: async (sql) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}
