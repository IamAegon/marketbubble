import { ulid } from "ulid";
import type { ChatMessage, MessageEmbed, ReplyRef, User } from "@app/shared";
import type { Pipeline } from "../pipeline/ingest.js";
import type { RoomRegistry } from "./rooms.js";
import type { UserStore } from "../auth/UserStore.js";

// strip ASCII control characters without embedding literal control chars in source
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");
// same, but keep tab/newline/carriage-return so embed markdown stays multi-line
const MD_CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");
const EMBED_MAX = 8000;

/** Native Market Bubble rooms. Posts are authored by the authenticated user and
 * flow through the normal pipeline (dedup/ring/fan-out/persist) as platform 'mb'. */
export class MbRoom {
  private lastPost = new Map<string, number>();

  constructor(
    private readonly pipeline: Pipeline,
    private readonly rooms: RoomRegistry,
    private readonly users: UserStore,
  ) {}

  post(
    user: User,
    roomId: string,
    text: string,
    replyTo?: ReplyRef,
    embed?: MessageEmbed,
  ): { ok: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: "unknown room" };
    if (!this.rooms.canWrite(user.role, roomId, user.handle)) return { ok: false, error: "forbidden" };

    // an embed (e.g. a forwarded assistant answer) carries the full markdown body;
    // `text` then becomes a one-line plain preview for search / notifications.
    const cleanEmbed: MessageEmbed | undefined =
      embed && (embed.kind === "ai" || embed.kind === "x" || embed.kind === "news") && typeof embed.markdown === "string"
        ? {
            kind: embed.kind,
            title: embed.title ? String(embed.title).replace(CONTROL_CHARS, " ").trim().slice(0, 80) : undefined,
            markdown: String(embed.markdown).replace(MD_CONTROL_CHARS, "").trim().slice(0, EMBED_MAX),
            ...(embed.link && typeof embed.link === "string" ? { link: String(embed.link).slice(0, 400) } : {}),
          }
        : undefined;
    if (cleanEmbed && !cleanEmbed.markdown) return { ok: false, error: "empty message" };

    const clean = cleanEmbed
      ? cleanEmbed.markdown.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, 480)
      : String(text ?? "").replace(CONTROL_CHARS, " ").trim().slice(0, 500);
    if (!clean) return { ok: false, error: "empty message" };

    // per-(user, room) throttle, NOT per-user: sending one message that fans out to several
    // rooms at once fires these calls back-to-back, so a per-user gate would reject every
    // room after the first ("slow down"). Keying on the room still blocks spamming one room.
    const now = Date.now();
    const rateKey = `${user.id}:${roomId}`;
    const prev = this.lastPost.get(rateKey) ?? 0;
    if (now - prev < 700) return { ok: false, error: "slow down" };
    this.lastPost.set(rateKey, now);

    // pull fresh profile (name/color/avatar) from the store so edits show immediately
    const fresh = this.users.get(user.handle);
    const reply: ReplyRef | undefined =
      replyTo && replyTo.id && replyTo.author
        ? {
            id: String(replyTo.id).slice(0, 64),
            author: String(replyTo.author).replace(CONTROL_CHARS, " ").slice(0, 80),
            textPreview: String(replyTo.textPreview ?? "").replace(CONTROL_CHARS, " ").slice(0, 120),
          }
        : undefined;
    const m: ChatMessage = {
      id: ulid(),
      platform: "mb",
      platformMsgId: ulid(),
      channel: roomId,
      channelLabel: room.label,
      author: {
        username: user.handle,
        displayName: fresh?.displayName ?? user.displayName,
        color: fresh?.color ?? user.color,
        avatarUrl: fresh?.avatarUrl,
      },
      text: clean,
      timestamp: now,
      receivedAt: now,
      kind: "chat",
      ...(reply ? { replyTo: reply } : {}),
      ...(cleanEmbed ? { embed: cleanEmbed } : {}),
    };
    this.pipeline.ingest(roomId, m);
    return { ok: true };
  }
}
