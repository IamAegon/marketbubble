import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import type { ChatMessage, Platform } from "@app/shared";

export interface ChatterStat {
  count: number;
  perMin: number;
  firstSeen: number;
  lastSeen: number;
}
type StatsFor = (platform: Platform, username: string) => ChatterStat | null;

const Ctx = createContext<StatsFor>(() => null);
export const useChatterStats = () => useContext(Ctx);

/** Provides on-demand per-chatter stats by scanning the live message buffer
 * (only invoked when a hover card opens, so no per-message indexing cost). */
export function ChatterStatsProvider({ messages, children }: { messages: ChatMessage[]; children: ReactNode }) {
  const ref = useRef(messages);
  ref.current = messages;

  const statsFor = useCallback<StatsFor>((platform, username) => {
    const u = username.toLowerCase();
    const now = Date.now();
    let count = 0;
    let first = Infinity;
    let last = 0;
    let recent = 0;
    for (const m of ref.current) {
      if (m.platform !== platform || m.author.username.toLowerCase() !== u) continue;
      count++;
      if (m.receivedAt < first) first = m.receivedAt;
      if (m.receivedAt > last) last = m.receivedAt;
      if (now - m.receivedAt < 300_000) recent++;
    }
    if (count === 0) return null;
    return { count, perMin: recent / 5, firstSeen: first, lastSeen: last };
  }, []);

  return <Ctx.Provider value={statsFor}>{children}</Ctx.Provider>;
}
