import { useCallback, useEffect, useState } from "react";
import type { Platform, SessionSummary, StreamerInfo } from "@app/shared";
import { useAuth } from "../state/useAuth";
import { useDashboard } from "../state/DashboardProvider";
import { fetchSessions, fetchStreamers, fmtDuration, setStreamerSettings, startSession, stopSession } from "../lib/sessions";

const PLAT: Record<Platform, string> = { twitch: "Twitch", kick: "Kick", x: "X", mb: "MB" };

/** "Live & capturing" — recording is automatic now: the server opens a session
 * when a stream goes live and closes it when it ends. This strip shows that live
 * status and lets a mod configure per-stream capture (record / transcribe) and,
 * if needed, manually override (force start/stop). */
export function RecordingStrip() {
  const { user } = useAuth();
  const { liveStreams } = useDashboard();
  const isMod = user?.role === "mod" || user?.role === "admin";
  const [streamers, setStreamers] = useState<StreamerInfo[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const [st, se] = await Promise.all([fetchStreamers(), fetchSessions()]);
    setStreamers(st);
    setSessions(se);
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [refresh]);

  const activeFor = (id: string) => sessions.find((s) => s.status === "recording" && s.streamerId === id);
  const isLive = (s: StreamerInfo) => s.channels.some((c) => liveStreams.has(c.channel));

  const toggle = async (id: string, patch: { recordSessions?: boolean; transcribe?: boolean }) => {
    setBusy(id);
    setErr("");
    const r = await setStreamerSettings(id, patch);
    setBusy(null);
    if (!r.ok) setErr(`couldn't update: ${r.error ?? "failed"}`);
    refresh();
  };
  const onStart = async (s: StreamerInfo) => {
    setBusy(s.id);
    setErr("");
    const r = await startSession(s.id);
    setBusy(null);
    if (!r.ok) setErr(`${s.name}: ${r.error}`);
    refresh();
  };
  const onStop = async (sid: string) => {
    setBusy(sid);
    setErr("");
    await stopSession(sid);
    setBusy(null);
    refresh();
  };

  if (streamers.length === 0) return null;
  const recCount = sessions.filter((s) => s.status === "recording").length;
  const liveCount = streamers.filter(isLive).length;

  return (
    <div className="rec-strip">
      <div className="rec-strip-lead">
        <span className={`rec-dot ${recCount ? "" : "off"}`} />
        <span className="rec-strip-title">Live &amp; capturing</span>
        <span className="rec-strip-sub">
          {recCount ? `${recCount} recording` : liveCount ? `${liveCount} live` : "idle"} · auto
        </span>
      </div>
      <div className="rec-strip-row">
        {streamers.map((s) => {
          const act = activeFor(s.id);
          const live = isLive(s);
          const state = act ? "rec" : live ? "live" : "off";
          return (
            <div className={`rec-chip ${act ? "rec" : ""}`} key={s.id}>
              <span className={`spick-dot ${state}`} />
              <span className="rec-chip-name" title={s.channels.map((c) => PLAT[c.platform]).join(" · ")}>
                {s.name}
              </span>
              <span className={`spick-tag ${s.owned ? "" : "ext"}`}>{s.owned ? "MB" : "ext"}</span>
              {act && <span className="rec-chip-dur">{fmtDuration(Math.max(act.durationMs, now - act.startedAt))}</span>}
              {isMod ? (
                <>
                  <button
                    className={`rec-toggle ${s.recordSessions ? "on" : ""}`}
                    disabled={busy === s.id}
                    onClick={() => toggle(s.id, { recordSessions: !s.recordSessions })}
                    title={s.recordSessions ? "Auto-record on live: ON" : "Auto-record on live: OFF"}
                  >
                    Rec
                  </button>
                  <button
                    className={`rec-toggle ${s.transcribe ? "on" : ""}`}
                    disabled={busy === s.id}
                    onClick={() => toggle(s.id, { transcribe: !s.transcribe })}
                    title={s.transcribe ? "Transcribe on live: ON" : "Transcribe on live: OFF"}
                  >
                    STT
                  </button>
                  {act ? (
                    <button className="cc-chip sm danger" disabled={busy === act.id} onClick={() => onStop(act.id)} title="Stop now (override)">
                      ■
                    </button>
                  ) : (
                    <button className="cc-chip sm" disabled={busy === s.id} onClick={() => onStart(s)} title="Start now (override)">
                      ▶
                    </button>
                  )}
                </>
              ) : (
                <span className="rec-chip-state">{state === "rec" ? "recording" : state === "live" ? "live" : "offline"}</span>
              )}
            </div>
          );
        })}
      </div>
      {err && <div className="rec-strip-err">{err}</div>}
    </div>
  );
}
