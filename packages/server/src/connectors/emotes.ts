import type { Emote } from "@app/shared";
import type { EmoteIndex } from "./emoteSets.js";

const twitchCdn = (id: string) =>
  `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;

/** Twitch emote offsets are code-point ranges over the message text. */
export function twitchEmotes(text: string, offsets: Map<string, string[]>): Emote[] {
  const cp = Array.from(text);
  const out: Emote[] = [];
  for (const [id, ranges] of offsets) {
    for (const r of ranges) {
      const [s, e] = r.split("-").map(Number);
      if (Number.isFinite(s) && Number.isFinite(e)) {
        out.push({ id, start: s, end: e, url: twitchCdn(id), name: cp.slice(s, e + 1).join("") });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Match third-party emote NAMES (7TV/BTTV/FFZ) as whole whitespace-delimited
 * tokens in the message text and return Emote spans with code-point offsets.
 * Skips tokens that overlap already-resolved native emotes.
 */
export function thirdPartyEmotes(text: string, idx: EmoteIndex | null, existing: Emote[]): Emote[] {
  if (!idx || idx.size === 0 || !text) return [];
  const cp = Array.from(text);
  const taken = existing.map((e) => [e.start, e.end] as const);
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => !(e < a || s > b));
  const out: Emote[] = [];
  let start = -1;
  let token = "";
  const flush = (endExclusive: number) => {
    if (token) {
      const hit = idx.get(token);
      if (hit && !overlaps(start, endExclusive - 1)) {
        out.push({ id: hit.id, start, end: endExclusive - 1, url: hit.url, name: token, provider: hit.provider, zeroWidth: hit.zeroWidth });
      }
    }
    token = "";
    start = -1;
  };
  for (let k = 0; k < cp.length; k++) {
    const c = cp[k]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      flush(k);
    } else {
      if (start === -1) start = k;
      token += c;
    }
  }
  flush(cp.length);
  return out;
}

const KICK_EMOTE_RE = /\[emote:(\d+):([^\]]+)\]/g;

/** Kick chat text embeds emotes inline as `[emote:<id>:<name>]`. */
export function kickEmotes(text: string): Emote[] {
  const out: Emote[] = [];
  let m: RegExpExecArray | null;
  KICK_EMOTE_RE.lastIndex = 0;
  while ((m = KICK_EMOTE_RE.exec(text)) !== null) {
    const startCp = Array.from(text.slice(0, m.index)).length;
    const endCp = startCp + Array.from(m[0]).length - 1;
    out.push({
      id: m[1]!,
      start: startCp,
      end: endCp,
      url: `https://files.kick.com/emotes/${m[1]}/fullsize`,
      name: m[2]!,
    });
  }
  return out;
}
