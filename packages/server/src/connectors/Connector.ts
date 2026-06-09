import type { ChatMessage, ConnectorStatus, Platform } from "@app/shared";

export interface ConnectorContext {
  /** emit a normalized message into the pipeline */
  onMessage: (m: ChatMessage) => void;
  /** report lifecycle changes (-> health + UI banners) */
  onStatus: (s: ConnectorStatus) => void;
  /** cancellation token (aborted on shutdown / unsubscribe) */
  signal: AbortSignal;
}

/**
 * One long-lived source connection. Run under SupervisedConnector, which
 * handles reconnection/backoff. `connect` should resolve once the underlying
 * connection is established and reject/throw on connect failure so the
 * supervisor can retry. It should keep running until `ctx.signal` aborts.
 */
export interface Connector {
  readonly id: string;
  readonly platform: Platform;
  readonly label: string;
  connect(ctx: ConnectorContext): Promise<void>;
}
