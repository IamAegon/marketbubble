import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SessionSummary } from "@app/shared";
import { useDashboard } from "../state/DashboardProvider";
import { useAuth } from "../state/useAuth";
import { useMarketHistory } from "../lib/marketHistory";
import { useTrends } from "../lib/useTrends";
import { getToken } from "../lib/auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;
const pct = (open?: number, price?: number) => (open && price ? ((price - open) / open) * 100 : null);
const fmtPct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

const TZ = "America/Los_Angeles";
const SHOW_HOUR = 16; // 4 PM PT, Thursdays
const SHOW_LEN_H = 3; // treat the next 3h as "on air"

/** The LA UTC offset (minutes) at time `t`, e.g. PDT = -420. */
function laOffsetMin(t: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(t)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return -480;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Next Thursday 4 PM PT as an epoch (and whether a show is on air right now). */
function nextShow(now: number): { at: number; live: boolean } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!);
  const hh = Number(p.hour) % 24;
  const live = wd === 4 && hh >= SHOW_HOUR && hh < SHOW_HOUR + SHOW_LEN_H;
  let add = (4 - wd + 7) % 7;
  if (add === 0 && hh >= SHOW_HOUR) add = 7; // past today's show → next Thursday
  const off = laOffsetMin(now);
  const at = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + add, SHOW_HOUR, 0, 0) - off * 60_000;
  return { at, live };
}

/** Elite countdown to the next Market Bubble stream (Thursdays · 4 PM PT). */
function StreamCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const { at, live } = nextShow(now);
  if (live) {
    return (
      <div className="brief-countdown live">
        <div className="bc-kicker">Market Bubble</div>
        <div className="bc-live">
          <span className="bc-live-dot" /> ON AIR NOW
        </div>
        <div className="bc-foot">Thursdays · 4PM PST</div>
      </div>
    );
  }
  const ms = Math.max(0, at - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const units = [
    { v: d, l: "days" },
    { v: h, l: "hrs" },
    { v: m, l: "min" },
    { v: s, l: "sec" },
  ];
  return (
    <div className="brief-countdown">
      <div className="bc-kicker">The next Market Bubble stream drops in</div>
      <div className="bc-clock">
        {units.map((u) => (
          <div className="bc-unit" key={u.l}>
            <span className="bc-num">{String(u.v).padStart(2, "0")}</span>
            <span className="bc-lbl">{u.l}</span>
          </div>
        ))}
      </div>
      <div className="bc-foot">Thursdays · 4PM PST</div>
    </div>
  );
}

/** A login "command-deck" brief: a Jarvis-style market read + streamer pulse. Shows
 * once per session when enabled (Settings → Appearance). */
