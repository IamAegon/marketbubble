import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatSettings } from "@app/shared";
import { usePlatform } from "../state/usePlatform";
import { getChatSettings } from "../lib/platform";

const MENU_W = 244;
const MENU_H = 330;

const DEFAULTS: ChatSettings = { slow: false, slowSecs: 30, followers: false, followersMins: 0, subs: false, emote: false };
const SLOW_PRESETS = [5, 30, 120]; // seconds
const FOLLOW_PRESETS = [0, 10, 60, 1440]; // minutes (0 = any follower)

const fmtSecs = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60}m` : `${s}s`);
const fmtMins = (m: number) =>
  m === 0 ? "any" : m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`;

/** Channel control bar — the slow / followers-only / subs-only / emote-only modes and
 *  Clear chat. These exist server-side (Twitch chat settings) but had no UI. Twitch-only;
 *  the bar isn't mounted for Kick columns (its API rejects modes + clear). Toggles reflect
 *  the channel's live state, read on open; Clear chat is confirm-gated. */
export function ChannelControls({ channel, label }: { channel: string; label: string }) {
  const { mod } = usePlatform();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [s, setS] = useState<ChatSettings>(DEFAULTS);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const open = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    const y = r.bottom + MENU_H > window.innerHeight ? Math.max(8, r.top - MENU_H) : r.bottom + 6;
    setPos({ x, y });
    setConfirmClear(false);
  };
  const close = () => {
    setPos(null);
    setConfirmClear(false);
  };

  // read live modes when the menu opens, so toggles show reality (not guesses)
  useEffect(() => {
    if (!pos) return;
    let alive = true;
    setLoadErr(null);
    getChatSettings(channel).then((r) => {
      if (!alive) return;
      if (r.ok && r.settings) setS(r.settings);
      else setLoadErr(r.error || "couldn't read current modes");
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [pos, channel]);

  // optimistic flip + fire; revert on failure (mod() already toasts the error)
  const apply = async (
    patch: Partial<ChatSettings>,
    action: Parameters<typeof mod>[0]["action"],
    successMsg: string,
  ) => {
    const prev = s;
    setS({ ...s, ...patch });
    setBusy(true);
    const r = await mod({ channel, action }, { successMsg });
    setBusy(false);
    if (!r.ok) setS(prev);
  };

  const toggleSlow = () =>
    apply(
      { slow: !s.slow },
      { kind: "mode", mode: "slow", enabled: !s.slow, seconds: s.slowSecs },
      !s.slow ? `Slow mode · ${fmtSecs(s.slowSecs)}` : "Slow mode off",
    );
  const slowPreset = (secs: number) =>
    apply({ slow: true, slowSecs: secs }, { kind: "mode", mode: "slow", enabled: true, seconds: secs }, `Slow mode · ${fmtSecs(secs)}`);
  const toggleFollowers = () =>
    apply(
      { followers: !s.followers },
      { kind: "mode", mode: "followers", enabled: !s.followers, seconds: s.followersMins * 60 },
      !s.followers ? "Followers-only on" : "Followers-only off",
    );
  const followersPreset = (mins: number) =>
    apply(
      { followers: true, followersMins: mins },
      { kind: "mode", mode: "followers", enabled: true, seconds: mins * 60 },
      `Followers-only · ${fmtMins(mins)}`,
    );
  const toggleSubs = () =>
    apply({ subs: !s.subs }, { kind: "mode", mode: "subs", enabled: !s.subs }, !s.subs ? "Subscribers-only on" : "Subscribers-only off");
  const toggleEmote = () =>
    apply({ emote: !s.emote }, { kind: "mode", mode: "emote", enabled: !s.emote }, !s.emote ? "Emote-only on" : "Emote-only off");
  const clear = async () => {
    setBusy(true);
    const r = await mod({ channel, action: { kind: "clear" } }, { successMsg: "Chat cleared" });
    setBusy(false);
    if (r.ok) close();
  };

  const Toggle = ({ on, label: l, onClick }: { on: boolean; label: string; onClick: () => void }) => (
    <button className="mm-toggle" disabled={busy} onClick={onClick}>
      <span className="mm-toggle-lbl">{l}</span>
      <span className={`mm-state ${on ? "on" : ""}`}>{on ? "on" : "off"}</span>
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        className={`col-mod ${pos ? "on" : ""}`}
        title="Chat modes — slow / followers / subs / emote"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={() => (pos ? close() : open())}
      >
        ⚙
      </button>
      {pos &&
        createPortal(
          <>
            <div className="mod-backdrop" onClick={close} />
            <div className="mod-menu" style={{ left: pos.x, top: pos.y }} role="menu">
              <div className="mm-head">
                <span className="pill twitch">Twitch</span>
                <span className="mm-name">{label}</span>
              </div>
              <div className="mm-label">Chat modes</div>
              {loadErr && <div className="mm-handle">⚠ {loadErr}</div>}

              <Toggle on={s.slow} label="Slow mode" onClick={toggleSlow} />
              {s.slow && (
                <div className="mm-subchips">
                  {SLOW_PRESETS.map((secs) => (
                    <button key={secs} className={`mm-subchip ${s.slowSecs === secs ? "sel" : ""}`} disabled={busy} onClick={() => slowPreset(secs)}>
                      {fmtSecs(secs)}
                    </button>
                  ))}
                </div>
              )}

              <Toggle on={s.followers} label="Followers-only" onClick={toggleFollowers} />
              {s.followers && (
                <div className="mm-subchips">
                  {FOLLOW_PRESETS.map((mins) => (
                    <button
                      key={mins}
                      className={`mm-subchip ${s.followersMins === mins ? "sel" : ""}`}
                      disabled={busy}
                      onClick={() => followersPreset(mins)}
                    >
                      {fmtMins(mins)}
                    </button>
                  ))}
                </div>
              )}

              <Toggle on={s.subs} label="Subscribers-only" onClick={toggleSubs} />
              <Toggle on={s.emote} label="Emote-only" onClick={toggleEmote} />

              <div className="mm-sep" />
              <button
                className={`mm-row mm-danger ${confirmClear ? "mm-armed" : ""}`}
                disabled={busy}
                onClick={() => (confirmClear ? clear() : setConfirmClear(true))}
              >
                {confirmClear ? "Confirm — clear chat" : "Clear chat"}
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
