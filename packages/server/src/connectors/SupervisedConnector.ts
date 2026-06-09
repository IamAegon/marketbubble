import type { ChatMessage, ConnectorStatus } from "@app/shared";
import type { Connector } from "./Connector.js";
import { logger } from "../observability/logger.js";
import { sleep } from "../util.js";

export interface ReconnectPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  /** a session that stayed connected at least this long resets the backoff */
  resetAfterConnectedMs: number;
}

export const DEFAULT_POLICY: ReconnectPolicy = {
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  factor: 2,
  resetAfterConnectedMs: 30_000,
};

export interface SupervisorHooks {
  onMessage: (m: ChatMessage) => void;
  onStatus: (id: string, status: ConnectorStatus) => void;
}

/**
 * Runs a Connector forever with exponential backoff (port of plenus
 * feed.rs::run_reconnecting_stream). `connect()` is expected to stay pending
 * while the connection is live and resolve/throw when it ends; we then
 * reconnect unless the shared signal has aborted.
 */
export class SupervisedConnector {
  private log;
  constructor(
    private readonly connector: Connector,
    private readonly hooks: SupervisorHooks,
    private readonly policy: ReconnectPolicy = DEFAULT_POLICY,
  ) {
    this.log = logger.child({ connector: connector.id, platform: connector.platform });
  }

  async run(signal: AbortSignal): Promise<void> {
    let delay = this.policy.initialDelayMs;
    let attempt = 0;

    while (!signal.aborted) {
      const startedAt = Date.now();
      const status = (s: ConnectorStatus) => this.hooks.onStatus(this.connector.id, s);
      try {
        status({ kind: "connecting" });
        await this.connector.connect({
          onMessage: this.hooks.onMessage,
          onStatus: status,
          signal,
        });
        // connect() returned -> the connection closed
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.log.warn({ error }, "connector error");
        status({ kind: "reconnecting", error, attempt, delayMs: delay });
      }

      if (signal.aborted) break;

      const lasted = Date.now() - startedAt;
      if (lasted >= this.policy.resetAfterConnectedMs) {
        delay = this.policy.initialDelayMs;
        attempt = 0;
      }
      attempt += 1;
      status({ kind: "reconnecting", error: "disconnected", attempt, delayMs: delay });
      this.log.info({ delayMs: delay, attempt }, "reconnecting");
      await sleep(delay, signal);
      delay = Math.min(delay * this.policy.factor, this.policy.maxDelayMs);
    }

    this.hooks.onStatus(this.connector.id, { kind: "idle", reason: "shutdown" });
    this.log.info("connector stopped");
  }
}
