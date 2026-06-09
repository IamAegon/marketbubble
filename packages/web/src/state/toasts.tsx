import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface Toast {
  id: number;
  title: string;
  body?: string;
  kind?: "highlight" | "price-up" | "price-down" | "room" | "info";
  /** invoked when the toast is clicked (e.g. jump to the message) */
  onClick?: () => void;
  /** an inline action button (e.g. Undo) — runs, then dismisses the toast */
  action?: { label: string; run: () => void };
}
/** a kept entry in the notifications log (survives toast auto-dismiss) */
export interface NotifEntry extends Toast {
  at: number;
}
interface ToastApi {
  /** push an alert. `silent` logs it to the rail without showing the pop-up. */
  push: (t: Omit<Toast, "id">, silent?: boolean) => void;
  /** recent alerts, newest first — shown in the right-rail Notifications panel */
  log: NotifEntry[];
  clearLog: () => void;
  /** drop a single entry from the rail log */
  dismissLog: (id: number) => void;
}

const Ctx = createContext<ToastApi>({ push() {}, log: [], clearLog() {}, dismissLog() {} });
export const useToasts = () => useContext(Ctx);

/** In-app toast notifications (always visible, no OS permission needed). The
 * highlight/price bridges push here so alerts are seen even when the browser or
 * OS suppresses desktop notifications. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [log, setLog] = useState<NotifEntry[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((p) => p.filter((t) => t.id !== id)), []);
  const clearLog = useCallback(() => setLog([]), []);
  const dismissLog = useCallback((id: number) => setLog((p) => p.filter((n) => n.id !== id)), []);
  const push = useCallback((t: Omit<Toast, "id">, silent?: boolean) => {
    const id = ++idRef.current;
    const entry: NotifEntry = { ...t, id, at: Date.now() };
    // real alerts are always kept in the rail log so they can be reviewed later…
    if (entry.kind !== "info") setLog((p) => [entry, ...p].slice(0, 60)); // (not the test toast)
    // …but the transient pop-up is suppressed when this page opted out of it.
    if (silent) return;
    setToasts((p) => [...p, entry].slice(-4));
    window.setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 6500);
  }, []);

  return (
    <Ctx.Provider value={{ push, log, clearLog, dismissLog }}>
      {children}
      {createPortal(
        <div className="toast-host">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind ?? "info"} ${t.onClick ? "clickable" : ""}`}>
              <button
                className="toast-close"
                title="Dismiss"
                aria-label="Dismiss notification"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(t.id);
                }}
              >
                ✕
              </button>
              <div
                className="toast-main"
                role={t.onClick ? "button" : undefined}
                onClick={() => {
                  t.onClick?.();
                  dismiss(t.id);
                }}
              >
                <div className="toast-title">{t.title}</div>
                {t.body && <div className="toast-body">{t.body}</div>}
                {t.onClick && <div className="toast-go">Go to message →</div>}
              </div>
              {t.action && (
                <button
                  className="toast-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}
