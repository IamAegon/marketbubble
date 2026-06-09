import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { ChatMessage, Platform } from "@app/shared";
import { UserLink } from "../components/UserLink";

/** Compact live chat stats for the Live rail (msgs/min, activity sparkbars, top chatters). */
export function StatsMini({ messages }: { messages: ChatMessage[] }) {
  const s = useMemo(() => {
    const chat = messages.filter((m) => m.kind !== "post");
    const now = Date.now();
    const last5 = chat.filter((m) => now - m.receivedAt < 300_000).length;
    const users = new Set(chat.map((m) => `${m.platform}:${m.author.username}`));
    const buckets = new Array(12).fill(0);
    for (const m of chat) {
      const ago = Math.floor((now - m.receivedAt) / 60_000);
      if (ago >= 0 && ago < 12) buckets[11 - ago]++;
    }
    const peak = Math.max(1, ...buckets);
    const byUser = new Map<string, { name: string; n: number; platform: Platform; username: string }>();
    for (const m of chat) {
      const k = `${m.platform}:${m.author.username}`;
      const e = byUser.get(k) ?? { name: m.author.displayName, n: 0, platform: m.platform, username: m.author.username };
      e.n++;
      byUser.set(k, e);
    }
    const top = [...byUser.values()].sort((a, b) => b.n - a.n).slice(0, 5);
    return { perMin: last5 / 5, users: users.size, buckets, peak, top };
  }, [messages]);

  if (s.users === 0) return <div className="cc-empty-sm">Chat activity will appear here as messages arrive.</div>;

  return (
    <div className="stats-mini">
      <div className="sm-row">
        <span>
          <b>{s.perMin.toFixed(1)}</b> msgs/min
        </span>
        <span>
          <b>{s.users}</b> chatters
        </span>
      </div>
      <div className="abars mini">
        {s.buckets.map((v, i) => (
          <div className="abar" key={i} title={`${v} msgs`}>
            <div className="abar-fill" style={{ height: `${(v / s.peak) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="sm-top">
        {s.top.map((u, i) => (
          <div className="sm-top-row" key={i}>
            <span className="atop-rank">{i + 1}</span>
            <UserLink platform={u.platform} username={u.username} name={u.name} className="atop-name" />
            <span className="atop-count">{u.n}</span>
          </div>
        ))}
      </div>
      <Link to="/app/analytics" className="sm-more">
        Full analytics →
      </Link>
    </div>
  );
}