export function BriefModal() {
  const d = useDashboard();
  const { user } = useAuth();
  const hist = useMarketHistory();
  const trends = useTrends();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const shown = useRef(false);

  useEffect(() => {
    if (!user || shown.current || !d.layout.loginBrief) return;
    shown.current = true;
    setOpen(true);
    const t = getToken();
    fetch(`${API}/api/sessions`, { headers: t ? { authorization: `Bearer ${t}` } : {} })
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((j) => setSessions(j.sessions || []))
      .catch(() => {});
  }, [user?.id, d.layout.loginBrief]);

  const market = useMemo(() => {
    const read = (sym: string) => pct(hist[sym]?.dailyOpen, d.prices[sym]?.price);
    const movers = Object.keys(d.prices)
      .map((s) => ({ s, name: d.prices[s]?.name ?? s, p: read(s) }))
      .filter((x): x is { s: string; name: string; p: number } => x.p != null)
      .sort((a, b) => Math.abs(b.p) - Math.abs(a.p))
      .slice(0, 4);
    const btc = read("BTC");
    const spx = read("SPX");
    const vix = read("VIX");
    let tone = "mixed";
    let line = "No conviction yet. The tape is coiled, waiting on its catalyst.";
    if ((vix != null && vix > 4) || (btc != null && btc < -2.5)) {
      tone = "risk-off";
      line = "Risk off. The bid is gone and every rally gets sold into.";
    } else if ((btc != null && btc > 2.5 && (spx == null || spx > -0.3)) || (vix != null && vix < -6)) {
      tone = "risk-on";
      line = "Risk on. Money is hunting and every dip gets bought.";
    }
    return { movers, btc, spx, vix, tone, line, ready: movers.length > 0 };
  }, [d.prices, hist]);

  const pulses = useMemo(() => {
    const by = new Map<string, SessionSummary[]>();
    for (const s of sessions.filter((x) => x.status === "ended")) {
      const a = by.get(s.streamerId) ?? [];
      a.push(s);
      by.set(s.streamerId, a);
    }
    return [...by.values()]
      .map((list) => {
        list.sort((a, b) => a.startedAt - b.startedAt);
        const latest = list[list.length - 1]!;
        const prior = list.slice(0, -1);
        const avg = prior.length ? prior.reduce((x, s) => x + s.avgPerMin, 0) / prior.length : null;
        return {
          id: latest.streamerId,
          name: latest.streamerName,
          perMin: Math.round(latest.avgPerMin),
          avg: avg != null ? Math.round(avg) : null,
          hot: avg != null && latest.avgPerMin > avg * 1.15,
          cold: avg != null && latest.avgPerMin < avg * 0.85,
          msgs: latest.messages,
        };
      })
      .sort((a, b) => b.perMin - a.perMin)
      .slice(0, 5);
  }, [sessions]);

  if (!open) return null;
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const title = user?.welcomeTitle?.trim();
  const greetLine = title ? `Welcome ${title}` : `Good ${partOfDay}, ${user?.displayName ?? ""}`;
  const go = (path: string) => {
    setOpen(false);
    nav(path);
  };

  return (
    <div className="brief-overlay" onClick={() => setOpen(false)}>
      <div className="brief-modal" onClick={(e) => e.stopPropagation()}>
        <div className="brief-head">
          <div>
            <div className="brief-kicker">🛰 Market Bubble · daily brief</div>
            <div className="brief-greet">{greetLine}</div>
          </div>
          <button className="brief-x" onClick={() => setOpen(false)} title="Close">
            ✕
          </button>
        </div>

        <StreamCountdown />

        <div className="brief-section">
          <div className="brief-sec-head">
            <span>Markets</span>
            <span className={`brief-tone tone-${market.tone}`}>{market.tone.replace("-", " ")}</span>
          </div>
          <p className="brief-read">{market.line}</p>
          <div className="brief-stats">
            <div className="brief-stat">
              <span>BTC</span>
              <b className={(market.btc ?? 0) >= 0 ? "up" : "down"}>{fmtPct(market.btc)}</b>
            </div>
            <div className="brief-stat">
              <span>S&amp;P</span>
              <b className={(market.spx ?? 0) >= 0 ? "up" : "down"}>{fmtPct(market.spx)}</b>
            </div>
            <div className="brief-stat">
              <span>VIX</span>
              <b className={(market.vix ?? 0) >= 0 ? "down" : "up"}>{fmtPct(market.vix)}</b>
            </div>
          </div>
          {market.movers.length > 0 && (
            <div className="brief-movers">
              Biggest movers today:{" "}
              {market.movers.map((m) => (
                <span key={m.s} className={`brief-mover ${m.p >= 0 ? "up" : "down"}`}>
                  {m.s} {fmtPct(m.p)}
                </span>
              ))}
            </div>
          )}
        </div>

        {trends.length > 0 && (
          <div className="brief-section">
            <div className="brief-sec-head">
              <span>Trending now</span>
            </div>
            <div className="brief-movers">
              {trends.slice(0, 6).map((t, i) => (
                <span key={i} className="brief-mover">
                  {t.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {pulses.length > 0 && (
          <div className="brief-section">
            <div className="brief-sec-head">
              <span>Streamer pulse</span>
            </div>
            <div className="brief-pulses">
              {pulses.map((p) => (
                <div className="brief-pulse" key={p.id}>
                  <span className="brief-pulse-name">{p.name}</span>
                  <span className="brief-pulse-rate">{p.perMin} msg/min</span>
                  {p.hot ? (
                    <span className="brief-tag hot">🔥 hot{p.avg ? ` vs ~${p.avg}` : ""}</span>
                  ) : p.cold ? (
                    <span className="brief-tag cold">cooler{p.avg ? ` vs ~${p.avg}` : ""}</span>
                  ) : (
                    <span className="brief-tag">steady</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="brief-actions">
          <button className="cc-chip active" onClick={() => go("/app/markets")}>
            Open Markets →
          </button>
          <button className="cc-chip" onClick={() => go("/app/analytics")}>
            Streamer brief →
          </button>
          <button className="cc-chip" onClick={() => setOpen(false)}>
            Got it
          </button>
          <button
            className="brief-mute"
            onClick={() => {
              d.layout.setLoginBrief(false);
              setOpen(false);
            }}
          >
            Don’t show on login
          </button>
        </div>
      </div>
    </div>
  );
}
