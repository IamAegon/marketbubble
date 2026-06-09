import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useDashboard } from "./DashboardProvider";
import { useHighlights } from "./highlights";
import { useToasts, type Toast } from "./toasts";
import { popupAllowed } from "./useLayout";
import { jumpToMessage } from "../lib/jumpBus";

/** Fires in-app toasts (+ desktop notifications if permitted) for highlight matches
 * and for Market Bubble room messages you aren't focused on. Clicking a toast jumps
 * to the message in whatever feed view is active. Renders nothing. */
export function NotificationBridge() {
  const d = useDashboard();
  const { match } = useHighlights();
  const { push } = useToasts();
  const nav = useNavigate();
  const lastId = useRef<string | null>(null);
  const lastFire = useRef(0);
  const lastRoomFire = useRef(0);

  const { notify, roomNotify, notifyPages } = d.layout;

  useEffect(() => {
    if (!notify && !roomNotify) return;
    const msgs = d.messages;
    if (msgs.length === 0) return;
    const latest = msgs[msgs.length - 1]!;
    if (lastId.current === null) {
      lastId.current = latest.id; // skip the initial backfill
      return;
    }
    if (latest.id === lastId.current) return;
    // search from the end — the marker is recent, so this is O(new) not O(2500)
    let idx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]!.id === lastId.current) {
        idx = i;
        break;
      }
    }
    const fresh = idx >= 0 ? msgs.slice(idx + 1) : [latest];
    lastId.current = latest.id;

    const now = Date.now();
    // fire the jump several times over ~1.5s so it still lands once the target view
    // has mounted + rendered the row (covers a cold Live feed / a just-switched view).
    const jumpRetry = (id: string) => {
      let n = 0;
      const tick = () => {
        jumpToMessage(id);
        if (++n < 8) window.setTimeout(tick, 180);
      };
      window.setTimeout(tick, 100);
    };
    const goto = (m: { id: string; platform: string; channel: string }) => {
      if (m.platform === "mb") {
        // room/DM messages live in the Rooms view, not Live
        d.setActiveRoom(m.channel);
        nav("/app/rooms");
      } else {
        // make sure the message's platform isn't filtered out of the Live feed
        if (!d.layout.platforms.includes(m.platform)) d.layout.togglePlatform(m.platform);
        nav("/app");
      }
      jumpRetry(m.id);
    };
    // `type` keys into notifyPages — if the current page opted out, the alert is
    // still logged to the rail (silent) but the pop-up + OS notification are skipped.
    const fire = (t: Omit<Toast, "id">, type: string) => {
      const allowed = popupAllowed(notifyPages, type);
      push(t, !allowed);
      if (allowed && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(t.title, { body: t.body, tag: t.kind });
        } catch {
          /* ignore */
        }
      }
    };

    // highlight matches
    if (notify && now - lastFire.current >= 4000) {
      const hit = fresh.find((m) => m.kind !== "post" && match(m.text));
      if (hit) {
        lastFire.current = now;
        fire(
          {
            title: `💬 ${hit.author.displayName} · ${hit.channelLabel}`,
            body: hit.text.slice(0, 140),
            kind: "highlight",
            onClick: () => goto(hit),
          },
          "highlight",
        );
      }
    }

    // Market Bubble room messages you aren't currently focused on
    if (roomNotify && now - lastRoomFire.current >= 2500) {
      const self = d.user?.handle?.toLowerCase();
      const rm = fresh.find(
        (m) => m.platform === "mb" && m.channel !== d.activeRoom && m.author.username.toLowerCase() !== self,
      );
      if (rm) {
        lastRoomFire.current = now;
        fire(
          {
            title: `# ${rm.channelLabel}`,
            body: `${rm.author.displayName}: ${rm.text.slice(0, 140)}`,
            kind: "room",
            onClick: () => goto(rm),
          },
          "room",
        );
      }
    }
  }, [d.messages, notify, roomNotify, notifyPages, match, d.activeRoom, d.user]);

  return null;
}
