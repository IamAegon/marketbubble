import type { BinDetail, ChatMessage, Driver, Moment, PerfAnalysis, Platform } from "@app/shared";
import { profileUrl } from "@app/shared";

/**
 * Server-side reaction fold — moved off the browser's main thread. Given a window
 * of recent messages (chat + captions, from the hot ring), bins chat by time,
 * enriches each bin with sentiment + the spoken transcript + its driving
 * emotes/cashtags/keywords/chatters, and flags spike bins into "moments".
 * Produces the SAME PerfAnalysis shape the UI renders for a recorded session, so
 * the client just fetches + draws — no heavy compute client-side.
 */

const STOP = new Set(
  "the a an and or but is are was were be been being to of in on at for with from this that these those it its as so just like really very much more most some any all you your we our they them he she his her i me my mine yours not no yes now then than too also into out up down over under about what when where why how who which lol lmao omg yeah yep nah haha hahaha gonna wanna gotta dont cant wont here there get got let go going".split(
    " ",
  ),
);

const topN = (m: Map<string, number>, n: number): Driver[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, n]) => ({ label, n }));

function bump(m: Map<string, number>, k: string, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

/** Fold a window of messages into the things that drove the reaction. */
function drivers(msgs: ChatMessage[]) {
  const emotes = new Map<string, number>();
  const cashtags = new Map<string, number>();
  const keywords = new Map<string, number>();
  const chatters = new Map<string, { n: number; platform: Platform; username: string; name: string }>();
  const platforms: Record<string, number> = {};
  for (const m of msgs) {
    platforms[m.platform] = (platforms[m.platform] ?? 0) + 1;
    const ck = `${m.platform}:${m.author.username.toLowerCase()}`;
    const ce = chatters.get(ck);
    if (ce) ce.n++;
    else chatters.set(ck, { n: 1, platform: m.platform, username: m.author.username, name: m.author.displayName || m.author.username });
    for (const e of m.emotes ?? []) if (e.name) bump(emotes, e.name);
    for (const c of m.cashtags ?? []) bump(cashtags, c.symbol.toUpperCase());
    for (const raw of (m.text || "").toLowerCase().split(/[^a-z0-9$']+/)) {
      const w = raw.replace(/^['$]+|['$]+$/g, "");
      if (w.length >= 4 && !STOP.has(w) && !w.startsWith("http")) bump(keywords, w);
    }
  }
  const topChatters: Driver[] = [...chatters.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((c) => ({ label: c.name, n: c.n, href: profileUrl(c.platform, c.username) ?? undefined }));
  return {
    emotes: topN(emotes, 4),
    cashtags: topN(cashtags, 4),
    keywords: topN(keywords, 5),
    chatters: topChatters,
    platforms,
  };
}

/** Detect spike runs in a per-bucket count array (z-score outliers, merged across a
 * 1-bin gap into runs), returning each run's bin span + peak bin. */
function detectMomentSpans(counts: number[], mean: number, std: number, Z: number): { i: number; j: number; peak: number }[] {
  const nBins = counts.length;
  const flagged = counts.map((c) => (c - mean) / std >= Z && c >= Math.max(4, mean * 1.5));
  const spans: { i: number; j: number; peak: number }[] = [];
  let i = 0;
  while (i < nBins) {
    if (!flagged[i]) {
      i++;
      continue;
    }
    let j = i;
    let gap = 0;
    while (j + 1 < nBins && (flagged[j + 1] || gap < 1)) {
      if (flagged[j + 1]) gap = 0;
      else gap++;
      j++;
    }
    while (j > i && !flagged[j]) j--;
    let pk = i;
    for (let k = i; k <= j; k++) if (counts[k]! > counts[pk]!) pk = k;
    spans.push({ i, j, peak: pk });
    i = j + 1;
  }
  return spans;
}

export function analyzeReactions(
  messages: ChatMessage[],
  opts: { binMs: number; sinceMs?: number; channel?: string; z?: number; now: number },
): PerfAnalysis {
  const { binMs, sinceMs, channel, now } = opts;
  const Z = opts.z ?? 2;
  const from = sinceMs ? now - sinceMs : 0;
  const inScope = (m: ChatMessage) => m.timestamp >= from && (!channel || channel === "all" || m.channel === channel);
  // reactions = stream chat only (captions/news are not reactions, but captions feed
  // attribution; internal MB rooms are team/creator chats, not stream reactions)
  const msgs = messages.filter((m) => m.kind !== "post" && m.kind !== "caption" && m.platform !== "mb" && inScope(m));
  const captions = messages.filter((m) => m.kind === "caption" && inScope(m)).sort((a, b) => a.timestamp - b.timestamp);
  const empty: PerfAnalysis = {
    from: from || now,
    to: now,
    binMs,
    total: 0,
    perMin: 0,
    peakPerMin: 0,
    peakAt: now,
    chatters: 0,
    bins: [],
    baseline: 0,
    std: 0,
    moments: [],
    lullPct: 0,
    source: "live",
    net: 0,
  };
  if (msgs.length === 0) return empty;

  const start = sinceMs ? from : msgs[0]!.timestamp;
  const nBins = Math.max(1, Math.ceil((now - start) / binMs));
  const counts = new Array(nBins).fill(0);
  const binMsgs: ChatMessage[][] = Array.from({ length: nBins }, () => []);
  const binCaps: ChatMessage[][] = Array.from({ length: nBins }, () => []);
  const idxOf = (t: number) => Math.min(nBins - 1, Math.max(0, Math.floor((t - start) / binMs)));
  const seen = new Set<string>();
  let netSum = 0;
  for (const m of msgs) {
    const k = idxOf(m.timestamp);
    counts[k]++;
    binMsgs[k]!.push(m);
    seen.add(`${m.platform}:${m.author.username}`);
    netSum += m.sentiment ?? 0;
  }
  for (const c of captions) binCaps[idxOf(c.timestamp)]!.push(c);

  const perMinF = 60000 / binMs;
  const mean = counts.reduce((a: number, b: number) => a + b, 0) / nBins;
  const variance = counts.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / nBins;
  const std = Math.sqrt(variance) || 1;

  let peakIdx = 0;
  counts.forEach((c: number, i: number) => {
    if (c > counts[peakIdx]) peakIdx = i;
  });

  const bins: BinDetail[] = counts.map((nCount: number, k: number) => {
    const ms = binMsgs[k]!;
    let sNet = 0;
    let bull = 0;
    let bear = 0;
    for (const m of ms) {
      const s = m.sentiment ?? 0;
      sNet += s;
      if (s > 0) bull++;
      else if (s < 0) bear++;
    }
    const said = binCaps[k]!.map((c) => c.text).join(" ").slice(0, 240).trim();
    const { emotes, cashtags, keywords, chatters } = drivers(ms);
    return {
      t: start + k * binMs,
      n: nCount,
      net: ms.length ? +(sNet / ms.length).toFixed(2) : 0,
      bull,
      bear,
      rate: Math.round(nCount * perMinF),
      lift: mean > 0 ? +(nCount / mean).toFixed(1) : nCount,
      ...(said ? { said } : {}),
      emotes,
      cashtags,
      keywords,
      chatters,
    };
  });

  const moments: Moment[] = detectMomentSpans(counts, mean, std, Z).map((sp) => {
    const startT = start + sp.i * binMs;
    const endT = start + (sp.j + 1) * binMs;
    const wmsgs = msgs.filter((m) => m.timestamp >= startT && m.timestamp < endT);
    // widen ±1 bin for the spoken line — the host may speak just before the reaction,
    // and HLS-pulled captions lag chat by the audio buffer.
    const said = captions
      .filter((m) => m.timestamp >= startT - binMs && m.timestamp < endT + binMs)
      .map((m) => m.text)
      .join(" ")
      .slice(0, 320)
      .trim();
    return {
      startT,
      endT,
      peakT: start + sp.peak * binMs,
      count: wmsgs.length,
      peakPerMin: Math.round(counts[sp.peak] * perMinF),
      lift: mean > 0 ? +(counts[sp.peak] / mean).toFixed(1) : counts[sp.peak],
      z: +((counts[sp.peak] - mean) / std).toFixed(1),
      ...drivers(wmsgs),
      ...(said ? { said } : {}),
    };
  });
  moments.sort((a, b) => b.lift - a.lift);

  const lullBins = counts.filter((c: number) => c < mean * 0.4).length;
  return {
    from: start,
    to: now,
    binMs,
    total: msgs.length,
    perMin: +(msgs.length / Math.max(1, (now - start) / 60000)).toFixed(1),
    peakPerMin: Math.round(counts[peakIdx] * perMinF),
    peakAt: start + peakIdx * binMs,
    chatters: seen.size,
    bins,
    baseline: +(mean * perMinF).toFixed(1),
    std,
    moments,
    lullPct: Math.round((lullBins / nBins) * 100),
    source: "live",
    net: msgs.length ? +(netSum / msgs.length).toFixed(2) : 0,
  };
}
