import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage, ModRequest } from "@app/shared";
import { usePlatform } from "../state/usePlatform";
import { useToasts } from "../state/toasts";
import { useDashboard } from "../state/DashboardProvider";

// timeout presets — labels the operator thinks in, not raw seconds. (Kick moderates in
// minutes with a 1-min floor, so "15s" lands as 1 min there; the server clamps.)
const DURATIONS: { label: string; secs: number }[] = [
  { label: "15s", secs: 15 },
  { label: "1m", secs: 60 },
  { label: "10m", secs: 600 },
  { label: "1h", secs: 3600 },
  { label: "1d", secs: 86_400 },
];

const MENU_W = 236;
const MENU_H = 312;
// safety cap on a single "delete all" sweep, so one click can't fire hundreds of requests
const PURGE_CAP = 80;

/** Per-user moderation menu — consolidates timeout / ban / unban / delete into one labeled
 *  popover (replacing the cramped ✕ ⏲ ⛔ glyphs). Destructive actions (ban, delete-all)
 *  require a second, explicit confirming click. Mods only; the server re-verifies the role
 *  and the channel-mod status, so this is a convenience layer, not the security boundary. */
export function ModMenu({ m }: { m: ChatMessage }) {
  const { mod } = usePlatform();
  const { push } = useToasts();
  const { messages } = useDashboard();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<"ban" | "purge" | null>(null);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const name = m.author.displayName || m.author.username;
  const uid = m.author.platformUserId;
  const platLabel = m.platform === "kick" ? "Kick" : "Twitch";

  const open = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // anchor under the trigger, right-aligned; flip above if it would overflow the viewport
    const x = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    const y = r.bottom + MENU_H > window.innerHeight ? Math.max(8, r.top - MENU_H) : r.bottom + 6;
    setPos({ x, y });
    setConfirm(null);
  };
  const close = () => {
    setPos(null);
    setConfirm(null);
    setReason("");
  };

  // Escape closes (matches the rest of the app's overlays)
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pos]);

  const run = async (action: Parameters<typeof mod>[0]["action"], successMsg: string, undo?: ModRequest) => {
    setBusy(true);
    const r = await mod(
      { channel: m.channel, targetUserId: uid, targetName: name, platformMsgId: m.platformMsgId, action },
      { successMsg, ...(undo ? { undo } : {}) },
    );
    setBusy(false);
    if (r.ok) close();
  };

  const reasonField = reason.trim() ? { reason: reason.trim() } : {};
  // ban + timeout get an Undo (an unban reverses both on Twitch/Kick)
  const undoReq: ModRequest = { channel: m.channel, targetUserId: uid, targetName: name, action: { kind: "unban" } };
  const timeout = (secs: number, label: string) =>
    run({ kind: "timeout", seconds: secs, ...reasonField }, `Timed out ${name} · ${label}`, undoReq);
  const ban = () => run({ kind: "ban", ...reasonField }, `Banned ${name}`, undoReq);
  const unban = () => run({ kind: "unban" }, `Unbanned ${name}`);
  const del = () => run({ kind: "delete" }, "Message deleted");

  // delete every recent message from this user in this channel — the real instinct when a
  // spammer floods (vs. whacking one message at a time). Fires silently, then one summary.
  const purge = async () => {
    setBusy(true);
    const targets = messages
      .filter(
        (x) =>
          x.platform === m.platform &&
          x.channel === m.channel &&
          x.platformMsgId &&
          (uid ? x.author.platformUserId === uid : x.author.username === m.author.username),
      )
      .slice(-PURGE_CAP);
    let ok = 0;
    for (const x of targets) {
      const r = await mod({ channel: x.channel, platformMsgId: x.platformMsgId, action: { kind: "delete" } }, { silent: true });
      if (r.ok) ok++;
    }
    setBusy(false);
    push({ title: `✓ Deleted ${ok} message${ok === 1 ? "" : "s"} from ${name}`, kind: "info" });
    close();
  };

  return (
    <>
      <button
        ref={btnRef}
        className={`act act-mod ${pos ? "act-on" : ""}`}
        title={`Moderate ${name}`}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={() => (pos ? close() : open())}
      >
        ⚖
      </button>
      {pos &&
        createPortal(
          <>
            <div className="mod-backdrop" onClick={close} />
            <div className="mod-menu" style={{ left: pos.x, top: pos.y }} role="menu">
              <div className="mm-head">
                <span className={`pill ${m.platform}`}>{platLabel}</span>
                <span className="mm-name">{name}</span>
              </div>
              <div className="mm-handle">@{m.author.username}</div>

              <input
                className="mm-reason"
                placeholder="reason (optional)"
                value={reason}
                maxLength={120}
                onChange={(e) => setReason(e.target.value)}
              />

              <div className="mm-label">Timeout</div>
              <div className="mm-chips">
                {DURATIONS.map((d) => (
                  <button key={d.secs} className="mm-chip" disabled={busy} onClick={() => timeout(d.secs, d.label)}>
                    {d.label}
                  </button>
                ))}
              </div>

              {m.platformMsgId && (
                <button className="mm-row" disabled={busy} onClick={del}>
                  Delete message
                </button>
              )}
              <button
                className={`mm-row mm-danger ${confirm === "purge" ? "mm-armed" : ""}`}
                disabled={busy}
                onClick={() => (confirm === "purge" ? purge() : setConfirm("purge"))}
              >
                {confirm === "purge" ? "Confirm — delete all" : "Delete all from user"}
              </button>

              <div className="mm-sep" />

              <button
                className={`mm-row mm-danger ${confirm === "ban" ? "mm-armed" : ""}`}
                disabled={busy}
                onClick={() => (confirm === "ban" ? ban() : setConfirm("ban"))}
              >
                {confirm === "ban" ? "Confirm — ban" : "Ban from channel"}
              </button>
              <button className="mm-row" disabled={busy} onClick={unban}>
                Unban
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
