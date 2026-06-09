import { useEffect, useState } from "react";
import type { PriceTick } from "@app/shared";
import { fmtPrice as fmt, pricePrefix } from "../finance/format";

// US-equities session clock, all client-side. We read New-York wall-clock parts via
// Intl (so DST is handled for us) and bucket the minute-of-day into the standard
// pre-market / regular / after-hours / closed windows. Crypto is 24/7, so this is
// explicitly the equities session — the tape's "what time is it for stocks" anchor.
type SessionTone = "open" | "ext" | "closed";
function marketSession(now: Date): { label: string; tone: SessionTone; clock: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0; // some engines emit "24" at midnight under h23
  const mm = parseInt(get("minute"), 10);
  const clock = `${String(hh).padStart(2, "0")}:${get("minute")}`;
  const mins = hh * 60 + mm;
  if (wd === "Sat" || wd === "Sun") return { label: "CLOSED", tone: "closed", clock };
  if (mins >= 240 && mins < 570) return { label: "PRE-MARKET", tone: "ext", clock }; // 04:00–09:30
  if (mins >= 570 && mins < 960) return { label: "OPEN", tone: "open", clock }; //       09:30–16:00
  if (mins >= 960 && mins < 1200) return { label: "AFTER HRS", tone: "ext", clock }; //  16:00–20:00
  return { label: "CLOSED", tone: "closed", clock };
}

function MarketSession() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = marketSession(now);
  return (
    <div className={`cc-session ${s.tone}`} title={`US equities · ${s.label} · New York time`}>
      <span className="cc-session-dot" />
      <span className="cc-session-lbl">NY · {s.label}</span>
      <span className="cc-session-clock">{s.clock}</span>
    </div>
  );
}

// open-source coin logos (spothq/cryptocurrency-icons) via jsDelivr — color SVGs keyed by
// lowercase symbol. Cached at the edge; anything missing (newer coins, macro) falls back
// to a clean monogram so the tape never shows a broken image.
const ICON_BASE = "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";

function Ticker({ t }: { t: PriceTick }) {
  const [noIcon, setNoIcon] = useState(false);
  const ch = t.change24h ?? 0;
  const up = ch >= 0;
  const prefix = pricePrefix(t);
  const showLogo = t.kind !== "macro" && !noIcon;
  return (
    <div className="cc-card" title={`${t.name ?? t.symbol} · ${t.source}`}>
      {showLogo ? (
        <img
          className="cc-card-ico"
          src={`${ICON_BASE}/${t.symbol.toLowerCase()}.svg`}
          alt=""
          loading="lazy"
          onError={() => setNoIcon(true)}
        />
      ) : (
        <span className="cc-card-ico cc-card-ico-fb">{t.symbol.slice(0, 1)}</span>
      )}
      <span className="cc-card-sym">{t.symbol}</span>
      <span className="cc-card-price">
        {prefix}
        {fmt(t.price)}
      </span>
      <span className={`cc-card-ch ${up ? "up" : "down"}`}>
        {up ? "▲" : "▼"}
        {Math.abs(ch * 100).toFixed(2)}%
      </span>
    </div>
  );
}

export function TickerStrip({
  collapsed,
  onToggle,
  prices,
}: {
  collapsed: boolean;
  onToggle: () => void;
  prices: Record<string, PriceTick>;
}) {
  const list = Object.values(prices);

  return (
    <div className={`cc-ticker ${collapsed ? "collapsed" : ""}`}>
      <button className="cc-ticker-toggle" onClick={onToggle} title="Toggle markets">
        {collapsed ? "▸" : "▾"} Markets
      </button>
      {!collapsed && (
        <>
          {list.length === 0 ? (
            <span className="cc-ticker-empty">connecting to live prices…</span>
          ) : (
            <div className="cc-marquee">
              {/* duplicated track for a seamless continuous left-to-right scroll */}
              <div className="cc-marquee-track">
                {list.map((t) => (
                  <Ticker key={t.symbol} t={t} />
                ))}
                {list.map((t) => (
                  <Ticker key={`${t.symbol}-d`} t={t} />
                ))}
              </div>
            </div>
          )}
          <MarketSession />
        </>
      )}
    </div>
  );
}
