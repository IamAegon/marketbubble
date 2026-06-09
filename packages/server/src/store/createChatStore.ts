import type { Db } from "./db.js";
import { type ChatStore } from "./ChatStore.js";
import { PgChatStore } from "./PgChatStore.js";

/** The durable chat history + search, backed by the shared {@link Db} (PGlite by
 * default, managed Postgres via DATABASE_URL). Always durable — there is no
 * in-memory fallback; the RingBuffer remains only as a hot cache for live
 * fan-out and WS backfill. */
export async function createChatStore(db: Db): Promise<ChatStore> {
  const store = new PgChatStore(db);
  await store.init();
  return store;
}
