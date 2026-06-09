import type { MarketOdds } from "@app/shared";
import type { SideBus } from "../bus/SideBus.js";
import { logger } from "../observability/logger.js";

function parsePrices(raw: unknown): [number, number] {
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length >= 1) {
      const yes = parseFloat(arr[0]);
      const no = arr.length >= 2 ? parseFloat(arr[1]) : 1 - yes;
      if (Number.isFinite(yes)) return [yes, Number.isFinite(no) ? no : 1 - yes];
    }
  } catch {
    /* ignore */
  }
  return [0, 0];
}

/** map Polymarket event tags → a clean top-level category (first match wins). */
const CATEGORY_RULES: { cat: string; tags: string[] }[] = [
  { cat: "Crypto", tags: ["crypto", "bitcoin", "ethereum", "solana"] },
  { cat: "Economy", tags: ["economic policy", "fed", "fed rates", "economy", "inflation", "jerome powell", "recession", "cpi", "interest rates"] },
  { cat: "Politics", tags: ["politics", "elections", "world elections", "global elections", "us politics", "trump", "us-current-affairs"] },
  { cat: "Geopolitics", tags: ["geopolitics", "middle east", "israel", "iran", "ukraine", "russia", "war", "ceasefire", "hezbollah"] },
  { cat: "Esports", tags: ["esports", "league of legends", "counter strike 2", "dota 2", "valorant", "cs2"] },
  { cat: "Sports", tags: ["sports", "nba", "nfl", "soccer", "basketball", "football", "mlb", "nhl", "tennis", "fifa world cup", "ufc", "boxing"] },
  { cat: "Tech", tags: ["tech", "ai", "openai", "elon musk", "apple", "tesla", "science"] },
  { cat: "Culture", tags: ["pop culture", "movies", "music", "awards", "entertainment", "tv"] },
];

function deriveCategory(tagLabels: string[]): string {
  const tags = tagLabels.map((t) => t.toLowerCase());
  for (const rule of CATEGORY_RULES) {
    if (rule.tags.some((t) => tags.includes(t))) return rule.cat;
  }
  return "Other";
}

/**
 * Poll Polymarket Gamma `events` for the most active markets across categories.
 * Events carry tags (→ category) + 24h volume; their embedded markets carry the
 * odds. For multi-outcome events (e.g. "World Cup Winner") we surface the
 * favorite outcome. Public, no auth.
 */
export function startPolymarket(sideBus: SideBus, signal: AbortSignal): void {
  let timer: NodeJS.Timeout | null = null;

  const poll = async () => {
    try {
      const r = await fetch(
        "https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume24hr&ascending=false&limit=120",
        { headers: { accept: "application/json" } },
      );
      if (!r.ok) return;
      const events = (await r.json()) as any[];
      const out: MarketOdds[] = [];
      for (const e of events) {
        const category = deriveCategory((e.tags ?? []).map((t: any) => String(t.label ?? "")));
        const mkts: any[] = e.markets ?? [];
        // representative outcome = the live market with the highest "yes" (the favorite)
        let best: { m: any; yes: number; no: number } | null = null;
        for (const m of mkts) {
          if (m.closed || m.active === false) continue;
          const [yes, no] = parsePrices(m.outcomePrices);
          if (yes > 0 && (!best || yes > best.yes)) best = { m, yes, no };
        }
        if (!best) continue;
        const multi = mkts.length > 1;
        const question = multi
          ? `${(e.title ?? "").trim()}: ${best.m.groupItemTitle ?? "—"}`
          : best.m.question ?? e.title ?? "—";
        out.push({
          id: String(e.id ?? e.slug ?? question),
          question,
          slug: e.slug,
          yes: best.yes,
          no: best.no,
          url: e.slug ? `https://polymarket.com/event/${e.slug}` : "https://polymarket.com",
          volume: Number(e.volume24hr ?? e.volume ?? 0),
          endDate: e.endDate,
          category,
        });
      }
      const markets = out
        .filter((m) => m.yes >= 0.02 && m.yes <= 0.98 && (m.volume ?? 0) > 0)
        .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
        .slice(0, 60);
      if (markets.length) sideBus.publish({ type: "markets", markets });
    } catch (e) {
      logger.warn({ err: String(e) }, "polymarket poll failed");
    }
  };

  poll();
  timer = setInterval(poll, 20_000);
  timer.unref?.();
  signal.addEventListener("abort", () => timer && clearInterval(timer), { once: true });
}
