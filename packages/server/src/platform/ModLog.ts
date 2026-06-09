import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ulid } from "ulid";
import type { ModLogEntry } from "@app/shared";
import { logger } from "../observability/logger.js";

const CAP = 500;

/** Append-only audit log of moderation actions (who did what to whom, when, why) — for
 *  team accountability + review. Capped + persisted to a JSON file so it survives restarts. */
export class ModLog {
  private entries: ModLogEntry[] = [];

  constructor(private readonly persistPath?: string) {
    if (persistPath && existsSync(persistPath)) {
      try {
        const raw = JSON.parse(readFileSync(persistPath, "utf8"));
        if (Array.isArray(raw)) this.entries = raw;
      } catch {
        /* start fresh on a corrupt file */
      }
    }
  }

  record(e: Omit<ModLogEntry, "id" | "at">): ModLogEntry {
    const entry: ModLogEntry = { ...e, id: ulid(), at: Date.now() };
    this.entries.push(entry);
    if (this.entries.length > CAP) this.entries.splice(0, this.entries.length - CAP);
    this.persist();
    return entry;
  }

  /** most recent entries, newest-first */
  list(limit = 100): ModLogEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  private persist(): void {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(this.entries));
    } catch (e) {
      logger.warn({ err: String(e) }, "mod log persist failed");
    }
  }
}
