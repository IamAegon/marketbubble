import type { SessionRecorder } from "./SessionRecorder.js";
import type { StreamerRegistry } from "./streamers.js";
import type { TranscriptionManager } from "../transcribe/TranscriptionManager.js";
import { logger } from "../observability/logger.js";

const DEFAULT_GRACE_MS = 3 * 60_000; // keep a session open this long after going offline

/**
 * Turns live-state into sessions automatically — no manual record button. Each
 * viewer-poll tick reports which connectors are live; the driver maps those to
 * streamers and:
 *  - opens a session when an opted-in streamer goes live (`recordSessions` on),
 *  - closes it on a *debounced* offline (brief drop-outs don't fragment a stream),
 *  - starts/stops transcription for streamers with `transcribe` on.
 * A mod can still start/stop manually (the SessionRecorder) as an override.
 */
export class SessionDriver {
  private live = new Set<string>(); // streamer ids currently considered live
  private offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly deps: {
      streamers: StreamerRegistry;
      sessions: SessionRecorder;
      transcription?: TranscriptionManager;
      graceMs?: number;
    },
  ) {}

  /** called each poll tick with the connector ids the platform APIs report live */
  onLive(liveConnectorIds: string[]): void {
    // map live connectors → { streamerId → live connector ids }
    const liveByStreamer = new Map<string, string[]>();
    for (const cid of liveConnectorIds) {
      const ref = this.deps.streamers.resolve(cid, cid);
      const arr = liveByStreamer.get(ref.id) ?? [];
      arr.push(cid);
      liveByStreamer.set(ref.id, arr);
    }

    // newly-live streamers → open (debounced-offline cancelled)
    for (const [sid, conns] of liveByStreamer) {
      this.cancelOffline(sid);
      if (!this.live.has(sid)) {
        this.live.add(sid);
        this.onStreamerLive(sid, conns);
      }
    }
    // streamers that dropped out of the live set → schedule a debounced close
    for (const sid of this.live) {
      if (!liveByStreamer.has(sid)) this.scheduleOffline(sid);
    }
  }

  private onStreamerLive(sid: string, liveConns: string[]): void {
    const s = this.deps.streamers.get(sid);
    if (!s) return; // unregistered (synthetic ext:*) — external opt-in registers first
    const record = s.recordSessions ?? s.owned;
    if (record && !this.deps.sessions.isRecording(sid)) {
      const r = this.deps.sessions.start(sid, "auto");
      if (r.ok) logger.info({ streamer: sid }, "auto-session started (stream live)");
    }
    if (s.transcribe && this.deps.transcription) {
      for (const cid of liveConns) void this.deps.transcription.start(cid);
    }
  }

  private scheduleOffline(sid: string): void {
    if (this.offlineTimers.has(sid)) return;
    const t = setTimeout(() => {
      this.offlineTimers.delete(sid);
      this.live.delete(sid);
      void this.onStreamerOffline(sid);
    }, this.deps.graceMs ?? DEFAULT_GRACE_MS);
    t.unref?.();
    this.offlineTimers.set(sid, t);
  }

  private cancelOffline(sid: string): void {
    const t = this.offlineTimers.get(sid);
    if (t) {
      clearTimeout(t);
      this.offlineTimers.delete(sid);
    }
  }

  private async onStreamerOffline(sid: string): Promise<void> {
    const active = this.deps.sessions.activeSessionIdForStreamer(sid);
    if (active) {
      await this.deps.sessions.stop(active);
      logger.info({ streamer: sid }, "auto-session stopped (stream offline)");
    }
    const s = this.deps.streamers.get(sid);
    if (s?.transcribe && this.deps.transcription) {
      for (const c of s.channels) void this.deps.transcription.stop(c.channel);
    }
  }
}
