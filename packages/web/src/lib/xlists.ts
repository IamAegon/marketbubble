// User-defined X feed "lists" — named groupings of tracked-account handles, so the
// feed can be filtered to a subset. Persisted per-browser (localStorage); server-
// shared lists would be a follow-up.
const KEY = "mb.xlists.v1";

export interface XList {
  id: string;
  name: string;
  /** tracked-account handles (lowercase, no @) in this list */
  handles: string[];
}

/** Built-in lists shown by default (merged ahead of the user's own). */
const BUILTIN: XList[] = [{ id: "mb-default", name: "MarketBubble", handles: ["marketbubble", "blknoiz06", "banks"] }];

export function getLists(): XList[] {
  let stored: XList[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    stored = raw ? (JSON.parse(raw) as XList[]) : [];
  } catch {
    stored = [];
  }
  const ids = new Set(stored.map((l) => l.id));
  return [...BUILTIN.filter((b) => !ids.has(b.id)), ...stored];
}

function save(lists: XList[]): XList[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(lists));
  } catch {
    /* quota / disabled — keep in-memory only */
  }
  return lists;
}

const norm = (h: string) => h.trim().replace(/^@/, "").toLowerCase();

export function createList(name: string, handles: string[]): XList[] {
  const id = `l${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return save([...getLists(), { id, name: name.trim() || "Untitled list", handles: handles.map(norm) }]);
}

export function updateList(id: string, patch: Partial<Omit<XList, "id">>): XList[] {
  return save(
    getLists().map((l) =>
      l.id === id ? { ...l, ...patch, handles: patch.handles ? patch.handles.map(norm) : l.handles } : l,
    ),
  );
}

export function deleteList(id: string): XList[] {
  return save(getLists().filter((l) => l.id !== id));
}
