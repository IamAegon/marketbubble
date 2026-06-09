import WebSocket from "ws";
import { logger } from "../../observability/logger.js";

export interface PeriscopeChat {
  text: string;
  username?: string;
  displayName?: string;
  userId?: string;
  timestamp?: number;
  uuid?: string;
}

export interface PeriscopeChatOpts {
  endpoint: string;
  accessToken: string;
  room: string;
  userAgent: string;
  signal: AbortSignal;
  onOpen?: () => void;
  onChat: (c: PeriscopeChat) => void;
  onClose?: (code: number) => void;
  onError?: (err: Error) => void;
}

/**
 * Periscope/pscp.tv chat WebSocket reader (ported from agent-twitter-client
 * ChatClient.ts, with a body.type===1 text branch). Validated live against an X
 * broadcast. Messages are triple-nested JSON.
 */
export function connectPeriscopeChat(opts: PeriscopeChatOpts): WebSocket {
  const wsUrl = opts.endpoint.replace(/^https/, "wss") + "/chatapi/v1/chatnow";
  const ws = new WebSocket(wsUrl, {
    headers: { Origin: "https://x.com", "User-Agent": opts.userAgent },
  });

  ws.on("open", () => {
    ws.send(JSON.stringify({ payload: JSON.stringify({ access_token: opts.accessToken }), kind: 3 }));
    ws.send(
      JSON.stringify({
        payload: JSON.stringify({ body: JSON.stringify({ room: opts.room }), kind: 1 }),
        kind: 2,
      }),
    );
    opts.onOpen?.();
  });

  ws.on("message", (data) => {
    let outer: any;
    try {
      outer = JSON.parse(data.toString());
    } catch {
      return;
    }
    // chatman triple-nests JSON and the meaningful type is the INNER payload/body —
    // NOT the outer envelope kind. Live X broadcasts deliver events (incl. chat) under
    // a kind:2 envelope, so the old `outer.kind !== 1` guard silently dropped every
    // message. Select on the inner structure instead: skip occupancy (payload.kind 4),
    // then accept chat text (body.type 1).
    let payload: any, body: any;
    try {
      payload = JSON.parse(outer.payload);
    } catch {
      return;
    }
    if (payload?.kind === 4) return; // occupancy / presence — not a message
    try {
      body = JSON.parse(payload.body);
    } catch {
      return;
    }
    if (!body || body.type !== 1) return; // 1 = chat text
    // TEMP DIAGNOSTIC: log every chat frame as it comes off the wire (BEFORE any dedup /
    // normalize), so we can tell whether X actually delivers a sender's duplicate message
    // or suppresses it upstream. Remove once the duplicate question is settled.
    logger.info(
      {
        text: typeof body.body === "string" ? body.body.slice(0, 80) : body.body,
        user: payload.sender?.username ?? body.username ?? payload.sender?.user_id ?? "?",
        uuid: body.uuid ?? payload.uuid ?? null,
        ts: body.timestamp ?? payload.timestamp ?? null,
      },
      "x-chat: frame received from chatman",
    );
    opts.onChat({
      text: body.body,
      username: payload.sender?.username ?? body.username,
      displayName: payload.sender?.display_name ?? body.displayName,
      userId: payload.sender?.user_id,
      timestamp: body.timestamp ?? payload.timestamp,
      // payload.uuid is the connection-level sessionUUID (constant per socket) — never a
      // per-message id, so it must not feed the dedup key. Keep only body.uuid in case a
      // real chatman build ever attaches a per-message one.
      uuid: body.uuid,
    });
  });

  ws.on("close", (code) => opts.onClose?.(code));
  ws.on("error", (err) => opts.onError?.(err as Error));

  const onAbort = () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };
  if (opts.signal.aborted) onAbort();
  else opts.signal.addEventListener("abort", onAbort, { once: true });

  return ws;
}
