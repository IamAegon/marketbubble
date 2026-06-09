import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Checklist, ChecklistItem } from "@app/shared";

const id = () => randomUUID().slice(0, 8);

/** Persisted pre-stream checklists (run-of-show tasks + assignments). */
export class ChecklistStore {
  private items: Checklist[] = [];

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try {
        this.items = JSON.parse(readFileSync(path, "utf8")) as Checklist[];
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

  /** A starter pre-stream checklist so the page is useful out of the box. */
  private seed(): void {
    const texts = [
      "Confirm guest + send green-room link",
      "Test audio levels (mic, desktop, guest)",
      "Push scene collection + check overlays",
      "Set stream title + thumbnail",
      "Drop go-live alert in MB shared room",
      "Queue talking points / charts",
      "Start recording + verify it's writing",
    ];
    this.items = [
      {
        id: id(),
        title: "Pre-stream checklist",
        createdBy: "system",
        createdAt: Date.now(),
        items: texts.map((text) => ({ id: id(), text, done: false })),
      },
    ];
    this.persist();
  }

  list(): Checklist[] {
    return this.items.filter((c) => !c.archived);
  }
  get(cid: string): Checklist | undefined {
    return this.items.find((c) => c.id === cid);
  }

  create(title: string, createdBy: string): Checklist {
    const c: Checklist = { id: id(), title: (title || "Checklist").trim().slice(0, 80), items: [], createdBy, createdAt: Date.now() };
    this.items.unshift(c);
    this.persist();
    return c;
  }

  remove(cid: string): boolean {
    const n = this.items.length;
    this.items = this.items.filter((c) => c.id !== cid);
    const removed = this.items.length < n;
    if (removed) this.persist();
    return removed;
  }

  addItem(cid: string, text: string, assignee?: string, assigneeName?: string): ChecklistItem | undefined {
    const c = this.get(cid);
    if (!c) return undefined;
    const t = (text || "").trim().slice(0, 200);
    if (!t) return undefined;
    const item: ChecklistItem = { id: id(), text: t, done: false, assignee: assignee?.toLowerCase(), assigneeName };
    c.items.push(item);
    this.persist();
    return item;
  }

  updateItem(cid: string, iid: string, patch: Partial<ChecklistItem>, byName?: string): ChecklistItem | undefined {
    const c = this.get(cid);
    const item = c?.items.find((x) => x.id === iid);
    if (!c || !item) return undefined;
    if (patch.text != null) item.text = patch.text.trim().slice(0, 200);
    if (patch.assignee !== undefined) {
      item.assignee = patch.assignee ? patch.assignee.toLowerCase() : undefined;
      item.assigneeName = patch.assignee ? patch.assigneeName : undefined;
    }
    if (patch.done !== undefined) {
      item.done = !!patch.done;
      if (item.done) {
        item.doneBy = byName;
        item.doneAt = Date.now();
      } else {
        item.doneBy = undefined;
        item.doneAt = undefined;
      }
    }
    this.persist();
    return item;
  }

  removeItem(cid: string, iid: string): boolean {
    const c = this.get(cid);
    if (!c) return false;
    const n = c.items.length;
    c.items = c.items.filter((x) => x.id !== iid);
    const removed = c.items.length < n;
    if (removed) this.persist();
    return removed;
  }
}
