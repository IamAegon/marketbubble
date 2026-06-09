import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  ConnectorInfo,
  MarketOdds,
  MessageEmbed,
  PriceTick,
  ReplyRef,
  SentimentGauge,
  ServerMsg,
} from "@app/shared";
import { emitTeamEvent } from "../lib/teamBus";

// Keep effectively everything for the session. MAX is just a high safety backstop so a
// multi-hour busy stream can't grow the tab unbounded — in normal use nothing is evicted.
const MAX = 50000;

/** Trim only if we blow past the (very high) MAX backstop — and even then NEVER evict native
 * room (mb) messages. Rooms/DMs are low-volume and share this array with the high-volume
 * stream firehose, so a plain oldest-first slice would push room scrollback out. We drop the
 * oldest NON-room messages first and always keep every mb message. */
function capMessages(arr: ChatMessage[]): ChatMessage[] {
  if (arr.length <= MAX) return arr;
  let over = arr.length - MAX;
  const out: ChatMessage[] = [];
  for (const m of arr) {
    if (over > 0 && m.platform !== "mb") {
      over--;
      continue; // evict oldest non-room message
    }
    out.push(m);
  }
  return out;
}
const WS_URL = (import.meta as any).env?.VITE_WS_URL ?? `ws://${location.hostname}:8787/ws`;

const MAX_POSTS = 2000;
/** Coalesce bursts of incoming messages into one state update per window, so a busy
 * stream re-renders the dashboard ~8x/sec instead of once per message. Keeps the
 * heavy main-thread work (analytics folds, context fan-out) off the hot path. */
const FLUSH_MS = 120;

export interface ChatSocket {
  messages: ChatMessage[];
  posts: ChatMessage[];
  connectors: ConnectorInfo[];
  connected: boolean;
  post: (room: string, text: string, replyTo?: ReplyRef) => void;
  prices: Record<string, PriceTick>;
  markets: MarketOdds[];
  sentiment: SentimentGauge | null;
  /** live viewer counts by connector id ("twitch:#login") */
  viewers: Record<string, number>;
  /** connector ids actually streaming now (per platform live APIs, not chat connection) */
  liveStreams: Set<string>;
}

/** Subscribes to ALL messages (+ side-band market data); views filter/group client-side. */
export function useChatSocket(token?: string | null): ChatSocket {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [posts, setPosts] = useState<ChatMessage[]>([]);
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [prices, setPrices] = useState<Record<string, PriceTick>>({});
  const [markets, setMarkets] = useState<MarketOdds[]>([]);
  const [sentiment, setSentiment] = useState<SentimentGauge | null>(null);
  const [viewers, setViewers] = useState<Record<string, number>>({});
  const [liveStreams, setLiveStreams] = useState<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  // incoming-message queue, drained on a timer so bursts collapse into one re-render
  const pendingRef = useRef<ChatMessage[]>([]);
  const flushTimerRef = useRef<number | undefined>(undefined);

  const hello = (ws: WebSocket) =>
    ws.send(
      JSON.stringify({
        type: "hello",
        filters: { platforms: [], channels: [] },
        backfill: 2000, // deep enough that high-volume Twitch/Kick scrollback survives a refresh
        token: tokenRef.current ?? undefined,
      }),
    );

  useEffect(() => {
    let closed = false;
    let backoff = 1000;
    let timer: number | undefined;

    // drain the queued messages into state in a single batched update
    const flush = () => {
      flushTimerRef.current = undefined;
      const drain = pendingRef.current;
      if (drain.length === 0) return;
      pendingRef.current = [];
      setMessages((prev) => capMessages(prev.concat(drain)));
      const newPosts = drain.filter((x) => x.kind === "post");
      if (newPosts.length) {
        setPosts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          const add = newPosts.filter((p) => !seen.has(p.id));
          if (!add.length) return prev;
          const n = prev.concat(add);
          return n.length > MAX_POSTS ? n.slice(n.length - MAX_POSTS) : n;
        });
      }
    };

    function open() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        if (closed) return;
        setConnected(true);
        backoff = 1000;
        hello(ws);
      };
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (m.type) {
          case "welcome":
            setConnectors(m.connectors);
            break;
          case "backfill":
            pendingRef.current = []; // drop any queued live messages; backfill is authoritative
            setMessages(capMessages(m.messages));
            setPosts(m.messages.filter((x) => x.kind === "post").slice(-MAX_POSTS));
            break;
          case "message":
            pendingRef.current.push(m.message);
            if (flushTimerRef.current === undefined) flushTimerRef.current = window.setTimeout(flush, FLUSH_MS);
            break;
          case "status":
            setConnectors((prev) => {
              if (m.status.kind === "idle" && m.status.reason === "removed") {
                return prev.filter((c) => c.id !== m.connector);
              }
              const info: ConnectorInfo = { id: m.connector, platform: m.platform, label: m.label, status: m.status };
              const i = prev.findIndex((c) => c.id === m.connector);
              if (i === -1) return prev.concat(info);
              const cp = prev.slice();
              cp[i] = info;
              return cp;
            });
            break;
          case "ticker":
            setPrices((prev) => {
              const n = { ...prev };
              for (const t of m.prices) n[t.symbol] = t;
              return n;
            });
            break;
          case "price":
            setPrices((prev) => ({ ...prev, [m.tick.symbol]: m.tick }));
            break;
          case "markets":
            setMarkets(m.markets);
            break;
          case "sentiment":
            setSentiment(m.gauge);
            break;
          case "viewers":
            setViewers(m.counts);
            if (m.live) setLiveStreams(new Set(m.live));
            break;
          case "team":
            emitTeamEvent(m.event);
            break;
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        timer = window.setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 30000);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    }

    open();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  // re-identify on login/logout
  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) hello(ws);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const post = useCallback((room: string, text: string, replyTo?: ReplyRef, embed?: MessageEmbed) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "post", room, text, replyTo, embed }));
  }, []);

  return { messages, posts, connectors, connected, post, prices, markets, sentiment, viewers, liveStreams };
}
