import { useDashboard } from "../state/DashboardProvider";
import { Stage } from "../layout/Stage";
import { RightRail } from "../layout/RightRail";

export function LiveView() {
  const d = useDashboard();
  return (
    <div className={`live ${d.layout.railHidden ? "rail-hidden" : ""}`}>
      <Stage
        messages={d.messages}
        posts={d.posts}
        enabled={d.enabled}
        showNews={d.showNews}
        view={d.view}
        connectors={d.connectors}
        rooms={d.rooms}
        activeRoom={d.activeRoom}
        setActiveRoom={d.setActiveRoom}
        post={d.post}
        userDisplayName={d.user?.displayName ?? "you"}
        actions={d.actions}
        videoCollapsed={d.layout.videoCollapsed}
        videoMode={d.videoMode}
        centered={d.layout.feedCentered}
      />
      {!d.layout.railHidden && (
        <RightRail store={d.store} layout={d.layout} markets={d.markets} posts={d.posts} messages={d.messages} />
      )}
    </div>
  );
}
