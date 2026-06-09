import type { ReactNode } from "react";

/** A collapsible stacked panel for the right rail. */
export function Panel({
  title,
  badge,
  collapsed,
  onToggle,
  actions,
  grow,
  children,
}: {
  title: string;
  badge?: string | number;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  /** when true and expanded, this panel flexes to fill leftover rail height */
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`cc-panel ${collapsed ? "collapsed" : ""} ${grow && !collapsed ? "grow" : ""}`}>
      <header className="cc-panel-h" onClick={onToggle}>
        <span className="cc-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="cc-panel-title">{title}</span>
        {badge !== undefined && badge !== "" && <span className="cc-panel-badge">{badge}</span>}
        {actions && (
          <span className="cc-panel-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </header>
      {!collapsed && <div className="cc-panel-body">{children}</div>}
    </section>
  );
}
