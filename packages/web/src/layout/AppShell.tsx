import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { DashboardProvider, useDashboard } from "../state/DashboardProvider";
import { PricesProvider } from "../state/prices";
import { ChatterStatsProvider } from "../state/chatterStats";
import { HighlightsProvider } from "../state/highlights";
import { MutedProvider } from "../state/muted";
import { ToastProvider } from "../state/toasts";
import { PlatformProvider } from "../state/usePlatform";
import { MbAvatarProvider } from "../state/mbAvatars";
import { AuthorFocusProvider } from "../state/authorFocus";
import { NotificationBridge } from "../state/NotificationBridge";
import { PriceAlertBridge } from "../state/PriceAlertBridge";
import { TeamBridge } from "../state/TeamBridge";
import { WelcomeBridge } from "../state/WelcomeBridge";
import { ShareCardProvider } from "../feed/ShareCard";
import { CommandPalette } from "../cmd/CommandPalette";
import { BriefModal } from "./BriefModal";
import { PrimaryNav } from "./PrimaryNav";
import { TopBar } from "./TopBar";
import { TickerStrip } from "./TickerStrip";

function Shell() {
  const d = useDashboard();
  const loc = useLocation();
  // expose the active view so layout-aware bits (e.g. toasts clearing the composer) can adapt
  useEffect(() => {
    const p = loc.pathname;
    const view = p.includes("/rooms")
      ? "rooms"
      : p.includes("/portfolio")
      ? "portfolio"
      : p.includes("/studio")
      ? "studio"
      : p.includes("/transcript")
      ? "transcript"
      : p.includes("/markets")
      ? "markets"
      : p.includes("/feed")
        ? "feed"
        : p.includes("/trends")
        ? "trends"
        : p.includes("/assistant")
          ? "assistant"
          : p.includes("/analytics")
          ? "analytics"
          : p.includes("/settings")
            ? "settings"
            : "live";
    document.documentElement.dataset.mbview = view;
  }, [loc.pathname]);
  return (
    <PricesProvider value={d.prices}>
      <ChatterStatsProvider messages={d.messages}>
        <HighlightsProvider>
          <MutedProvider>
          <ToastProvider>
          <PlatformProvider>
          <MbAvatarProvider>
          <AuthorFocusProvider>
          <ShareCardProvider>
            <NotificationBridge />
            <PriceAlertBridge />
            <TeamBridge />
            <WelcomeBridge />
            <div className="cc-app">
              <PrimaryNav />
              <div className="cc-content">
                <TopBar />
                <TickerStrip
                  collapsed={d.layout.tickerCollapsed}
                  onToggle={d.layout.toggleTicker}
                  prices={d.prices}
                />
                <main className="cc-view">
                  <Outlet />
                </main>
              </div>
            </div>
            <CommandPalette />
            <BriefModal />
          </ShareCardProvider>
          </AuthorFocusProvider>
          </MbAvatarProvider>
          </PlatformProvider>
          </ToastProvider>
          </MutedProvider>
        </HighlightsProvider>
      </ChatterStatsProvider>
    </PricesProvider>
  );
}

export function AppShell() {
  return (
    <DashboardProvider>
      <Shell />
    </DashboardProvider>
  );
}
