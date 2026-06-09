import type { NewsArticle, NewsFeed, NewsLane } from "@app/shared";
import { logger } from "../observability/logger.js";

const REFRESH_MS = 30_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "");
const decodeHtml = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

// pretty outlet names (fallback = title-cased domain) for when the row has no explicit source
const SOURCES: Record<string, string> = {
  "coindesk.com": "CoinDesk",
  "cryptoslate.com": "CryptoSlate",
  "cointelegraph.com": "Cointelegraph",
  "theblock.co": "The Block",
  "decrypt.co": "Decrypt",
  "bitcoinmagazine.com": "Bitcoin Magazine",
  "marketwatch.com": "MarketWatch",
  "reuters.com": "Reuters",
  "bloomberg.com": "Bloomberg",
  "cnbc.com": "CNBC",
  "wsj.com": "WSJ",
  "ft.com": "Financial Times",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "finance.yahoo.com": "Yahoo Finance",
  "yahoo.com": "Yahoo",
  "barrons.com": "Barron's",
  "seekingalpha.com": "Seeking Alpha",
  "benzinga.com": "Benzinga",
  "fortune.com": "Fortune",
  "businessinsider.com": "Business Insider",
  "investing.com": "Investing.com",
};
function hostSource(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (SOURCES[h]) return SOURCES[h];
    const root = h.split(".").slice(-2)[0] || h;
    return root.charAt(0).toUpperCase() + root.slice(1);
  } catch {
    return "Finviz";
  }
}

/** Parse a Finviz news view's HTML into articles. Handles both the markets view
 * (headline in `data-boxover-text`, source via the row icon/host) and the crypto
 * view `?v=5` (headline as anchor text, source in the onclick arg, ticker badges). */
function parseFinviz(html: string, lane: NewsLane, limit: number): NewsArticle[] {
  const out: NewsArticle[] = [];
  const seen = new Set<string>();
  // each row's markup begins right after the `news_table-row` class on its <tr>
  const rows = html.split("news_table-row").slice(1);
  for (const row of rows) {
    if (out.length >= limit) break;
    const a = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*nn-tab-link[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    if (!a) continue;
    const url = decodeHtml(a[1]!);
    if (seen.has(url)) continue;
    const box = /data-boxover-text="([^"]*)"/.exec(row);
    const title = decodeHtml(box ? box[1]! : stripTags(a[2]!)).trim();
    if (!title) continue;
    seen.add(url);

    // source: prefer the explicit name in trackAndOpenNews(event, 'Source', 'url'); else the host
    const srcM = /trackAndOpenNews\(\s*event\s*,\s*'([^']+)'\s*,\s*'/.exec(row);
    const source = srcM ? decodeHtml(srcM[1]!).trim() : hostSource(url);

    // time: the row's leading <td class="news_date-cell"> (a SPAN with that class holds the source — skip it)
    const timeM = /<td[^>]*\bnews_date-cell\b[^>]*>([\s\S]*?)<\/td>/.exec(row);
    const time = timeM ? stripTags(timeM[1]!).trim() : undefined;

    // ticker badges: <a class="fv-label stock-news-label ..."><span>BTC</span></a>
    const tickers: string[] = [];
    const tkRe = /class="[^"]*fv-label[^"]*stock-news-label[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/g;
    let t: RegExpExecArray | null;
    while ((t = tkRe.exec(row))) {
      const tk = decodeHtml(t[1]!).trim();
      if (tk && !tickers.includes(tk)) tickers.push(tk);
    }

    out.push({
      title: title.slice(0, 180),
      url,
      source,
      lane,
      ...(time ? { time } : {}),
      ...(tickers.length ? { tickers: tickers.slice(0, 4) } : {}),
    });
  }
  return out;
}

async function fetchView(lane: NewsLane, n: number): Promise<NewsArticle[]> {
  const res = await fetch(lane === "crypto" ? "https://finviz.com/news?v=5" : "https://finviz.com/news", {
    headers: { "user-agent": UA, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`finviz ${lane} ${res.status}`);
  return parseFinviz(await res.text(), lane, n);
}

/** Rolling store of Finviz markets + crypto headlines for the Markets → News page. */
export class FinvizNewsStore {
  private articles: NewsArticle[] = [];
  private at = 0;
  get(): NewsFeed {
    return { articles: this.articles, updatedAt: this.at };
  }
  set(articles: NewsArticle[]): void {
    this.articles = articles;
    this.at = Date.now();
  }
}

/** Poll Finviz crypto + markets news on an interval and keep the store fresh. */
export function startFinvizNews(store: FinvizNewsStore, signal: AbortSignal): void {
  const tick = async () => {
    if (signal.aborted) return;
    const results = await Promise.allSettled([fetchView("crypto", 30), fetchView("markets", 30)]);
    const out: NewsArticle[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") out.push(...r.value);
      else logger.debug({ err: String(r.reason) }, "finviz news source failed");
    }
    if (out.length) {
      store.set(out);
      logger.info({ count: out.length }, "finviz news refreshed");
    }
  };
  void tick();
  const id = setInterval(tick, REFRESH_MS);
  signal.addEventListener("abort", () => clearInterval(id));
}
