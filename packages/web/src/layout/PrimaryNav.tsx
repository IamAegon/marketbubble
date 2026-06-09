import { NavLink } from "react-router-dom";
import { useAuth } from "../state/useAuth";

function Bubble() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="26" height="26" aria-hidden>
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.2 3.6A.6.6 0 0 1 5 19.1V16h-.5A2.5 2.5 0 0 1 2 13.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        transform="translate(1 1)"
      />
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

// The live cockpit (Live · Rooms) are anchors — the present-tense surfaces you
// watch while on air; the rest group by the question they answer.
const ANCHORS: NavItem[] = [
  { to: "/app", label: "Live", icon: "◉", end: true },
  { to: "/app/rooms", label: "Rooms", icon: "#" },
];
const GROUPS: { label?: string; items: NavItem[] }[] = [
  // pre-show prep: Planning + Run of Show, under one Studio roof
  { items: [{ to: "/app/studio", label: "Studio", icon: "◷" }] },
  // "what's the market / our position" — the trading edge
  {
    label: "Markets",
    items: [
      { to: "/app/markets", label: "Markets", icon: "$" },
      { to: "/app/portfolio", label: "Portfolio", icon: "▰" },
      { to: "/app/trends", label: "Trends", icon: "✦" },
      { to: "/app/feed", label: "X Feed", icon: "𝕏" },
    ],
  },
  // "how did we do / how do we improve" — single hub icon (Perf Lab lives inside it)
  { items: [{ to: "/app/analytics", label: "Analytics", icon: "▦" }] },
  // the AI copilot — a primary surface, not a buried tool
  { items: [{ to: "/app/assistant", label: "Assistant", icon: "✺" }] },
];
// only Settings is pinned to the bottom (the user/admin button sits beneath it)
const TOOLS: NavItem[] = [{ to: "/app/settings", label: "Settings", icon: "⚙" }];

function NavItemLink({ it }: { it: NavItem }) {
  return (
    <NavLink
      to={it.to}
      end={it.end}
      className={({ isActive }) => `pnav-item ${isActive ? "active" : ""}`}
      title={it.label}
    >
      <span className="pnav-ico">{it.icon}</span>
      <span className="pnav-lbl">{it.label}</span>
    </NavLink>
  );
}

export function PrimaryNav() {
  const { user, logout } = useAuth();
  return (
    <nav className="pnav">
      <div className="pnav-brand" title="Market Bubble">
        <Bubble />
      </div>
      <div className="pnav-items">
        {ANCHORS.map((it) => (
          <NavItemLink key={it.to} it={it} />
        ))}
        {GROUPS.map((g, i) => (
          <div className="pnav-group" key={g.label ?? i}>
            {g.label && <div className="pnav-sec">{g.label}</div>}
            {g.items.map((it) => (
              <NavItemLink key={it.to} it={it} />
            ))}
          </div>
        ))}
      </div>
      <div className="pnav-foot">
        {TOOLS.map((it) => (
          <NavItemLink key={it.to} it={it} />
        ))}
        {user && (
          <button className="pnav-user" onClick={logout} title={`@${user.handle} · ${user.role} · log out`}>
            <span className="user-dot" style={{ background: user.color }} />
            <span className="pnav-lbl">{user.displayName.split(" ")[0]}</span>
          </button>
        )}
      </div>
    </nav>
  );
}
