import { EventEmitter } from "node:events";
import type { ChatMessage } from "@app/shared";
import type { MessageBus } from "./MessageBus.js";

/**
 * Single-node bus: mirrors plenus broadcast::channel semantics. Every
 * subscriber receives every message; slow subscribers are the WS layer's
 * concern (it bounds its own send queue and clients backfill from the ring).
 */
export class InMemoryBus implements MessageBus {
  private emitter = new EventEmitter();

  constructor() {
    // many WS clients subscribe; lift the default 10-listener cap
    this.emitter.setMaxListeners(0);
  }

  publish(m: ChatMessage): void {
    this.emitter.emit("msg", m);
  }

  subscribe(fn: (m: ChatMessage) => void): () => void {
    this.emitter.on("msg", fn);
    return () => this.emitter.off("msg", fn);
  }
}
