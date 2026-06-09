import type { ChatMessage } from "@app/shared";

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function NewsPanel({ posts }: { posts: ChatMessage[] }) {
  if (!posts.length) {
    return (
      <div className="cc-empty-sm">
        No posts yet — tracked X accounts poll ~every minute. Add or manage them in Settings.
      </div>
    );
  }
  const sorted = [...posts].sort((a, b) => b.timestamp - a.timestamp).slice(0, 40);
  return (
    <div className="news-list">
      {sorted.map((p) => (
        <a className="news-item" key={p.id} href={p.link} target="_blank" rel="noopener noreferrer">
          <div className="news-meta">
            <span className="news-handle">@{p.author.username}</span>
            {p.category && <span className="news-cat">{p.category}</span>}
            <span className="news-ago">{ago(p.timestamp)}</span>
          </div>
          <div className="news-text">{p.text}</div>
        </a>
      ))}
    </div>
  );
}
