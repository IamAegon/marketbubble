import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useToasts } from "./toasts";
import { popupAllowed } from "./useLayout";
import { useDashboard } from "./DashboardProvider";
import { onTeamEvent } from "../lib/teamBus";

/** Surfaces broadcast team events (checklist completions etc.) as toasts on every
 * client — this is the "notifies everyone" path. Clicking opens the checklist. */
export function TeamBridge() {
  const { push } = useToasts();
  const d = useDashboard();
  const nav = useNavigate();
  // read live page-gating prefs inside the callback so we subscribe only once
  const npRef = useRef(d.layout.notifyPages);
  npRef.current = d.layout.notifyPages;
  useEffect(() => {
    return onTeamEvent((e) => {
      const allowed = popupAllowed(npRef.current, "room");
      push(
        {
          title: e.title,
          body: e.body,
          kind: e.kind === "checklist-complete" ? "highlight" : "room",
          onClick: () => nav("/app/studio/run"),
        },
        !allowed,
      );
      if (allowed && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(e.title, { body: e.body, tag: "mb-team" });
        } catch {
          /* ignore */
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
