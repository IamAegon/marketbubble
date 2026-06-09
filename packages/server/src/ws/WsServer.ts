import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ChatMessage, ClientMsg, ConnectorInfo, Filters, Role, RoomInfo, ServerMsg, User } from "@app/shared";
import type { MessageBus } from "../bus/MessageBus.js";
import type { SideBus } from "../bus/SideBus.js";
import { RingBuffer, matches } from "../store/RingBuffer.js";
import type { ChatStore } from "../store/ChatStore.js";
import type { HealthRegistry } from "../observability/health.js";
import type { MbRoom } from "../room/MbRoom.js";
import type { RoomRegistry } from "../room/rooms.js";
import { verifyToken } from "../auth/jwt.js";
import { logger } from "../observability/logger.js";

const EMPTY_FILTERS: Filters = { platforms: [], channels: [] };
const MAX_BACKFILL = 2500;

interface Client extends WebSocket {
  _alive?: boolean;
  _user?: User | null;
  _filters?: Filters;
}

/** WebSocket fan-out with auth-bound sockets + role-gated room reads. */
export class WsServer {
  private wss: WebSocketServer;

  constructor(
    server: Server,
    private readonly bus: MessageBus,
    private readonly sideBus: SideBus,
    private readonly ring: RingBuffer,
    private readonly health: HealthRegistry,
    private readonly mbRoom: MbRoom,
    private readonly rooms: RoomRegistry,
    private readonly store: ChatStore,
  ) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws) => this.onConnection(ws as Client));
    const hb = setInterval(() => this.heartbeat(), 20_000);
    hb.unref?.();
  }

  private connectorInfos(role: Role | undefined, handle?: string): ConnectorInfo[] {
    return this.health
      .all()
      .filter((c) => this.rooms.canRead(role, c.id, handle))
      .map((c) => ({ id: c.id, platform: c.platform, label: c.label, status: c.status }));
  }

  /** Register (or update) an MB room as a connector and push it live to the members
   *  who can read it — so a new DM, a rename, or an added participant shows up (or
   *  updates) as a column without a reload. Idempotent; refreshes the label. */
  announceRoom(room: RoomInfo): void {
    this.health.register(room.id, "mb", room.label);
    this.health.setLabel(room.id, room.label);
    this.health.setStatus(room.id, { kind: "connected" });
    this.broadcastStatus({ id: room.id, platform: "mb", label: room.label, status: { kind: "connected" } });
  }

  /** A room was globally deleted — drop it from health and tell the relevant clients to
   *  remove the column. For a private room, pass its (pre-delete) members as `audience`
   *  so the removal — whose id encodes the participants — only reaches them; a public
   *  room passes no audience and fans out to everyone. */
  announceRoomRemoval(roomId: string, audience?: string[]): void {
    this.health.remove(roomId);
    const data = JSON.stringify({
      type: "status",
      connector: roomId,
      platform: "mb",
      label: "",
      status: { kind: "idle", reason: "removed" },
    } satisfies ServerMsg);
    const to = audience && audience.length ? new Set(audience.map((h) => h.toLowerCase())) : null;
    for (const ws of this.wss.clients as Set<Client>) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (to && !(ws._user && to.has(ws._user.handle.toLowerCase()))) continue;
      ws.send(data);
    }
  }

  /** A single participant was removed from a private room — drop the column for just
   *  them (the room still exists for everyone else, so this can't go through the
   *  membership-filtered broadcast: the removed member no longer passes canRead). */
  announceMemberRemoval(roomId: string, handle: string): void {
    const h = handle.trim().toLowerCase();
    const data = JSON.stringify({
      type: "status",
      connector: roomId,
      platform: "mb",
      label: "",
      status: { kind: "idle", reason: "removed" },
    } satisfies ServerMsg);
    for (const ws of this.wss.clients as Set<Client>) {
      if (ws.readyState === WebSocket.OPEN && ws._user?.handle.toLowerCase() === h) ws.send(data);
    }
  }

  /** Push a team-coordination event (e.g. a checklist item completed) to everyone. */
  broadcastTeam(event: import("@app/shared").TeamEvent): void {
    const data = JSON.stringify({ type: "team", event } satisfies ServerMsg);
    for (const ws of this.wss.clients as Set<Client>) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  broadcastStatus(info: ConnectorInfo): void {
    const data = JSON.stringify({
      type: "status",
      connector: info.id,
      platform: info.platform,
      label: info.label,
      status: info.status,
    } satisfies ServerMsg);
    for (const ws of this.wss.clients as Set<Client>) {
      if (ws.readyState === WebSocket.OPEN && this.rooms.canRead(ws._user?.role, info.id, ws._user?.handle)) ws.send(data);
    }
  }

  private canRead(ws: Client, msg: ChatMessage): boolean {
    return this.rooms.canRead(ws._user?.role, msg.channel, ws._user?.handle) && matches(ws._filters ?? EMPTY_FILTERS, msg);
  }

  private async backfill(ws: Client, n: number): Promise<ChatMessage[]> {
    const role = ws._user?.role;
    const handle = ws._user?.handle;
    const filters = ws._filters ?? EMPTY_FILTERS;
    const all = this.ring.recent(filters, MAX_BACKFILL);
    const visible = all.filter((m) => this.rooms.canRead(role, m.channel, handle)).slice(-clampBackfill(n));
    // tracked-account posts ALSO come from the DURABLE store (higher limit) so every X
    // category stays populated and survives reloads — the ring's recentPosts evicts under
    // heavy live chat, which empties the per-category news views.
    let posts: ChatMessage[];
    try {
      const durablePosts = await this.store.recentPosts({ limit: 300 });
      posts = durablePosts.filter((m) => this.rooms.canRead(role, m.channel, handle) && matches(filters, m));
    } catch {
      posts = this.ring
        .recentPosts(80)
        .filter((m) => this.rooms.canRead(role, m.channel, handle) && matches(filters, m));
    }
    // native-room messages come from the DURABLE store, not the ring: low-traffic MB rooms
    // (and seeded previews) must survive heavy live chat evicting them from the 20000-cap
    // ring, which would otherwise leave rooms empty on reload.
    let roomMsgs: ChatMessage[];
    try {
      const durable = await this.store.recentRooms({ limit: 80 });
      roomMsgs = durable.filter((m) => this.rooms.canRead(role, m.channel, handle) && matches(filters, m));
    } catch {
      roomMsgs = this.ring
        .recentRooms(80)
        .filter((m) => this.rooms.canRead(role, m.channel, handle) && matches(filters, m));
    }
    const merged = new Map<string, ChatMessage>();
    for (const m of visible) merged.set(m.id, m);
    for (const m of posts) merged.set(m.id, m);
    for (const m of roomMsgs) merged.set(m.id, m);
    return [...merged.values()].sort((a, b) => a.receivedAt - b.receivedAt);
  }

  private onConnection(ws: Client): void {
    ws._filters = EMPTY_FILTERS;
    ws._user = null;
    ws._alive = true;
    ws.on("pong", () => {
      ws._alive = true;
    });

    const send = (m: ServerMsg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };

    send({ type: "welcome", connectors: this.connectorInfos(undefined) });
    // replay cached market data so new clients see prices/markets/sentiment immediately
    for (const m of this.sideBus.snapshot()) send(m);

    const unsubChat = this.bus.subscribe((msg) => {
      if (this.canRead(ws, msg)) send({ type: "message", message: msg });
    });
    const unsubSide = this.sideBus.subscribe((m) => send(m));

    ws.on("message", async (data) => {
      let m: ClientMsg;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (m.type === "hello") {
        if (m.token) ws._user = verifyToken(m.token);
        ws._filters = m.filters ?? EMPTY_FILTERS;
        send({ type: "welcome", connectors: this.connectorInfos(ws._user?.role, ws._user?.handle) });
        send({ type: "backfill", messages: await this.backfill(ws, clampBackfill(m.backfill)) });
      } else if (m.type === "setFilters") {
        ws._filters = m.filters ?? EMPTY_FILTERS;
        send({ type: "backfill", messages: await this.backfill(ws, 200) });
      } else if (m.type === "post") {
        if (!ws._user) return;
        const r = this.mbRoom.post(ws._user, m.room || "mb:shared", m.text || "", m.replyTo, m.embed);
        if (!r.ok) logger.debug({ err: r.error, user: ws._user.handle }, "post rejected");
      }
    });

    ws.on("close", () => {
      unsubChat();
      unsubSide();
    });
    ws.on("error", () => {
      unsubChat();
      unsubSide();
    });
  }

  private heartbeat(): void {
    for (const ws of this.wss.clients as Set<Client>) {
      if (ws._alive === false) {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        continue;
      }
      ws._alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }

  close(): void {
    for (const ws of this.wss.clients) {
      try {
        ws.close(1001, "server shutting down");
      } catch {
        /* ignore */
      }
    }
    this.wss.close();
    logger.info("ws server closed");
  }
}

function clampBackfill(n: number | undefined): number {
  if (!Number.isFinite(n as number)) return 200;
  return Math.max(0, Math.min(n as number, MAX_BACKFILL));
}
