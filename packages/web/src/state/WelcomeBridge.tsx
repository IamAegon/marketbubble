import { useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { useDashboard } from "./DashboardProvider";
import { useToasts } from "./toasts";

/** Greets the signed-in user once per session with their configurable welcome title
 * (Settings → Account & data). Skipped when the login Brief modal is enabled, since
 * that greets too. Renders nothing. */
export function WelcomeBridge() {
  const { user } = useAuth();
  const d = useDashboard();
  const { push } = useToasts();
  const greeted = useRef<string | null>(null);

  useEffect(() => {
    if (!user || greeted.current === user.id) return;
    if (d.layout.loginBrief) return; // the Brief modal handles the greeting
    greeted.current = user.id;
    const who = user.welcomeTitle?.trim() || user.displayName;
    push({ title: `👋 Welcome ${who}`, kind: "info" });
  }, [user?.id, d.layout.loginBrief]);

  return null;
}
