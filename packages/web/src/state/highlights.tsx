import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const KEY = "mb.highlights.v1";

export interface HighlightsApi {
  terms: string[];
  add: (t: string) => void;
  remove: (t: string) => void;
  match: (text: string) => boolean;
}

const Ctx = createContext<HighlightsApi>({ terms: [], add() {}, remove() {}, match: () => false });
export const useHighlights = () => useContext(Ctx);

export function HighlightsProvider({ children }: { children: ReactNode }) {
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
