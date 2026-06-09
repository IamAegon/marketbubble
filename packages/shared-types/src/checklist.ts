/**
 * Pre-stream checklists — run-of-show tasks the team works through before going
 * live. Items can be assigned to a teammate and marked done, which broadcasts a
 * `team` event so everyone is notified in real time.
 */

export interface ChecklistItem {
  id: string;
  text: string;
  /** assigned teammate handle (lowercase) */
  assignee?: string;
  /** assignee display name (denormalized for rendering) */
  assigneeName?: string;
  done: boolean;
  doneBy?: string;
  doneAt?: number;
}

export interface Checklist {
  id: string;
  title: string;
  items: ChecklistItem[];
  createdBy: string;
  createdAt: number;
  archived?: boolean;
}

export interface ChecklistDraft {
  title: string;
}

/** A broadcast team-coordination event surfaced as a toast on every client. */
export interface TeamEvent {
  kind: "checklist-done" | "checklist-reopened" | "checklist-created" | "checklist-complete";
  title: string;
  body?: string;
  /** who triggered it (display name) */
  by?: string;
  checklistId?: string;
  at: number;
}
