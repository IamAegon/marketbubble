import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Platform, StreamerInfo } from "@app/shared";
import { logger } from "../observability/logger.js";

export interface StreamerChannel {
  platform: Platform;
  /** connector/message channel id, e.g. "twitch:#fazebanks", "kick:ansem", "x:<broadcastId>" */
  channel: string;
}

export interface Streamer {
  id: string;
  name: string;
  /** true = a Market Bubble streamer (Ansem/Faze); false = external (compared, never mixed) */
  owned: boolean;
  channels: StreamerChannel[];
  /** auto-capture a session when live (default: owned→on, external→off) */
  recordSessions?: boolean;
  /** run live STT while live (opt-in, off by default) */
  transcribe?: boolean;
}

/** fill the capture settings with their defaults: record owned streams by
 * default (external is opt-in), transcription always opt-in. */
function withDefaults(s: Streamer): Streamer {
  return { ...s, recordSessions: s.recordSessions ?? s.owned, transcribe: s.transcribe ?? false };
}

/** Where an arbitrary message channel resolves to for analytics attribution. */
export interface StreamerRef {
  id: string;
  name: string;
  owned: boolean;
}

/** Owned = Market Bubble's streams. For now these are intentionally mapped to
 * currently-LIVE channels (Jynxzi / ESL CS on Twitch, SoloMission on Kick) so the
 * analytics + Compare views show real live data. When Ansem/Faze are live, switch
 * to PROD_SEED and delete data/streamers.json once (a stale file shadows the seed). */
const SEED: Streamer[] = [
  { id: "jynxzi", name: "Jynxzi", owned: true, channels: [{ platform: "twitch", channel: "twitch:#jynxzi" }] },
  { id: "eslcs", name: "ESL CS", owned: true, channels: [{ platform: "twitch", channel: "twitch:#eslcs" }] },
  { id: "solomission", name: "SoloMission", owned: true, channels: [{ platform: "kick", channel: "kick:solomission" }] },
];

/** Production owned streamers (Market Bubble's own) — use when Ansem/Faze are live.
 * Ansem's X broadcast id is ephemeral, so the mod attaches the live URL at
 * record-time via assignChannel. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PROD_SEED: Streamer[] = [
  {
    id: "ansem",
    name: "Ansem",
    owned: true,
    channels: [
      { platform: "kick", channel: "kick:ansem" },
      { platform: "x", channel: "x:1jxXggyQWrjJZ" },
    ],
  },
  { id: "faze", name: "FazeBanks", owned: true, channels: [{ platform: "twitch", channel: "twitch:#fazebanks" }] },
];
void PROD_SEED;

/**
 * Maps message channels to streamers and tracks owned vs external. Unmapped
 * channels resolve to a synthetic `ext:<channel>` streamer (labeled external)
 * so their metrics are recorded and comparable, but never mixed with ours.
 */
export class StreamerRegistry {
  private streamers = new Map<string, Streamer>();
  private byChannel = new Map<string, string>();

  constructor(private readonly persistPath?: string) {
    const initial = this.load();
    for (const s of initial) this.streamers.set(s.id, withDefaults(s));
    this.reindex();
    this.persist(); // materialize the seed so it's visible + editable on disk
  }

  private load(): Streamer[] {
    if (this.persistPath && existsSync(this.persistPath)) {
      try {
        const persisted = JSON.parse(readFileSync(this.persistPath, "utf8")) as Streamer[];
        // union: seed is the baseline, persisted overrides (keeps custom owned streamers)
        const byId = new Map(SEED.map((s) => [s.id, s]));
        for (const s of persisted) byId.set(s.id, s);
        return [...byId.values()];
      } catch (e) {
        logger.warn({ err: String(e) }, "failed to read streamers; using seed");
      }
    }
    return SEED;
  }

  private reindex(): void {
    this.byChannel.clear();
    for (const s of this.streamers.values()) {
      for (const c of s.channels) this.byChannel.set(c.channel, s.id);
    }
  }

  /** Attribute a message channel to a streamer (auto-external if unmapped). */
  resolve(channel: string, channelLabel: string): StreamerRef {
    const id = this.byChannel.get(channel);
    if (id) {
      const s = this.streamers.get(id)!;
      return { id: s.id, name: s.name, owned: s.owned };
    }
    return { id: `ext:${channel}`, name: channelLabel || channel, owned: false };
  }

  list(): StreamerInfo[] {
    return [...this.streamers.values()].map((s) => ({
      id: s.id,
      name: s.name,
      owned: s.owned,
      channels: s.channels,
      recordSessions: s.recordSessions ?? s.owned,
      transcribe: s.transcribe ?? false,
    }));
  }

  get(id: string): Streamer | undefined {
    return this.streamers.get(id);
  }

  /** update a streamer's capture settings (record-on-live / transcribe-on-live) */
  setSettings(id: string, patch: { recordSessions?: boolean; transcribe?: boolean }): Streamer | undefined {
    const s = this.streamers.get(id);
    if (!s) return undefined;
    if (typeof patch.recordSessions === "boolean") s.recordSessions = patch.recordSessions;
    if (typeof patch.transcribe === "boolean") s.transcribe = patch.transcribe;
    this.persist();
    return s;
  }

  /** Attach a channel to an existing streamer (e.g. mod assigns a live X URL to Ansem). */
  assignChannel(streamerId: string, platform: Platform, channel: string): boolean {
    const s = this.streamers.get(streamerId);
    if (!s) return false;
    if (!s.channels.some((c) => c.channel === channel)) s.channels.push({ platform, channel });
    this.byChannel.set(channel, streamerId);
    this.persist();
    return true;
  }

  upsert(s: Streamer): void {
    this.streamers.set(s.id, s);
    this.reindex();
    this.persist();
  }

  private persist(): void {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify([...this.streamers.values()], null, 2));
    } catch (e) {
      logger.warn({ err: String(e) }, "failed to persist streamers");
    }
  }
}
