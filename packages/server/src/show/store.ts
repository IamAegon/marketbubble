import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Episode, EpisodeDraft, EpisodeStatus } from "@app/shared";

const id = () => randomUUID().slice(0, 8);
const STATUSES: EpisodeStatus[] = ["planned", "live", "done"];

/** Persisted show schedule — past episodes + the forward plan. */
export class ShowStore {
  private items: Episode[] = [];

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try {
        this.items = JSON.parse(readFileSync(path, "utf8")) as Episode[];
      } catch {
        /* ignore */
      }
    }
    if (this.items.length === 0) this.seed();
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.items, null, 2));
    } catch {
      /* ignore */
    }
  }

  private seed(): void {
    const now = Date.now();
    const day = 86_400_000;
    this.items = [
      {
        id: id(),
        title: "Friday Markets Show — Ansem",
        scheduledAt: now + 3 * day,
        status: "planned",
        guests: [{ name: "Ansem", handle: "blknoiz06", note: "calls live on air" }],
        topics: ["BTC range + ETF flows", "Alt rotation: HYPE / VVV", "Polymarket: rate-cut odds", "Viewer trade calls"],
        notes: "Cold open with last week's portfolio result.",
        createdBy: "system",
        createdAt: now,
      },
      {
        id: id(),
        title: "Macro Monday",
        scheduledAt: now - 4 * day,
        status: "done",
        guests: [{ name: "Cobie", handle: "cobie" }],
        topics: ["CPI reaction", "DXY + yields", "Sentiment check (AAII)"],
        notes: "Big reaction on the CPI print segment.",
        createdBy: "system",
        createdAt: now - 5 * day,
      },
    ];
    this.persist();
  }

  list(): Episode[] {
    return [...this.items].sort((a, b) => a.scheduledAt - b.scheduledAt);
  }
  get(eid: string): Episode | undefined {
    return this.items.find((e) => e.id === eid);
  }

  create(draft: EpisodeDraft, createdBy: string): Episode {
    const e: Episode = {
      id: id(),
      title: (draft.title || "Untitled show").trim().slice(0, 100),
      scheduledAt: draft.scheduledAt && draft.scheduledAt > 0 ? draft.scheduledAt : Date.now(),
      status: STATUSES.includes(draft.status as EpisodeStatus) ? (draft.status as EpisodeStatus) : "planned",
      guests: Array.isArray(draft.guests) ? draft.guests.slice(0, 12) : [],
      topics: Array.isArray(draft.topics) ? draft.topics.slice(0, 30) : [],
      notes: draft.notes?.slice(0, 2000),
      createdBy,
      createdAt: Date.now(),
    };
    this.items.push(e);
    this.persist();
    return e;
  }

  update(eid: string, draft: EpisodeDraft): Episode | undefined {
    const e = this.get(eid);
    if (!e) return undefined;
    if (draft.title != null) e.title = draft.title.trim().slice(0, 100);
    if (draft.scheduledAt != null && draft.scheduledAt > 0) e.scheduledAt = draft.scheduledAt;
    if (draft.status && STATUSES.includes(draft.status)) e.status = draft.status;
    if (Array.isArray(draft.guests)) e.guests = draft.guests.slice(0, 12);
    if (Array.isArray(draft.topics)) e.topics = draft.topics.slice(0, 30);
    if (draft.notes != null) e.notes = draft.notes.slice(0, 2000);
    this.persist();
    return e;
  }

  remove(eid: string): boolean {
    const n = this.items.length;
    this.items = this.items.filter((e) => e.id !== eid);
    const removed = this.items.length < n;
    if (removed) this.persist();
    return removed;
  }
}
