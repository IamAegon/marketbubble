import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const KEY = "mb.muted.v1";

export interface MutedApi {
  terms: string[];
  add: (t: string) => void;
  remove: (t: string) => void;
  /** true if the text contains a muted term (and should be hidden) */
  match: (text: string) => boolean;
}

const Ctx = createContext<MutedApi>({ terms: [], add() {}, remove() {}, match: () => false });
export const useMuted = () => useContext(Ctx);

/** Mod-side word filter: messages containing any muted term are hidden from the feed. */
export function MutedProvider({ children }: { children: ReactNode }) {
  const [terms, setTerms] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(terms));
  }, [terms]);

  const add = useCallback((t: string) => {
    const v = t.trim().toLowerCase();
    if (v) setTerms((p) => (p.includes(v) ? p : [...p, v]));
  }, []);
  const remove = useCallback((t: string) => setTerms((p) => p.filter((x) => x !== t)), []);
  const match = useCallback(
    (text: string) => {
      if (terms.length === 0) return false;
      const t = text.toLowerCase();
      return terms.some((term) => t.includes(term));
    },
    [terms],
  );

  const value = useMemo(() => ({ terms, add, remove, match }), [terms, add, remove, match]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
