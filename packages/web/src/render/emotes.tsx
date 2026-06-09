import React from "react";
import type { Cashtag, Emote, PriceTick } from "@app/shared";

/** Render message text with inline emotes only (used where cashtags aren't needed). */
export function renderText(text: string, emotes?: Emote[]): React.ReactNode {
  return renderRich(text, { emotes });
}

interface Span {
  start: number;
  end: number;
  node: React.ReactNode;
}

const URL_RE = /https?:\/\/[^\s<]+/g;
const shortenUrl = (u: string) => {
  const bare = u.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return bare.length > 42 ? bare.slice(0, 41) + "…" : bare;
};

/** Turn bare URLs in a plain-text run into clickable links (trailing punctuation kept
 * outside the anchor), leaving the rest as text. Used for every non-emote text segment. */
function linkify(str: string, keyBase: string): React.ReactNode {
  if (!str || !str.includes("http")) return str;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(str))) {
    if (m.index > last) out.push(str.slice(last, m.index));
    let url = m[0];
    let tail = "";
    const trail = url.match(/[.,!?:;)\]}'"]+$/);
    if (trail) {
      tail = trail[0];
      url = url.slice(0, url.length - tail.length);
    }
    out.push(
      <a key={`${keyBase}-${k++}`} className="msg-link" href={url} target="_blank" rel="noopener noreferrer">
        {shortenUrl(url)}
      </a>,
    );
    if (tail) out.push(tail);
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push(str.slice(last));
  return out.length === 1 ? out[0] : out;
}

/** Render text with inline emotes + cashtag chips (code-point-aware, non-overlapping). */
export function renderRich(
  text: string,
  opts: { emotes?: Emote[]; cashtags?: Cashtag[]; prices?: Record<string, PriceTick> },
): React.ReactNode {
  const emotes = opts.emotes ?? [];
  const cashtags = opts.cashtags ?? [];
  if (emotes.length === 0 && cashtags.length === 0) return linkify(text, "u");

  const cp = Array.from(text);
  const spans: Span[] = [];
  for (const e of emotes) {
    const name = e.name ? `:${e.name}:` : "";
    spans.push({
      start: e.start,
      end: e.end,
      // Render the emote as a CSS background-image (not an <img>): a blocked or 404'd
      // emote then renders NOTHING instead of a grey "broken image" egg — even when an
      // ad-blocker drops the request without firing an error event. No URL → :name: text.
      node: e.url ? (
        <span
          className="emote"
          style={{ backgroundImage: `url("${e.url.replace(/["\\]/g, "")}")` }}
          role="img"
          aria-label={e.name ?? ""}
          title={e.name ?? ""}
        />
      ) : (
        <span className="emote-fallback-static">{name}</span>
      ),
    });
  }
  for (const c of cashtags) {
    const p = opts.prices?.[c.symbol];
    const title = p
      ? `$${c.symbol} · $${p.price} · ${((p.change24h ?? 0) * 100).toFixed(2)}% 24h`
      : `$${c.symbol}`;
    const up = (p?.change24h ?? 0) >= 0;
    spans.push({
      start: c.start,
      end: c.end,
      node: (
        <span className={`cashtag ${p ? (up ? "up" : "down") : ""}`} title={title}>
          {cp.slice(c.start, c.end + 1).join("")}
        </span>
      ),
    });
  }
  spans.sort((a, b) => a.start - b.start);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const s of spans) {
    if (s.start < cursor || s.start > cp.length) continue; // skip overlaps
    if (s.start > cursor) nodes.push(linkify(cp.slice(cursor, s.start).join(""), `t${key}`));
    nodes.push(<React.Fragment key={key++}>{s.node}</React.Fragment>);
    cursor = s.end + 1;
  }
  if (cursor < cp.length) nodes.push(linkify(cp.slice(cursor).join(""), `t${key}`));
  return nodes;
}
