import { useCallback, useEffect, useState } from "react";
import type { ChatMessage } from "@app/shared";

const KEY = "mb.saved.v2";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** A saved message with an optional inline note attached to it. */
export interface SavedItem {
  message: ChatMessage;
  note: string;
}

export interface SavedStore {
  items: SavedItem[];
  isSaved: (id: string) => boolean;
  hasNote: (id: string) => boolean;
  toggleSave: (m: ChatMessage) => void;
  /** ensure the message is saved so a note can be attached */
  addNote: (m: ChatMessage) => void;
  updateNote: (id: string, text: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export function useSaved(): SavedStore {
  const [items, setItems] = useState<SavedItem[]>(() => load<SavedItem[]>(KEY, []));

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items.slice(-500)));
  }, [items]);

  const toggleSave = useCallback((m: ChatMessage) => {
    setItems((prev) =>
      prev.some((i) => i.message.id === m.id)
        ? prev.filter((i) => i.message.id !== m.id)
        : prev.concat({ message: m, note: "" }),
    );
  }, []);

  const addNote = useCallback((m: ChatMessage) => {
    setItems((prev) =>
      prev.some((i) => i.message.id === m.id) ? prev : prev.concat({ message: m, note: "" }),
    );
  }, []);

  const updateNote = useCallback((id: string, text: string) => {
    setItems((prev) => prev.map((i) => (i.message.id === id ? { ...i, note: text } : i)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.message.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return {
    items,
    isSaved: (id) => items.some((i) => i.message.id === id),
    hasNote: (id) => {
      const it = items.find((i) => i.message.id === id);
      return !!it && it.note.trim().length > 0;
    },
    toggleSave,
    addNote,
    updateNote,
    remove,
    clear,
  };
}
