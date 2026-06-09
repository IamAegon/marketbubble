import { useMemo, useState } from "react";
import type { TrendItem, TrendPlatform } from "@app/shared";
import { useTrendsFeed } from "../lib/useTrends";

const PLATFORM_META: Record<TrendPlatform, { label: string; icon: string }> = {
  tiktok: { label: "TikTok", icon: "🎵" },
  instagram: { label: "Instagram", icon: "📸" },
  bluesky: { label: "Bluesky", icon: "🦋" },
  search: { label: "Search", icon: "🔍" },
  reddit: { label: "Reddit", icon: "👾" },
  mastodon: { label: "Mastodon", icon: "🐘" },
  youtube: { label: "YouTube", icon: "▶️" },
  news: { label: "News", icon: "📰" },
};
// what hosts care about most leads the chip row
const PLATFORM_ORDER: TrendPlatform[] = ["tiktok", "instagram", "bluesky", "search", "reddit", "mastodon", "youtube", "news"];

const platformOf = (t: TrendItem): TrendPlatform => t.platform ?? "news";
// group by the lane prefix before " · " (e.g. "Bluesky · Politics" → "Bluesky")
const groupKey = (t: TrendItem) => t.source.split(" · ")[0]!;
const outlet = (t: TrendItem) => t.source.split(" · ")[1];

function ago(at?: number): string | null {
  if (!at) return null;
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function TrendCard({ t, rank }: { t: TrendItem; rank: number }) {
  const fresh = ago(t.at);
  return (
    <a className={`tcard ${t.tone ?? ""}`} href={t.url} target="_blank" rel="noopener noreferrer">
      <div className="tcard-top">
        {t.icon ? <img className="tcard-ico" src={t.icon} alt="" loading="lazy" /> : <span className="tcard-rank">#{rank}</span>}
        <span className="tcard-title">{t.title}</span>
        {t.traffic && <span className={`tcard-traffic ${t.tone ?? ""}`}>{t.traffic}</span>}
      </div>
      {t.snippet && <div className="tcard-snip">{t.snippet}</div>}
      <div className="tcard-foot">
        <span className="tcard-src">{outlet(t) ?? t.category ?? "open ↗"}</span>
        {fresh && <span className="tcard-fresh">⌁ {fresh}</span>}
      </div>
    </a>
  );
}

function ProviderSetup({ platform }: { platform: "tiktok" | "instagram" }) {
  const meta = PLATFORM_META[platform];
  const actorVar = platform === "tiktok" ? "TRENDS_APIFY_TIKTOK_ACTOR" : "TRENDS_APIFY_INSTAGRAM_ACTOR";
  return (
    <div className="tprov">
      <div className="tprov-ic">{meta.icon}</div>
      <h3>{meta.label} trends need a data provider</h3>
      <p>
        {meta.label} has no free public trends feed, so we pull it through a data provider. Connect an{" "}
        <a href="https://apify.com/store" target="_blank" rel="noopener noreferrer">
          Apify
        </a>{" "}
        actor and live {meta.label} hashtags will flow straight into this tab.
      </p>
      <ol>
        <li>Grab a free Apify API token (apify.com → Settings → Integrations).</li>
        <li>
          Pick a {meta.label} trends / hashtag actor from the{" "}
          <a href="https://apify.com/store" target="_blank" rel="noopener noreferrer">
            Apify Store
          </a>
          .
        </li>
        <li>
          Set <code>TRENDS_APIFY_TOKEN</code> and <code>{actorVar}</code> in the server environment, then restart. Trends refresh within ~5 min.
        </li>
      </ol>
    </div>
  );
}

export function TrendsView() {
  const { trends, providers } = useTrendsFeed();
  const [filter, setFilter] = useState<"all" | TrendPlatform>("all");

  const counts = useMemo(() => {
    const m = new Map<TrendPlatform, number>();
    for (const t of trends) {
      const p = platformOf(t);
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return m;
  }, [trends]);

  // every platform with items, plus TikTok/Instagram always (so they're discoverable even when off)
  const chips = useMemo(() => {
    const present = new Set<TrendPlatform>(counts.keys());
    present.add("tiktok");
    present.add("instagram");
    return PLATFORM_ORDER.filter((p) => present.has(p));
  }, [counts]);

  const shown = filter === "all" ? trends : trends.filter((t) => platformOf(t) === filter);

  const groups = useMemo(() => {
    const m = new Map<string, TrendItem[]>();
    for (const t of shown) {
      const k = groupKey(t);
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    }
    return [...m.entries()];
  }, [shown]);

  const providerOff = (filter === "tiktok" && !providers.tiktok) || (filter === "instagram" && !providers.instagram);
  const anyProviderOff = !providers.tiktok || !providers.instagram;

  return (
    <div className="tview">
      <div className="tview-head">
        <h2>Trends</h2>
        <p>What people are talking about across social, search and the news cycle right now — your on-stream talking points.</p>
      </div>

      <div className="tfilter">
        <button className={`tchip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
          All <span className="tchip-n">{trends.length}</span>
        </button>
        {chips.map((p) => {
          const n = counts.get(p) ?? 0;
          return (
            <button key={p} className={`tchip ${filter === p ? "on" : ""}`} onClick={() => setFilter(p)}>
              <span className="tchip-ic">{PLATFORM_META[p].icon}</span> {PLATFORM_META[p].label}
              {n ? <span className="tchip-n">{n}</span> : <span className="tchip-lock">＋</span>}
            </button>
          );
        })}
      </div>

      {anyProviderOff && filter === "all" && (
        <div className="tprov-note">
          TikTok &amp; Instagram trends need a data provider —{" "}
          <button className="linklike" onClick={() => setFilter(!providers.tiktok ? "tiktok" : "instagram")}>
            set one up
          </button>
          .
        </div>
      )}

      {providerOff ? (
        <ProviderSetup platform={filter as "tiktok" | "instagram"} />
      ) : trends.length === 0 ? (
        <div className="cc-empty-sm">Loading what the world’s talking about…</div>
      ) : shown.length === 0 ? (
        <div className="cc-empty-sm">No {filter === "all" ? "" : `${PLATFORM_META[filter as TrendPlatform].label} `}trends right now.</div>
      ) : (
        groups.map(([source, items]) => (
          <section className="tgroup" key={source}>
            <div className="tgroup-head">
              <h3>{source}</h3>
              <span className="tgroup-count">{items.length}</span>
            </div>
            <div className="tgrid">
              {items.map((t, i) => (
                <TrendCard t={t} rank={i + 1} key={`${source}-${i}`} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
