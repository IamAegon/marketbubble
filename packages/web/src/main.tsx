import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./state/useAuth";
import { Landing } from "./auth/Landing";
import { AppShell } from "./layout/AppShell";
import { LiveView } from "./views/LiveView";
import { MarketsLayout } from "./views/MarketsLayout";
import { MarketsView } from "./views/MarketsView";
import { NewsView } from "./views/NewsView";
import { PortfolioView } from "./views/PortfolioView";
import { ChecklistView } from "./views/ChecklistView";
import { ShowPlanningView } from "./views/ShowPlanningView";
import { StudioLayout } from "./views/StudioLayout";
import { TrendsView } from "./views/TrendsView";
import { XFeedView } from "./views/XFeedView";
import { RoomsView } from "./views/RoomsView";
import { AssistantView } from "./views/AssistantView";
import { AnalyticsLayout } from "./views/AnalyticsLayout";
import { AnalyticsView } from "./views/AnalyticsView";
import { PerformanceLab } from "./views/PerformanceLab";
import { ComparisonView } from "./views/ComparisonView";
import { HistoryView } from "./views/HistoryView";
import { SessionReport } from "./views/SessionReport";
import { SettingsView } from "./views/SettingsView";
import { OverlayApp } from "./overlay/OverlayApp";
import "./styles.css";

function Protected({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot" />;
  return user ? children : <Navigate to="/" replace />;
}

const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  {
    path: "/app",
    element: (
      <Protected>
        <AppShell />
      </Protected>
    ),
    children: [
      { index: true, element: <LiveView /> },
      {
        path: "markets",
        element: <MarketsLayout />,
        children: [
          { index: true, element: <MarketsView /> },
          { path: "news", element: <NewsView /> },
        ],
      },
      { path: "portfolio", element: <PortfolioView /> },
      {
        path: "studio",
        element: <StudioLayout />,
        children: [
          { index: true, element: <ShowPlanningView /> },
          { path: "run", element: <ChecklistView /> },
        ],
      },
      { path: "trends", element: <TrendsView /> },
      { path: "feed", element: <XFeedView /> },
      { path: "rooms", element: <RoomsView /> },
      { path: "assistant", element: <AssistantView /> },
      {
        path: "analytics",
        element: <AnalyticsLayout />,
        children: [
          { index: true, element: <AnalyticsView /> }, // Pulse (live)
          { path: "reactions", element: <PerformanceLab /> },
          { path: "sessions", element: <HistoryView /> },
          { path: "sessions/:id", element: <SessionReport /> },
          { path: "compare", element: <ComparisonView /> },
        ],
      },
      { path: "settings", element: <SettingsView /> },
    ],
  },
  { path: "/overlay", element: <OverlayApp /> }, // public — OBS browser source
  { path: "*", element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);
