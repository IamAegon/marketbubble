import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ConnectorInfo, Platform } from "@app/shared";
import type { Connector } from "./Connector.js";
import { SupervisedConnector } from "./SupervisedConnector.js";
import type { Pipeline } from "../pipeline/ingest.js";
import type { HealthRegistry } from "../observability/health.js";
import { TwitchIrcConnector } from "./twitch/TwitchIrcConnector.js";
import { XGuestAuth } from "./x/xGuestAuth.js";
import { XLiveChatConnector } from "./x/XLiveChatConnector.js";
import { KickPusherConnector } from "./kick/KickPusherConnector.js";
import { logger } from "../observability/logger.js";

export interface SourceSpec {
  platform: Platform;
  /** twitch login, kick slug, or x broadcast url/id */
  value: string;
  label?: string;
  chatroomId?: number;
}

export interface ManagerDeps {
  pipeline: Pipeline;
  health: HealthRegistry;
  x: { bearer: string; userAgent: string; authToken?: string };
  kick: { chromeBin: string; pusherKey: string; cluster: string };
  onStatus: (info: ConnectorInfo) => void;
  persistPath?: string;
}

/**
 * Normalize raw user input into a clean {platform, value}. Accepts full URLs
 * (auto-detecting the platform) or bare handles/slugs/ids. So pasting
 * "https://kick.com/asmongold" works regardless of the dropdown selection.
 */
export function normalizeSource(platformHint: Platform, raw: string): { platform: Platform; value: string } {
  const v = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = v.match(/kick\.com\/([^/?#\s]+)/i))) return { platform: "kick", value: m[1]!.toLowerCase() };
  if ((m = v.match(/twitch\.tv\/([^/?#\s]+)/i))) return { platform: "twitch", value: m[1]!.toLowerCase() };
  if ((m = v.match(/(?:x|twitter)\.com\/i\/broadcasts\/([A-Za-z0-9]+)/i)))
    return { platform: "x", value: m[1]! };
  // no recognizable URL: trust the dropdown, strip leading @/#
  if (platformHint === "x") return { platform: "x", value: v };
  return { platform: platformHint, value: v.replace(/^[@#]+/, "").toLowerCase() };
}

/** Deterministic connector id from a spec (matches each connector's own id). */
export function specId(s: SourceSpec): string {
  if (s.platform === "twitch") return `twitch:#${s.value.replace(/^#/, "").toLowerCase()}`;
  if (s.platform === "kick") return `kick:${s.value.toLowerCase()}`;
  const m = s.value.match(/broadcasts\/([A-Za-z0-9]+)/);
  return `x:${m ? m[1] : s.value.trim()}`;
}

/**
 * Owns the live set of connectors. Each runs under its own AbortController so it
 * can be added/removed independently at runtime. The active set is persisted to
 * disk so runtime-added streams survive restarts.
 */
export class ConnectorManager {
  private entries = new Map<string, { connector: Connector; abort: AbortController; spec: SourceSpec }>();
  private readonly xAuth: XGuestAuth;

  constructor(private readonly deps: ManagerDeps) {
    this.xAuth = new XGuestAuth(deps.x.bearer, deps.x.userAgent);
  }

  /** the shared X guest auth (reused by the viewer poller for broadcast viewer counts) */
  get guestAuth(): XGuestAuth {
    return this.xAuth;
  }

  private build(spec: SourceSpec): Connector {
    switch (spec.platform) {
      case "twitch":
        return new TwitchIrcConnector(spec.value);
      case "x":
        return new XLiveChatConnector(spec.value, this.xAuth, this.deps.x.userAgent, spec.label, this.deps.x.authToken);
      case "kick":
        return new KickPusherConnector(spec.value, {
          chromeBin: this.deps.kick.chromeBin,
          userAgent: this.deps.x.userAgent,
          pusherKey: this.deps.kick.pusherKey,
          cluster: this.deps.kick.cluster,
          chatroomId: spec.chatroomId,
        });
      default:
        throw new Error(`unsupported source platform: ${spec.platform}`);
    }
  }

  list(): ConnectorInfo[] {
    return this.deps.health.all().map((c) => ({
      id: c.id,
      platform: c.platform,
      label: c.label,
      status: c.status,
    }));
  }

  add(spec: SourceSpec): ConnectorInfo {
    const connector = this.build(spec);
    const existing = this.entries.get(connector.id);
    if (existing) {
      const c = this.deps.health.get(connector.id);
      return {
        id: connector.id,
        platform: connector.platform,
        label: connector.label,
        status: c?.status ?? { kind: "connecting" },
      };
    }

    const abort = new AbortController();
    this.entries.set(connector.id, { connector, abort, spec });
    this.deps.health.register(connector.id, connector.platform, connector.label);

    const sup = new SupervisedConnector(connector, {
      onMessage: (m) => this.deps.pipeline.ingest(connector.id, m),
      onStatus: (id, status) => {
        this.deps.health.setStatus(id, status);
        const comp = this.deps.health.get(id);
        if (comp) {
          comp.label = connector.label;
          this.deps.onStatus({ id: comp.id, platform: comp.platform, label: comp.label, status });
        }
      },
    });
    sup
      .run(abort.signal)
      .catch((e) => logger.error({ err: String(e), connector: connector.id }, "supervisor crashed"));

    logger.info({ id: connector.id }, "source added");
    this.persist();
    return {
      id: connector.id,
      platform: connector.platform,
      label: connector.label,
      status: { kind: "connecting" },
    };
  }

  stopAll(): void {
    for (const e of this.entries.values()) e.abort.abort();
  }

  remove(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    e.abort.abort();
    this.entries.delete(id);
    this.deps.health.remove(id);
    this.deps.onStatus({
      id,
      platform: e.connector.platform,
      label: e.connector.label,
      status: { kind: "idle", reason: "removed" },
    });
    logger.info({ id }, "source removed");
    this.persist();
    return true;
  }

  /**
   * boot: union of the channels.yaml seed (always honored as the baseline) and
   * any persisted runtime-added sources. Deduped by connector id; persisted
   * entries override seed (e.g. to keep a custom label).
   */
  initialSpecs(seed: SourceSpec[]): SourceSpec[] {
    const bySpec = new Map<string, SourceSpec>();
    for (const s of seed) bySpec.set(specId(s), s);
    if (this.deps.persistPath && existsSync(this.deps.persistPath)) {
      try {
        const persisted = JSON.parse(readFileSync(this.deps.persistPath, "utf8")) as SourceSpec[];
        for (const s of persisted) bySpec.set(specId(s), s);
        logger.info({ persisted: persisted.length }, "merged persisted sources");
      } catch (e) {
        logger.warn({ err: String(e) }, "failed to read persisted sources; using seed only");
      }
    }
    return [...bySpec.values()];
  }

  private persist(): void {
    if (!this.deps.persistPath) return;
    try {
      mkdirSync(dirname(this.deps.persistPath), { recursive: true });
      const specs = [...this.entries.values()].map((e) => e.spec);
      writeFileSync(this.deps.persistPath, JSON.stringify(specs, null, 2));
    } catch (e) {
      logger.warn({ err: String(e) }, "failed to persist sources");
    }
  }
}
