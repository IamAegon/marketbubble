import { ulid } from "ulid";
import type { ChatMessage, Platform } from "@app/shared";
import type { Pipeline } from "../pipeline/ingest.js";
import { logger } from "../observability/logger.js";

// strip ASCII control characters without embedding literal control chars in source
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

export interface CaptionSeg {
  channel: string;
  text: string;
  start?: number;
  end?: number;
  conf?: number;
}

/** Resolve a connector id (chat channel) to the public stream URL the Python
 * worker pulls audio from. Only platforms with fetchable HLS are supported. */
function streamUrl(connectorId: string): { url: string; platform: Platform; login: string } | null {
  const m = connectorId.match(/^(twitch|kick):#?(.+)$/);
  if (!m) return null;
  const platform = m[1] as Platform;
  const login = m[2]!;
  if (platform === "twitch") return { url: `https://twitch.tv/${login}`, platform, login };
  return { url: `https://kick.com/${login}`, platform, login };
}

/**
 * Orchestrates the Python transcription worker: starts/stops per-stream jobs and
 * ingests the captions it posts back as `kind:'caption'` messages on the same
 * channel as the stream's chat (so they're time-aligned, searchable, and feed
 * the Performance Lab). The heavy STT lives in `packages/transcriber`.
 */
export class TranscriptionManager {
  private active = new Map<string, { since: number; label: string }>();
  private seq = 0;

  constructor(
    private readonly deps: {
      pipeline: Pipeline;
      workerUrl: string;
      callbackUrl: string;
      /** durable transcript sink (captions persisted as first-class rows) */
      captions?: { put(c: import("../store/CaptionStore.js").CaptionRow): void };
      /** resolve the open session a caption belongs to (FK link) */
      resolveSession?: (channel: string, label: string) => { sessionId: string; streamerId: string } | undefined;
    },
  ) {}

  supports(connectorId: string): boolean {
    return !!streamUrl(connectorId);
  }

  async start(connectorId: string, label?: string): Promise<{ ok: boolean; error?: string }> {
    const s = streamUrl(connectorId);
    if (!s) return { ok: false, error: "only Twitch/Kick streams can be transcribed" };
    if (this.active.has(connectorId)) return { ok: true };
    try {
      const r = await fetch(`${this.deps.workerUrl}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: connectorId, url: s.url, callback: this.deps.callbackUrl }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return { ok: false, error: `worker ${r.status}` };
      this.active.set(connectorId, { since: Date.now(), label: label ?? s.login });
      logger.info({ connectorId, url: s.url }, "transcription started");
      return { ok: true };
    } catch {
      return { ok: false, error: "transcriber offline — run packages/transcriber" };
    }
  }

  async stop(connectorId: string): Promise<{ ok: boolean }> {
    this.active.delete(connectorId);
    try {
      await fetch(`${this.deps.workerUrl}/jobs/${encodeURIComponent(connectorId)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      /* worker may be gone; local state already cleared */
    }
    return { ok: true };
  }

  list(): { connector: string; since: number; label: string }[] {
    return [...this.active.entries()].map(([connector, v]) => ({ connector, ...v }));
  }

  async health(): Promise<{ online: boolean; model?: string; device?: string; jobs?: unknown[] }> {
    try {
      const r = await fetch(`${this.deps.workerUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { online: false };
      const data = (await r.json()) as { jobs?: { channel: string }[] };
      // reconcile: a job can end on its own (stream offline / intermission), so
      // drop active entries the worker no longer runs — keeps the toggle honest.
      // the worker's job list is the source of truth — sync `active` both ways so
      // the toggle stays correct across Node restarts and jobs that end on their own.
      const live = new Set((data.jobs ?? []).map((j) => j.channel));
      for (const c of [...this.active.keys()]) if (!live.has(c)) this.active.delete(c);
      for (const j of data.jobs ?? []) {
        if (!this.active.has(j.channel)) {
          const s = streamUrl(j.channel);
          this.active.set(j.channel, { since: Date.now(), label: s?.login ?? j.channel });
        }
      }
      return { online: true, ...data };
    } catch {
      return { online: false };
    }
  }

  /** Build + ingest a caption segment as a message on the stream's channel. */
  ingest(seg: CaptionSeg): boolean {
    const channel = String(seg.channel || "");
    const text = String(seg.text || "").replace(CONTROL_CHARS, " ").trim().slice(0, 600);
    if (!channel || !text) return false;
    const s = streamUrl(channel);
    const platform = (s?.platform ?? "twitch") as Platform;
    const label = this.active.get(channel)?.label ?? s?.login ?? channel;
    const start = seg.start && seg.start > 0 ? seg.start : Date.now();
    // include end + a monotonic counter so two captions in the same ms can't
    // collide and get dropped by the deduper
    const end = seg.end && seg.end > 0 ? seg.end : start;
    const m: ChatMessage = {
      id: ulid(),
      platform,
      platformMsgId: `cap:${channel}:${start}:${end}:${++this.seq}`,
      channel,
      channelLabel: label,
      author: { username: "transcript", displayName: "◴ Transcript", color: "#9aa0a6" },
      text,
      timestamp: start,
      receivedAt: Date.now(),
      kind: "caption",
      ...(typeof seg.conf === "number" ? { conf: seg.conf } : {}),
    };
    this.deps.pipeline.ingest(channel, m);
    // persist as a first-class transcript row, FK-linked to the open session (if any)
    if (this.deps.captions) {
      const sess = this.deps.resolveSession?.(channel, label);
      this.deps.captions.put({
        id: m.id,
        channel,
        sessionId: sess?.sessionId,
        streamerId: sess?.streamerId,
        text,
        conf: seg.conf,
        startMs: start,
        endMs: end,
        receivedAt: m.receivedAt,
      });
    }
    return true;
  }
}
