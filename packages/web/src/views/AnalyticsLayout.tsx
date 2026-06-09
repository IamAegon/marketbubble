import { NavLink, Outlet } from "react-router-dom";

interface Sub {
  to: string;
  end?: boolean;
  label: string;
  icon: string;
  hint: string;
}

/** Analytics section shell: a secondary left sidebar split into NOW (live) and
 * REVIEW (retrospective) + the active sub-page. Recording is no longer its own
 * page — it's a control strip on Pulse, the bridge between live and review. */
const NOW: Sub[] = [
  { to: "/app/analytics", end: true, label: "Pulse", icon: "◉", hint: "Live, all streams" },
  { to: "/app/analytics/reactions", label: "Reactions", icon: "✦", hint: "Energy, transcript & coach" },
];
const REVIEW: Sub[] = [
  { to: "/app/analytics/sessions", label: "Sessions", icon: "↻", hint: "Recorded shows" },
  { to: "/app/analytics/compare", label: "Compare", icon: "⇄", hint: "vs other streamers" },
];

function Group({ title, items }: { title: string; items: Sub[] }) {
  return (
    <div className="asub-group">
      <div className="asub-grouphead">{title}</div>
      {items.map((s) => (
        <NavLink
          key={s.to}
          to={s.to}
          end={s.end}
          className={({ isActive }) => `asub-item ${isActive ? "active" : ""}`}
          title={s.hint}
        >
          <span className="asub-ico">{s.icon}</span>
          <span className="asub-lbl">{s.label}</span>
          <span className="asub-hint">{s.hint}</span>
        </NavLink>
      ))}
    </div>
  );
}

export function AnalyticsLayout() {
  return (
    <div className="asection">
      <nav className="asub">
        <div className="asub-title">Analytics</div>
        <Group title="Now" items={NOW} />
        <Group title="Review" items={REVIEW} />
      </nav>
      <div className="asection-body">
        <Outlet />
      </div>
    </div>
  );
}
