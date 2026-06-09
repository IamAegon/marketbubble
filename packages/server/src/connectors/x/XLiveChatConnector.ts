import { ulid } from "ulid";
import type { ChatMessage } from "@app/shared";
import type { Connector, ConnectorContext } from "../Connector.js";
import type { XGuestAuth } from "./xGuestAuth.js";
import { parseBroadcastId, resolveBroadcast } from "./broadcastDiscovery.js";
import { accessChat, accessChatPublic } from "./pscpAccess.js";
import { connectPeriscopeChat, type PeriscopeChat } from "./periscopeChat.js";
import { logger } from "../../observability/logger.js";

/**
 * X live broadcast chat connector (direct broadcast-URL/ID mode). Resolves the
 * broadcast to a chatToken, opens the Periscope chat WS, and normalizes
 * body.type===1 text into ChatMessage. On WS close it resolves so the
 * supervisor reconnects (which re-fetches fresh, short-lived tokens).
 */
export class XLiveChatConnector implements Connector {
  readonly platform = "x" as const;
  readonly id: string;
  label: string;
  private readonly broadcastId: string;

  constructor(
    input: string,
    private readonly auth: XGuestAuth,
    private readonly userAgent: string,
    private readonly labelOverride?: string,
    /** logged-in X `auth_token` cookie — unlocks reading live-broadcast chat (not just
     * occupancy). Without it we fall back to read-only guest access (viewer count only). */
    private readonly authToken?: string,
  ) {
    this.broadcastId = parseBroadcastId(input);
    this.id = `x:${this.broadcastId}`;
    this.label = labelOverride ?? `X · ${this.broadcastId}`;
  }

  async connect(ctx: ConnectorContext): Promise<void> {
    const info = await resolveBroadcast(this.auth, this.broadcastId); // throws if not live
    if (!this.labelOverride && info.userDisplayName) this.label = `X · ${info.userDisplayName}`;
    // an authenticated session reads chat the way x.com does; guest access is read-only
    // and only yields occupancy, so prefer the authed path whenever a cookie is set.
    const access = this.authToken
      ? await accessChat(info.chatToken, this.userAgent, this.authToken)
      : await accessChatPublic(info.chatToken, this.userAgent);
    // subscribe to the real chat channel when one is granted (authed); guest access
    // returns no channel and only the broadcast room (occupancy).
    const room = access.channel || access.roomId || this.broadcastId;
    if (access.readOnly && !access.channel)
      logger.warn({ id: this.id, authed: Boolean(this.authToken) }, "x chat: read-only access (occupancy only) — set X_AUTH_TOKEN to read messages");
    const broadcasterLabel = this.label;

    await new Promise<void>((resolve) => {
      connectPeriscopeChat({
        endpoint: access.endpoint,
        accessToken: access.accessToken,
        room,
        userAgent: this.userAgent,
        signal: ctx.signal,
        onOpen: () => ctx.onStatus({ kind: "connected" }),
        onChat: (c) => ctx.onMessage(this.normalize(c, broadcasterLabel)),
        onClose: () => resolve(),
        onError: () => {
          /* close event resolves; supervisor reconnects */
        },
      });
    });
  }

  private normalize(c: PeriscopeChat, broadcasterLabel: string): ChatMessage {
    return {
      id: ulid(),
      platform: "x",
      platformMsgId: xChatMsgId(c),
      channel: this.id,
      channelLabel: broadcasterLabel,
      author: {
        username: c.username ?? "anon",
        displayName: c.displayName ?? c.username ?? "anon",
        // Periscope chat usually omits the @handle, so username collapses to "anon"
        // for everyone — carry the stable per-user id so author-focus can tell X
        // chatters apart (Twitch/Kick rely on this same field).
        platformUserId: c.userId,
      },
      text: c.text,
      timestamp: toMs(c.timestamp),
      receivedAt: Date.now(),
    };
  }
}

/**
 * Unique per-delivery id for an X broadcast chat message — fed to the ingest dedup gate as
 * `platformMsgId`. chatman exposes NO reliable per-message id: `body.uuid`/`payload.uuid` is
 * absent or connection-scoped (see periscopeChat), and X chatters share the "anon" username
 * since the @handle is omitted. So ANY identity/content/timestamp key collapses to roughly
 * `anon:<text>` and the gate swallows legitimately-repeated lines (a chatter sending "gm"
 * twice, or your own duplicate sends) — only the first survives to the store, which is why a
 * refresh shows just the unique ones. A monotonic per-process counter guarantees every
 * received message gets a distinct key and survives. The only cost is that a reconnect
 * replaying recent history could re-show a line once — far better than dropping real chat.
 */
let xChatSeq = 0;
function xChatMsgId(c: PeriscopeChat): string {
  const user = c.userId ?? c.username ?? "anon";
  return `${user}:${toMs(c.timestamp)}:${xChatSeq++}`;
}

/**
 * Normalize a chatman timestamp to epoch milliseconds. Periscope/pscp sends Unix SECONDS
 * (often fractional), while Twitch/Kick (and our `receivedAt`) are milliseconds — so passing
 * the raw value through stamped every X message at ~1970, which the UI rendered as a wildly
 * old time and read as "this message arrived late / out of sync." Anything below ~1e12 (year
 * ~2001 in ms) is treated as seconds and scaled up; values already in ms pass through.
 */
function toMs(ts: number | undefined): number {
  if (typeof ts !== "number") return Date.now();
  return ts < 1e12 ? Math.round(ts * 1000) : ts;
}
