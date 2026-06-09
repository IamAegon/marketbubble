import type { ChatMessage } from "@app/shared";
import { LruSet } from "../util.js";

/** Rejects repeat (platform, platformMsgId) within a bounded window. */
export class Deduper {
  private seen: LruSet;
  constructor(window = 20_000) {
    this.seen = new LruSet(window);
  }

  /** returns true if the message is fresh (not a duplicate) */
  accept(m: ChatMessage): boolean {
    return this.seen.add(`${m.platform}:${m.platformMsgId}`);
  }
}
