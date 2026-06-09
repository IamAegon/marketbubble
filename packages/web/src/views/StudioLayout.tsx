import { NavLink, Outlet } from "react-router-dom";

/** Studio section: pre-show prep under one roof — Planning (schedule / guests /
 * topics / AI brief) + Run of Show (the pre-stream checklist) — via a secondary
 * sub-nav, mirroring the Analytics section. */
const SUB = [
  { to: "/app/studio", end: true, label: "Planning", icon: "◷", hint: "Schedule · guests · topics" },
  { to: "/app/studio/run", end: false, label: "Run of Show", icon: "☑", hint: "Pre-stream checklist" },
];

export function StudioLayout() {
  return (
    <div className="asection">
      <nav className="asub">
        <div className="asub-title">Studio</div>
        {SUB.map((s) => (
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
      </nav>
      <div className="asection-body">
        <Outlet />
      </div>
    </div>
  );
}
