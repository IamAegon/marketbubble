import { useEffect, useState } from "react";
import type { ModLogEntry } from "@app/shared";
import { getModLog } from "./platform";
import { useAuth } from "../state/useAuth";

/** Poll the moderation audit log (mods/admins only). Teammates' actions show within one
 *  `everyMs` cycle; non-mods get nothing (the endpoint 403s anyway). */
export function useModLog(everyMs = 10_000): ModLogEntry[] {
  const { user } = useAuth();
  const isMod = user?.role === "mod" || user?.role === "admin";
  const [entries, setEntries] = useState<ModLogEntry[]>([]);
  useEffect(() => {
    if (!isMod) {
      setEntries([]);
      return;
    }
    let alive = true;
    const load = () =>
      getModLog(100)
        .then((e) => alive && setEntries(e))
        .catch(() => {});
    load();
    const t = window.setInterval(load, everyMs);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [isMod, everyMs]);
  return entries;
}
