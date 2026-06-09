import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  ChatMessage,
  ConnectorInfo,
  MarketOdds,
  MessageEmbed,
  Platform,
  PriceTick,
  ReplyRef,
  RoomInfo,
  SentimentGauge,
  User,
} from "@app/shared";
import { useChatSocket } from "../feed/useChatSocket";
import { useSaved, type SavedStore } from "./useSaved";
import { useLayout, type LayoutApi, type ChatView } from "./useLayout";
import { useAuth } from "./useAuth";
import { getToken } from "../lib/auth";
import { getRooms } from "../lib/rooms";
import { removeSource } from "../lib/api";
import type { RowActions } from "../feed/actions";

const ALL: Platform[] = ["twitch", "x", "kick", "mb"];

export interface PricePoint {
  t: number;
  price: number;
}

interface DashboardCtx {
  user: User | null;
  messages: ChatMessage[];
  posts: ChatMessage[];
  connectors: ConnectorInfo[];
  connected: boolean;
  liveCount: number;
  post: (room: string, text: string, replyTo?: ReplyRef, embed?: MessageEmbed) => void;
  prices: Record<string, PriceTick>;
  priceHistory: Record<string, PricePoint[]>;
  markets: MarketOdds[];
  sentiment: SentimentGauge | null;
  /** live viewer counts by connector id ("twitch:#login") */
  viewers: Record<string, number>;
  /** connector ids actually streaming now (per platform live APIs, not chat connection) */
  liveStreams: Set<string>;
  store: SavedStore;
  layout: LayoutApi;
  rooms: RoomInfo[];
  refreshRooms: () => void;
  activeRoom: string;
  setActiveRoom: (id: string) => void;
  enabled: Set<Platform>;
  allPlatforms: Platform[];
  togglePlatform: (p: Platform) => void;
  /** show tracked-account news posts (kind:'post') inline in the unified feed */
  showNews: boolean;
  toggleNews: () => void;
  view: ChatView;
  setView: (v: ChatView) => void;
  videoMode: "theater" | "grid";
  setVideoMode: (m: "theater" | "grid") => void;
  onRemoveSource: (id: string) => void;
  actions: RowActions;
}

const Ctx = createContext<DashboardCtx | null>(null);

export const useDashboard = (): DashboardCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDashboard must be used within DashboardProvider");
  return c;
};

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socket = useChatSocket(getToken());
  const store = useSaved();
  const layout = useLayout();

  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [priceHistory, setPriceHistory] = useState<Record<string, PricePoint[]>>({});
  // Live workspace prefs live in the persisted layout store, so they survive both
  // in-app navigation and a full reload (view, video mode, filters, news, room).
  const view = layout.chatView;
  const setView = layout.setChatView;
  const videoMode = layout.videoMode;
  const setVideoMode = layout.setVideoMode;
  const showNews = layout.showNews;
  const toggleNews = layout.toggleNews;
  const activeRoom = layout.activeRoom;
  const setActiveRoom = layout.setActiveRoom;
  const togglePlatform = layout.togglePlatform;

  useEffect(() => {
    getRooms().then((r) => {
      setRooms(r);
      if (r.length && !r.some((x) => x.id === activeRoom)) setActiveRoom(r[0]!.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refreshRooms = useCallback(() => getRooms().then(setRooms), []);

  // Keep the rooms list (sidebar source) in sync with live connector pushes: the WS
  // broadcasts MB rooms as connectors on create / rename / add-member / delete, but
  // members/creator only come from getRooms. When the MB connector set or any label
  // diverges from what we have, re-fetch — so a DM someone adds you to (or renames,
  // or an admin deletes) updates your sidebar without a reload.
  useEffect(() => {
    if (!rooms.length) return; // initial load handled above
    const mbConns = socket.connectors.filter((c) => c.platform === "mb");
    const labelById = new Map(rooms.map((r) => [r.id, r.label]));
    let diverged = mbConns.length !== labelById.size;
    if (!diverged) {
      for (const c of mbConns) {
        const lab = labelById.get(c.id);
        if (lab === undefined || lab !== c.label) {
          diverged = true;
          break;
        }
      }
    }
    if (diverged) refreshRooms();
  }, [socket.connectors, rooms, refreshRooms]);

  // accumulate price history for sparklines (capped)
  useEffect(() => {
    const now = Date.now();
    setPriceHistory((prev) => {
      const next = { ...prev };
      for (const t of Object.values(socket.prices)) {
        const arr = (next[t.symbol] ?? []).concat({ t: now, price: t.price });
        next[t.symbol] = arr.length > 180 ? arr.slice(arr.length - 180) : arr;
      }
      return next;
    });
  }, [socket.prices]);

  const enabled = useMemo(() => new Set(layout.platforms as Platform[]), [layout.platforms]);
  const liveCount = socket.connectors.filter((c) => c.status.kind === "connected").length;

  const onRemoveSource = useCallback((id: string) => {
    removeSource(id).catch(() => {});
  }, []);

  const actions: RowActions = useMemo(
    () => ({
      isSaved: store.isSaved,
      toggleSave: store.toggleSave,
      hasNote: store.hasNote,
      addNote: (m: ChatMessage) => {
        store.addNote(m);
        layout.showSaved();
      },
      // real handlers are supplied by the Stage (they need composer state)
      reply: () => {},
      forward: () => {},
    }),
    [store, layout],
  );

  const value: DashboardCtx = {
    user,
    messages: socket.messages,
    posts: socket.posts,
    connectors: socket.connectors,
    connected: socket.connected,
    liveCount,
    post: socket.post,
    prices: socket.prices,
    priceHistory,
    markets: socket.markets,
    sentiment: socket.sentiment,
    viewers: socket.viewers,
    liveStreams: socket.liveStreams,
    store,
    layout,
    rooms,
    refreshRooms,
    activeRoom,
    setActiveRoom,
    enabled,
    allPlatforms: ALL,
    togglePlatform,
    showNews,
    toggleNews,
    view,
    setView,
    videoMode,
    setVideoMode,
    onRemoveSource,
    actions,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
