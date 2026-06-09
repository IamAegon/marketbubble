import type { ChatMessage } from "@app/shared";
import type { MessageBus } from "../bus/MessageBus.js";
import type { RingBuffer } from "../store/RingBuffer.js";
import type { ChatStore } from "../store/ChatStore.js";
import type { Deduper } from "../dedup/Deduper.js";
import type { HealthRegistry } from "../observability/health.js";
import type { StatsAggregator } from "../analytics/StatsAggregator.js";
import type { SessionRecorder } from "../analytics/SessionRecorder.js";

export interface Pipeline {
  /** connector-facing entry point: dedup -> store -> bus */
  ingest(connectorId: string, m: ChatMessage): void;
}

export function createPipeline(deps: {
  bus: MessageBus;
  ring: RingBuffer;
  deduper: Deduper;
  health: HealthRegistry;
  /** durable history sink (Postgres) — fire-and-forget */
  store?: ChatStore;
  /** rolling analytics aggregator — folds every accepted message */
  stats?: StatsAggregator;
  /** mod-controlled session recorder — folds messages into active recordings */
  sessions?: SessionRecorder;
  /** annotate/observe a message before it's stored & broadcast (cashtags, sentiment) */
  enrich?: (m: ChatMessage) => void;
}): Pipeline {
  const { bus, ring, deduper, health, store, stats, sessions, enrich } = deps;
  return {
    ingest(connectorId, m) {
      if (!deduper.accept(m)) return;
      enrich?.(m); // sets cashtags before stats records them
      ring.append(m);
      store?.put(m);
      stats?.record(m);
      sessions?.record(m);
      health.recordEvent(connectorId, m.receivedAt);
      bus.publish(m);
    },
  };
}
