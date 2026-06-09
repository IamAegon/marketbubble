import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ActionResult, ChatPost, ConnectStatus, ModRequest } from "@app/shared";
import { connectStatus, platformMod, platformPost } from "../lib/platform";
import { useAuth } from "./useAuth";
import { useToasts } from "./toasts";

interface PlatformApi {
  status: ConnectStatus | null;
  twitchLinked: boolean;
  kickLinked: boolean;
  refresh: () => void;
  /** send/reply to a connected platform chat as the linked user (toasts the result) */
  post: (req: ChatPost) => Promise<ActionResult>;
  /** moderate a connected platform chat. `successMsg` tailors the confirmation toast;
   *  `silent` suppresses it (e.g. a batched "delete all" that summarises itself);
   *  `undo` adds an Undo button to the toast that fires the reversing action. */
  mod: (req: ModRequest, opts?: { successMsg?: string; silent?: boolean; undo?: ModRequest }) => Promise<ActionResult>;
}

const Ctx = createContext<PlatformApi>({
  status: null,
  twitchLinked: false,
  kickLinked: false,
  refresh: () => {},
  post: async () => ({ ok: false }),
  mod: async () => ({ ok: false }),
});

export const usePlatform = () => useContext(Ctx);

/** Holds linked-account status + the post/moderate actions, so message rows and
 * the composer can act without each importing auth/api. Mount inside ToastProvider. */
export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { push } = useToasts();
  const [status, setStatus] = useState<ConnectStatus | null>(null);

  const refresh = useCallback(() => {
    if (!user) {
      setStatus(null);
      return;
    }
    connectStatus()
      .then(setStatus)
      .catch(() => {});
  }, [user]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const post = useCallback(
    async (req: ChatPost) => {
      const r = await platformPost(req);
      push(r.ok ? { title: "✓ Sent to chat", kind: "info" } : { title: "Couldn't send", body: r.error, kind: "info" });
      return r;
    },
    [push],
  );

  const mod = useCallback(
    async (req: ModRequest, opts?: { successMsg?: string; silent?: boolean; undo?: ModRequest }) => {
      const r = await platformMod(req);
      if (!opts?.silent) {
        if (r.ok) {
          push({
            title: opts?.successMsg ? `✓ ${opts.successMsg}` : "✓ Done",
            kind: "info",
            // a short grace period to reverse a ban/timeout before the toast dismisses
            ...(opts?.undo
              ? {
                  action: {
                    label: "Undo",
                    run: () => {
                      const undoReq = opts.undo!;
                      platformMod(undoReq).then((u) =>
                        push(u.ok ? { title: "✓ Reversed", kind: "info" } : { title: "Undo failed", body: u.error, kind: "info" }),
                      );
                    },
                  },
                }
              : {}),
          });
        } else {
          push({ title: "Action failed", body: r.error, kind: "info" });
        }
      }
      return r;
    },
    [push],
  );

  return (
    <Ctx.Provider
      value={{ status, twitchLinked: !!status?.twitch.linked, kickLinked: !!status?.kick.linked, refresh, post, mod }}
    >
      {children}
    </Ctx.Provider>
  );
}
