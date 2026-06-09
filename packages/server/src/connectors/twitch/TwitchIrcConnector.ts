import { ChatClient } from "@twurple/chat";
import { ulid } from "ulid";
import type { Badge, ChatMessage } from "@app/shared";
import type { Connector, ConnectorContext } from "../Connector.js";
import { twitchEmotes, thirdPartyEmotes } from "../emotes.js";
import { getChannelEmotes } from "../emoteSets.js";
import { twitchBadgeImage } from "./twitchBadges.js";

/**
 * Anonymous Twitch chat reader over IRC-WebSocket (justinfan). Validated live
 * against #fazebanks. @twurple/chat handles its own reconnection, so connect()
 * stays pending until the shared signal aborts.
 */
export class TwitchIrcConnector implements Connector {
  readonly platform = "twitch" as const;
  readonly id: string;
  readonly label: string;

  constructor(private readonly channel: string) {
    this.channel = channel.replace(/^#/, "").toLowerCase();
    this.id = `twitch:#${this.channel}`;
    this.label = this.channel;
  }

  async connect(ctx: ConnectorContext): Promise<void> {
    const client = new ChatClient({ channels: [this.channel] }); // anonymous (no authProvider)

    client.onMessage((_channel, _user, text, msg) => {
      const ts = Number(msg.tags.get("tmi-sent-ts")) || Date.now();
      const roomId = msg.tags.get("room-id") ?? undefined; // channel's twitch id → 3rd-party sets + badges
      const badges: Badge[] = [...msg.userInfo.badges].map(([name, version]) => {
        const imageUrl = twitchBadgeImage(roomId, name, version);
        return { id: `${name}/${version}`, title: name, ...(imageUrl ? { imageUrl } : {}) };
      });
      const replyId = msg.tags.get("reply-parent-msg-id");
      const native = twitchEmotes(text, msg.emoteOffsets);
      const thirdParty = thirdPartyEmotes(text, getChannelEmotes("twitch", roomId), native);
      const out: ChatMessage = {
        id: ulid(),
        platform: "twitch",
        platformMsgId: msg.id,
        channel: this.id,
        channelLabel: this.label,
        author: {
          username: msg.userInfo.userName,
          displayName: msg.userInfo.displayName || msg.userInfo.userName,
          color: msg.userInfo.color ?? undefined,
          platformUserId: msg.userInfo.userId ?? undefined,
        },
        text,
        emotes: native.concat(thirdParty).sort((a, b) => a.start - b.start),
        badges,
        timestamp: ts,
        receivedAt: Date.now(),
        replyTo: replyId
          ? {
              id: replyId,
              author: msg.tags.get("reply-parent-display-name") ?? "",
              textPreview: msg.tags.get("reply-parent-msg-body") ?? "",
            }
          : undefined,
      };
      ctx.onMessage(out);
    });

    client.onConnect(() => ctx.onStatus({ kind: "connected" }));
    client.onDisconnect((manually, reason) => {
      if (!manually) {
        ctx.onStatus({
          kind: "reconnecting",
          error: reason?.message ?? "disconnected",
          attempt: 0,
          delayMs: 0,
        });
      }
    });

    await client.connect();

    return new Promise<void>((resolve) => {
      const stop = () => {
        try {
          client.quit();
        } catch {
          /* ignore */
        }
        resolve();
      };
      if (ctx.signal.aborted) return stop();
      ctx.signal.addEventListener("abort", stop, { once: true });
    });
  }
}
