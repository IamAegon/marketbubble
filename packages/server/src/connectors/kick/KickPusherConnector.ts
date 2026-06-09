import WebSocket from "ws";
import { ulid } from "ulid";
import type { Badge, ChatMessage } from "@app/shared";
import type { Connector, ConnectorContext } from "../Connector.js";
import { kickEmotes } from "../emotes.js";
import { resolveKickChannel } from "./kickMeta.js";

export interface KickPusherOpts {
  chromeBin: string;
  userAgent: string;
  pusherKey: string;
  cluster: string;
  /** pre-known chatroom_id (skips the Cloudflare resolve) */
  chatroomId?: number;
}

/**
 * Real-time Kick chat via the (ungated) Pusher socket. The only gated step —
 * resolving chatroom_id — is done once via kickMeta. Validated live (asmongold).
 */
export class KickPusherConnector implements Connector {
  readonly platform = "kick" as const;
  readonly id: string;
  label: string;
  private readonly slug: string;

  constructor(
    slug: string,
    private readonly opts: KickPusherOpts,
  ) {
    this.slug = slug.toLowerCase();
    this.id = `kick:${this.slug}`;
    this.label = this.slug;
  }

  async connect(ctx: ConnectorContext): Promise<void> {
    let chatroomId = this.opts.chatroomId;
    if (!chatroomId) {
      const meta = await resolveKickChannel(this.slug, this.opts.chromeBin, this.opts.userAgent);
      chatroomId = meta.chatroomId;
      this.label = meta.displayName;
    }

    const wsUrl = `wss://ws-${this.opts.cluster}.pusher.com/app/${this.opts.pusherKey}?protocol=7&client=js&version=8.4.0-rc2&flash=false`;
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        let m: any;
        try {
          m = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (m.event === "pusher:connection_established") {
          ws.send(
            JSON.stringify({
              event: "pusher:subscribe",
              data: { auth: "", channel: `chatrooms.${chatroomId}.v2` },
            }),
          );
        } else if (m.event === "pusher_internal:subscription_succeeded") {
          ctx.onStatus({ kind: "connected" });
        } else if (typeof m.event === "string" && m.event.includes("ChatMessage")) {
          try {
            ctx.onMessage(this.normalize(JSON.parse(m.data)));
          } catch {
            /* skip malformed */
          }
        }
      });
      ws.on("close", () => resolve());
      ws.on("error", () => {
        /* close resolves; supervisor reconnects */
      });
      const onAbort = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private normalize(d: any): ChatMessage {
    const text: string = d.content ?? "";
    const orig = d.metadata?.original_message;
    // Kick carries chat badges on sender.identity.badges ([{type,text,count?}]); subscriber
    // count = months. Normalize to our Badge shape (id encodes the count for tenure display).
    const rawBadges = Array.isArray(d.sender?.identity?.badges) ? d.sender.identity.badges : [];
    const badges: Badge[] = rawBadges
      .filter((b: any) => b?.type)
      .map((b: any) => ({ id: `${b.type}/${b.count ?? 0}`, title: String(b.type) }));
    return {
      id: ulid(),
      platform: "kick",
      platformMsgId: String(d.id ?? ulid()),
      channel: this.id,
      channelLabel: this.label,
      author: {
        username: d.sender?.username ?? "anon",
        displayName: d.sender?.username ?? "anon",
        color: d.sender?.identity?.color ?? undefined,
        // Kick numeric user id — required to target timeout/ban via the official API
        platformUserId: d.sender?.id != null ? String(d.sender.id) : undefined,
      },
      text,
      emotes: kickEmotes(text),
      ...(badges.length ? { badges } : {}),
      timestamp: d.created_at ? Date.parse(d.created_at) || Date.now() : Date.now(),
      receivedAt: Date.now(),
      replyTo: orig
        ? {
            id: String(orig.id),
            author: d.metadata?.original_sender?.username ?? "",
            textPreview: orig.content ?? "",
          }
        : undefined,
    };
  }
}
