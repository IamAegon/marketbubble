import type { ConnectorStatus, Platform } from "@app/shared";

/** Port of plenus health.rs: per-component state + counters. */
export interface ComponentHealth {
  id: string;
  platform: Platform;
  label: string;
  status: ConnectorStatus;
  eventsTotal: number;
  errorsTotal: number;
  lastEventAt: number | null;
  reconnects: number;
}

export class HealthRegistry {
  private components = new Map<string, ComponentHealth>();

  register(id: string, platform: Platform, label: string): void {
    if (!this.components.has(id)) {
      this.components.set(id, {
        id,
        platform,
        label,
        status: { kind: "connecting" },
        eventsTotal: 0,
        errorsTotal: 0,
        lastEventAt: null,
        reconnects: 0,
      });
    }
  }

  setStatus(id: string, status: ConnectorStatus): void {
    const c = this.components.get(id);
    if (!c) return;
    if (status.kind === "reconnecting") c.reconnects += 1;
    c.status = status;
  }

  recordEvent(id: string, at: number): void {
    const c = this.components.get(id);
    if (!c) return;
    c.eventsTotal += 1;
    c.lastEventAt = at;
  }

  recordError(id: string): void {
    const c = this.components.get(id);
    if (c) c.errorsTotal += 1;
  }

  get(id: string): ComponentHealth | undefined {
    return this.components.get(id);
  }

  /** update a connector's display label (e.g. a room was renamed / gained members) */
  setLabel(id: string, label: string): void {
    const c = this.components.get(id);
    if (c) c.label = label;
  }

  remove(id: string): void {
    this.components.delete(id);
  }

  all(): ComponentHealth[] {
    return [...this.components.values()];
  }

  /** ready when at least one connector is connected */
  isReady(): boolean {
    return this.all().some((c) => c.status.kind === "connected");
  }

  prometheus(): string {
    const lines: string[] = [
      "# HELP chat_events_total messages ingested per connector",
      "# TYPE chat_events_total counter",
    ];
    for (const c of this.all()) {
      const labels = `connector="${c.id}",platform="${c.platform}"`;
      lines.push(`chat_events_total{${labels}} ${c.eventsTotal}`);
      lines.push(`chat_errors_total{${labels}} ${c.errorsTotal}`);
      lines.push(`chat_reconnects_total{${labels}} ${c.reconnects}`);
      lines.push(`chat_connector_up{${labels}} ${c.status.kind === "connected" ? 1 : 0}`);
    }
    return lines.join("\n") + "\n";
  }
}
