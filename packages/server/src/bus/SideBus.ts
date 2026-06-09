import { EventEmitter } from "node:events";
import type { ServerMsg } from "@app/shared";

/** Side-band (market) messages — broadcast to all WS clients UNFILTERED.
 * Kept separate from the chat MessageBus so price/market/sentiment data never
 * touches chat dedup / ring buffer / persistence. */
export type SideMsg = Extract<ServerMsg, { type: "ticker" | "price" | "markets" | "sentiment" | "viewers" }>;

export class SideBus {
  private em = new EventEmitter();
  /** last message of each type, replayed to new subscribers so they don't wait a poll cycle */
  private last = new Map<string, SideMsg>();

  constructor() {
    this.em.setMaxListeners(0);
  }
  publish(m: SideMsg): void {
    this.last.set(m.type, m);
    this.em.emit("msg", m);
  }
  subscribe(fn: (m: SideMsg) => void): () => void {
    this.em.on("msg", fn);
    return () => this.em.off("msg", fn);
  }
  /** the latest cached message of each type (ticker/markets/sentiment) */
  snapshot(): SideMsg[] {
    return [...this.last.values()];
  }
}
