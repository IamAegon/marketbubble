import { useCallback, useEffect, useState } from "react";

const KEY = "mb.layout.v1";

export type Density = "comfortable" | "compact";

/** Live chat presentation: a single centered unified feed · multi-column deck */
export type ChatView = "unified" | "columns";

/** views (data-mbview) where a notification pop-up can appear */
export const NOTIF_VIEWS = ["live", "rooms", "markets", "portfolio", "checklist", "show", "trends", "feed", "assistant", "analytics", "settings"] as const;
/** the gateable notification types */
export const NOTIF_TYPES = [
  { id: "highlight", label: "Highlight matches" },
  { id: "price", label: "Price moves" },
  { id: "room", label: "Room messages" },
] as const;

/** the page the user is on right now (data-mbview set by AppShell) */
export function currentView(): string {
  return (typeof document !== "undefined" && document.documentElement.dataset.mbview) || "live";
}
/** whether a notification type's transient pop-up should show on the current page */
export function popupAllowed(notifyPages: Record<string, string[]>, type: string): boolean {
  return (notifyPages[type] ?? [...NOTIF_VIEWS]).includes(currentView());
}

export interface LayoutState {
  navCollapsed: boolean;
  tickerCollapsed: boolean;
  railHidden: boolean;
  videoCollapsed: boolean;
  panelCollapsed: Record<string, boolean>;
  /** custom accent color (hex) overriding --accent; "" = theme default */
  accent: string;
  /** color theme id → data-theme on <html> (desk | midnight | noir | paper) */
  theme: string;
  density: Density;
  /** desktop notifications on highlight-term matches */
  notify: boolean;
  /** desktop notifications when a price moves >= priceSigma over the last hour */
  priceAlerts: boolean;
  priceSigma: number;
  /** notify on new messages in Market Bubble rooms you aren't currently focused on */
  roomNotify: boolean;
  /** show the Jarvis-style market + streamer brief on login */
  loginBrief: boolean;
  /** per notification type → views where the in-app pop-up still appears */
  notifyPages: Record<string, string[]>;
  // ---- Live workspace prefs (persisted so they survive view-switch + reload) ----
  /** chat layout on Live */
  chatView: ChatView;
  /** constrain the unified feed to a centered reading column (vs full-width like before) */
  feedCentered: boolean;
  /** video dock mode */
  videoMode: "theater" | "grid";
  /** show tracked-account news posts inline in the unified feed */
  showNews: boolean;
  /** enabled platform filters (twitch/x/kick/mb) */
  platforms: string[];
  /** connector ids of columns the user has closed in Columns view */
  hiddenColumns: string[];
  /** room ids the user has hidden from their own Rooms sidebar ("hide for me" — reversible) */
  hiddenRooms: string[];
  /** last-selected Market Bubble room (composer default) */
  activeRoom: string;
  /** chat backdrop behind the live feed: none | dusk | studio | midnight | aurora | custom */
  chatBg: string;
  /** custom chat backdrop image URL (used when chatBg === "custom") */
  chatBgUrl: string;
}

const DEFAULT: LayoutState = {
  navCollapsed: false,
  tickerCollapsed: false,
  railHidden: false,
  videoCollapsed: false,
  panelCollapsed: { notifications: false, markets: false, news: false, trends: false, stats: true, saved: false, modlog: true },
  accent: "",
  theme: "desk",
  density: "comfortable",
  notify: false,
  priceAlerts: false,
  priceSigma: 2.5,
  roomNotify: false,
  loginBrief: true,
  notifyPages: {
    highlight: [...NOTIF_VIEWS],
    price: [...NOTIF_VIEWS],
    room: [...NOTIF_VIEWS],
  },
  chatView: "unified",
  feedCentered: true,
  videoMode: "theater",
  showNews: false,
  platforms: ["twitch", "x", "kick", "mb"],
  hiddenColumns: [],
  hiddenRooms: [],
  activeRoom: "mb:shared",
  chatBg: "none",
  chatBgUrl: "",
};

function load(): LayoutState {
  try {
    const r = localStorage.getItem(KEY);
    if (!r) return DEFAULT;
    const p = JSON.parse(r);
    return {
      ...DEFAULT,
      ...p,
      panelCollapsed: { ...DEFAULT.panelCollapsed, ...(p.panelCollapsed ?? {}) },
      notifyPages: { ...DEFAULT.notifyPages, ...(p.notifyPages ?? {}) },
    };
  } catch {
    return DEFAULT;
  }
}

