import { useState } from "react";
import type { NewsArticle, NewsLane } from "@app/shared";
import { useNews } from "../lib/useNews";
import { useDashboard } from "../state/DashboardProvider";
import { useToasts } from "../state/toasts";
import { useAskAI, newsAskPrompt } from "../lib/askAI";

function ago(t: number): string {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function Row({ a, onForward, onAsk }: { a: NewsArticle; onForward: (a: NewsArticle) => void; onAsk: (a: NewsArticle) => void }) {
  return (
    <a className="nrow" href={a.url} target="_blank" rel="noopener noreferrer">
      <span className="nrow-time">{a.time ?? "—"}</span>
      <span className="nrow-main">
        <span className="nrow-title">{a.title}</span>
        <span className="nrow-meta">
          <span className="nrow-src">{a.source}</span>
          {a.tickers?.map((t) => (
            <span className="nrow-tk" key={t}>
              {t}
            </span>
          ))}
        </span>
      </span>
      <span className="nrow-acts">
        <button
          className="nrow-fwd"
          title="Ask the AI about this headline"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAsk(a);
          }}
        >
          ✦
        </button>
        <button
          className="nrow-fwd"
          title="Forward to a Market Bubble chat"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onForward(a);
          }}
        >
          ➦
        </button>
      </span>
    </a>
  );
}

function Column({
  title,
  items,
  onForward,
  onAsk,
}: {
  title: string;
  items: NewsArticle[];
  onForward: (a: NewsArticle) => void;
  onAsk: (a: NewsArticle) => void;
}) {
  return (
    <section className={`ncol ncol-${title.toLowerCase()}`}>
      <div className="ncol-head">
        <h3>{title}</h3>
        <span className="ncol-n">{items.length}</span>
      </div>
      <div className="ncol-list">
        {items.length === 0 ? (
          <div className="cc-empty-sm">Nothing here right now.</div>
        ) : (
          items.map((a, i) => <Row a={a} key={a.url + i} onForward={onForward} onAsk={onAsk} />)
        )}
      </div>
    </section>
  );
}

export function NewsView() {
  const { articles, updatedAt, loading } = useNews();
  const d = useDashboard();
  const { push } = useToasts();
  const askAI = useAskAI();
  const onAsk = (a: NewsArticle) => askAI(newsAskPrompt(a));
  const [lane, setLane] = useState<"all" | NewsLane>("all");
  const [q, setQ] = useState("");
  const [fwd, setFwd] = useState<NewsArticle | null>(null); // article being forwarded to a chat

  const ql = q.trim().toLowerCase();
  const match = (a: NewsArticle) =>
    !ql ||
    a.title.toLowerCase().includes(ql) ||
    a.source.toLowerCase().includes(ql) ||
    (a.tickers ?? []).some((t) => t.toLowerCase().includes(ql));

  const crypto = articles.filter((a) => a.lane === "crypto" && match(a));
  const markets = articles.filter((a) => a.lane === "markets" && match(a));
  const cCount = articles.filter((a) => a.lane === "crypto").length;
  const mCount = articles.filter((a) => a.lane === "markets").length;

  const LANES: { id: "all" | NewsLane; label: string; n: number }[] = [
    { id: "all", label: "All", n: cCount + mCount },
    { id: "crypto", label: "Crypto", n: cCount },
    { id: "markets", label: "Markets", n: mCount },
  ];

  const doForward = (roomId: string) => {
    if (!fwd) return;
    d.post(roomId, `${fwd.source}: ${fwd.title}`, undefined, {
      kind: "news",
      title: fwd.source,
      markdown: fwd.title,
      link: fwd.url,
    });
    const room = d.rooms.find((r) => r.id === roomId);
    setFwd(null);
    push({ title: "Forwarded", body: `Headline sent to ${room?.label ?? "chat"}.`, kind: "room" });
  };

  return (
    <div className="nview">
      <div className="nview-head">
        <div className="nview-head-l">
          <h2>News</h2>
          <p>
            Live crypto &amp; markets headlines, aggregated from Finviz.
            {updatedAt ? ` Updated ${ago(updatedAt)}.` : ""}
          </p>
        </div>
        <input
          className="cc-search nview-search"
          placeholder="Filter headlines, source, ticker…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="nfilter">
        {LANES.map((l) => (
          <button key={l.id} className={`cc-chip ${lane === l.id ? "active" : ""}`} onClick={() => setLane(l.id)}>
            {l.label}
            <span className="pm-cat-n">{l.n}</span>
          </button>
        ))}
      </div>

      {loading && articles.length === 0 ? (
        <div className="cc-empty-sm">Loading the tape…</div>
      ) : lane === "all" ? (
        <div className="ncols">
          <Column title="Crypto" items={crypto} onForward={setFwd} onAsk={onAsk} />
          <Column title="Markets" items={markets} onForward={setFwd} onAsk={onAsk} />
        </div>
      ) : (
        <div className="ncol-single">
          <Column title={lane === "crypto" ? "Crypto" : "Markets"} items={lane === "crypto" ? crypto : markets} onForward={setFwd} onAsk={onAsk} />
        </div>
      )}

      {fwd && (
        <div className="fwd-overlay" onClick={() => setFwd(null)}>
          <div className="fwd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fwd-head">Forward headline to a chat</div>
            <div className="fwd-quote">
              <div className="fwd-quote-text">
                {fwd.source}: {fwd.title.slice(0, 220)}
              </div>
            </div>
            {d.rooms.length === 0 ? (
              <div className="cc-empty-sm">Join a chat first.</div>
            ) : (
              <div className="fwd-rooms">
                {d.rooms.map((r) => (
                  <button key={r.id} onClick={() => doForward(r.id)}>
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            <button className="fwd-cancel" onClick={() => setFwd(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
