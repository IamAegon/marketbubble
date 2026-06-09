import { NavLink, Outlet } from "react-router-dom";

/** Markets section: the live tape (prices, charts, prediction markets) + a dedicated
 * News reading page — via a secondary sub-nav, mirroring Analytics / Studio. */
const SUB = [
  { to: "/app/markets", end: true, label: "Overview", icon: "$", hint: "Prices · charts · prediction markets" },
  { to: "/app/markets/news", end: false, label: "News", icon: "📰", hint: "Crypto & markets headlines" },
];

export function MarketsLayout() {
  return (
    <div className="asection">
      <nav className="asub">
        <div className="asub-title">Markets</div>
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
