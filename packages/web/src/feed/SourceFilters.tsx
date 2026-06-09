import type { ConnectorInfo, Platform } from "@app/shared";

const ALL: { p: Platform; label: string }[] = [
  { p: "twitch", label: "Twitch" },
  { p: "x", label: "X" },
  { p: "kick", label: "Kick" },
  { p: "mb", label: "MB" },
];

export function SourceFilters({
  enabled,
  onToggle,
  connectors,
  showNews,
  onToggleNews,
}: {
  enabled: Set<Platform>;
  onToggle: (p: Platform) => void;
  connectors: ConnectorInfo[];
  showNews: boolean;
  onToggleNews: () => void;
}) {
  return (
    <div className="filters">
      <span className="filters-label">Show</span>
      {ALL.map(({ p, label }) => {
        const of = connectors.filter((c) => c.platform === p);
        const liveAny = of.some((c) => c.status.kind === "connected");
        return (
          <button
            key={p}
            className={`chip ${enabled.has(p) ? "active" : ""}`}
            onClick={() => onToggle(p)}
            title={of.map((c) => `${c.label} · ${c.status.kind}`).join("\n") || "no channels"}
          >
            <span className="dot" style={{ background: `var(--${p})` }} />
            {label}
            {of.length ? (liveAny ? " ●" : " ○") : ""}
          </button>
        );
      })}
      {/* News (tracked-account posts) is its own toggle so X chat ≠ X news in the feed */}
      <button
        className={`chip ${showNews ? "active" : ""}`}
        onClick={onToggleNews}
        title="Show tracked X-account news posts inline in the feed (they always show in the News rail)"
      >
        <span className="dot" style={{ background: "var(--accent)" }} />
        News
      </button>
    </div>
  );
}