export function useLayout() {
  const [s, setS] = useState<LayoutState>(load);
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(s));
  }, [s]);

  // apply theme prefs to the document root
  useEffect(() => {
    const root = document.documentElement;
    if (s.accent) root.style.setProperty("--accent", s.accent);
    else root.style.removeProperty("--accent");
    root.dataset.density = s.density;
    root.dataset.theme = s.theme;
    root.dataset.chatbg = s.chatBg;
    const safeUrl = s.chatBgUrl.replace(/["'()\\]/g, "").trim();
    if (s.chatBg === "custom" && safeUrl) root.style.setProperty("--chat-bg-url", `url("${safeUrl}")`);
    else root.style.removeProperty("--chat-bg-url");
  }, [s.accent, s.density, s.theme, s.chatBg, s.chatBgUrl]);

  const toggleNav = useCallback(() => setS((p) => ({ ...p, navCollapsed: !p.navCollapsed })), []);
  const toggleTicker = useCallback(() => setS((p) => ({ ...p, tickerCollapsed: !p.tickerCollapsed })), []);
  const toggleRail = useCallback(() => setS((p) => ({ ...p, railHidden: !p.railHidden })), []);
  const toggleVideo = useCallback(() => setS((p) => ({ ...p, videoCollapsed: !p.videoCollapsed })), []);
  const togglePanel = useCallback(
    (id: string) => setS((p) => ({ ...p, panelCollapsed: { ...p.panelCollapsed, [id]: !p.panelCollapsed[id] } })),
    [],
  );
  const showSaved = useCallback(
    () => setS((p) => ({ ...p, railHidden: false, panelCollapsed: { ...p.panelCollapsed, saved: false } })),
    [],
  );
  const setAccent = useCallback((accent: string) => setS((p) => ({ ...p, accent })), []);
  const setTheme = useCallback((theme: string) => setS((p) => ({ ...p, theme })), []);
  const setDensity = useCallback((density: Density) => setS((p) => ({ ...p, density })), []);
  const setNotify = useCallback((notify: boolean) => setS((p) => ({ ...p, notify })), []);
  const setPriceAlerts = useCallback((priceAlerts: boolean) => setS((p) => ({ ...p, priceAlerts })), []);
  const setPriceSigma = useCallback((priceSigma: number) => setS((p) => ({ ...p, priceSigma })), []);
  const setRoomNotify = useCallback((roomNotify: boolean) => setS((p) => ({ ...p, roomNotify })), []);
  const setLoginBrief = useCallback((loginBrief: boolean) => setS((p) => ({ ...p, loginBrief })), []);
  const toggleNotifyPage = useCallback(
    (type: string, view: string) =>
      setS((p) => {
        const cur = p.notifyPages[type] ?? [];
        const next = cur.includes(view) ? cur.filter((v) => v !== view) : [...cur, view];
        return { ...p, notifyPages: { ...p.notifyPages, [type]: next } };
      }),
    [],
  );
  const setChatView = useCallback((chatView: ChatView) => setS((p) => ({ ...p, chatView })), []);
  const toggleFeedCentered = useCallback(() => setS((p) => ({ ...p, feedCentered: !p.feedCentered })), []);
  const setVideoMode = useCallback((videoMode: "theater" | "grid") => setS((p) => ({ ...p, videoMode })), []);
  const toggleNews = useCallback(() => setS((p) => ({ ...p, showNews: !p.showNews })), []);
  const togglePlatform = useCallback(
    (plat: string) =>
      setS((p) => ({
        ...p,
        platforms: p.platforms.includes(plat) ? p.platforms.filter((x) => x !== plat) : [...p.platforms, plat],
      })),
    [],
  );
  const toggleColumn = useCallback(
    (id: string) =>
      setS((p) => ({
        ...p,
        hiddenColumns: p.hiddenColumns.includes(id) ? p.hiddenColumns.filter((x) => x !== id) : [...p.hiddenColumns, id],
      })),
    [],
  );
  const showAllColumns = useCallback(() => setS((p) => ({ ...p, hiddenColumns: [] })), []);
  const toggleHiddenRoom = useCallback(
    (id: string) =>
      setS((p) => ({
        ...p,
        hiddenRooms: p.hiddenRooms.includes(id) ? p.hiddenRooms.filter((x) => x !== id) : [...p.hiddenRooms, id],
      })),
    [],
  );
  const showAllRooms = useCallback(() => setS((p) => ({ ...p, hiddenRooms: [] })), []);
  const setActiveRoom = useCallback((activeRoom: string) => setS((p) => ({ ...p, activeRoom })), []);
  const setChatBg = useCallback((chatBg: string) => setS((p) => ({ ...p, chatBg })), []);
  const setChatBgUrl = useCallback((chatBgUrl: string) => setS((p) => ({ ...p, chatBgUrl })), []);
  const reset = useCallback(() => setS(DEFAULT), []);

  return {
    ...s,
    toggleNav,
    toggleTicker,
    toggleRail,
    toggleVideo,
    togglePanel,
    showSaved,
    setAccent,
    setTheme,
    setDensity,
    setNotify,
    setPriceAlerts,
    setPriceSigma,
    setRoomNotify,
    setLoginBrief,
    toggleNotifyPage,
    setChatView,
    toggleFeedCentered,
    setVideoMode,
    toggleNews,
    togglePlatform,
    toggleColumn,
    showAllColumns,
    toggleHiddenRoom,
    showAllRooms,
    setActiveRoom,
    setChatBg,
    setChatBgUrl,
    reset,
    isPanelCollapsed: (id: string) => !!s.panelCollapsed[id],
  };
}

export type LayoutApi = ReturnType<typeof useLayout>;
