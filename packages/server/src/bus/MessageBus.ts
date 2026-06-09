import type { ChatMessage } from "@app/shared";

export interface MessageBus {
  publish(m: ChatMessage): void;
  /** subscribe to all messages; returns an unsubscribe fn */
  subscribe(fn: (m: ChatMessage) => void): () => void;
}
