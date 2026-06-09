import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDashboard } from "./DashboardProvider";
import { useAuth } from "./useAuth";

interface Profile {
  avatarUrl?: string;
  color?: string;
}
interface Api {
  get: (handle: string) => Profile | undefined;
}
const Ctx = createContext<Api>({ get: () => undefined });
export const useMbAvatar = () => useContext(Ctx);

/** Live directory of MB chatters' current avatar/color, keyed by handle. Lets old
 * messages re-render with a user's *current* avatar instead of the one baked in at
 * post time — so changing your avatar updates all your past messages. Seeded from the
 * message stream (latest avatar a handle posted with) + the signed-in user (instant). */
export function MbAvatarProvider({ children }: { children: ReactNode }) {
  const d = useDashboard();
  const { user } = useAuth();
  const map = useRef<Map<string, Profile>>(new Map());
  const [version, setVersion] = useState(0);

  // latest avatar/color each MB handle has posted with (for *other* chatters)
  useEffect(() => {
    let changed = false;
    for (const m of d.messages) {
      if (m.platform !== "mb") continue;
      const h = m.author.username.toLowerCase();
      const prev = map.current.get(h);
      if (!prev || prev.avatarUrl !== m.author.avatarUrl || prev.color !== m.author.color) {
        map.current.set(h, { avatarUrl: m.author.avatarUrl, color: m.author.color });
        changed = true;
      }
    }
    if (changed) setVersion((v) => v + 1);
  }, [d.messages]);

  // The signed-in user always resolves to their *live* profile — so changing your
  // avatar updates every past message instantly, and the message-stream map (which
  // holds the old baked-in value) can never override it.
  const api = useMemo<Api>(
    () => ({
      get: (h: string) => {
        const lh = h.toLowerCase();
        if (user && lh === user.handle.toLowerCase()) return { avatarUrl: user.avatarUrl, color: user.color };
        return map.current.get(lh);
      },
    }),
    [version, user?.handle, user?.avatarUrl, user?.color],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
