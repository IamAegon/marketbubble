import type { BinDetail, Driver, Moment, PerfAnalysis, SentimentPoint, SessionSummary } from "@app/shared";
import { profileUrl } from "./profile";

// The reaction-analysis model + the live fold now live in @app/shared / the server
// (analyzeReactions). The client only folds RECORDED sessions (analyzeSession), which
// is cheap aggregate data. Re-export the types so existing imports keep working.
export type { BinDetail, Driver, Moment, PerfAnalysis } from "@app/shared";

/** Detect spike runs in a per-bucket count array: flag strong positive outliers
 * (z-score over the window), merge adjacent spikes (allowing a 1-bin gap) into
 * runs, and return each run's bin span + peak bin. Shared by live + session. */
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

/**
 * Build the SAME PerfAnalysis shape from a recorded session + its transcript, so
 * the Reactions page can replay a past show. Recorded data is per-minute aggregates
 * (activity + sentiment) plus a caption transcript — there are no raw chat messages,
 * so per-bucket drivers aren't available; we surface session-wide top drivers instead.
 */
export function analyzeSession(s: SessionSummary, captions: { t: number; text: string }[]): PerfAnalysis {
  const activity = s.activity ?? [];
  const bucketMs = activity.length >= 2 ? activity[1]!.t - activity[0]!.t || 60_000 : 60_000;
  const sentByT = new Map<number, SentimentPoint>();
  for (const p of s.sentiment ?? []) sentByT.set(p.t, p);
  const capByBin = new Map<number, string[]>();
  for (const c of captions) {
    const k = Math.floor(c.t / bucketMs) * bucketMs;
    let arr = capByBin.get(k);
    if (!arr) {
      arr = [];
      capByBin.set(k, arr);
    }
    arr.push(c.text);
  }

  const counts = activity.map((b) => b.total);
  const mean = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  const variance = counts.length ? counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length : 0;
  const std = Math.sqrt(variance) || 1;
  const perMinF = 60000 / bucketMs;

  const bins: BinDetail[] = activity.map((b) => {
    const sp = sentByT.get(b.t);
    const said = (capByBin.get(b.t) ?? []).join(" ").slice(0, 240).trim();
    return {
      t: b.t,
      n: b.total,
      net: sp?.net ?? 0,
      bull: sp?.bullish ?? 0,
      bear: sp?.bearish ?? 0,
      rate: Math.round(b.total * perMinF),
      lift: mean > 0 ? +(b.total / mean).toFixed(1) : b.total,
      ...(said ? { said } : {}),
      emotes: [],
      cashtags: [],
      keywords: [],
      chatters: [],
    };
  });

  const sessionDrivers = {
    emotes: (s.topEmotes ?? []).slice(0, 5).map((e) => ({ label: e.name, n: e.count })),
    cashtags: (s.topCashtags ?? []).slice(0, 5).map((c) => ({ label: c.symbol.toUpperCase(), n: c.count })),
    chatters: (s.topChatters ?? []).slice(0, 5).map((c) => ({ label: c.name, n: c.count, href: profileUrl(c.platform, c.username) ?? undefined })),
  };

  const capText = (a: number, b: number) =>
    captions
      .filter((c) => c.t >= a && c.t < b)
      .map((c) => c.text)
      .join(" ")
      .slice(0, 320)
      .trim();

  const moments: Moment[] = detectMomentSpans(counts, mean, std, 2)
    .map((sp) => {
      const startT = activity[sp.i]!.t;
      const endT = (activity[sp.j]?.t ?? startT) + bucketMs;
      const said = capText(startT, endT);
      return {
        startT,
        endT,
        peakT: activity[sp.peak]!.t,
        count: counts.slice(sp.i, sp.j + 1).reduce((a, b) => a + b, 0),
        peakPerMin: Math.round(counts[sp.peak]! * perMinF),
        lift: mean > 0 ? +(counts[sp.peak]! / mean).toFixed(1) : counts[sp.peak]!,
        z: +((counts[sp.peak]! - mean) / std).toFixed(1),
        emotes: sessionDrivers.emotes,
        cashtags: sessionDrivers.cashtags,
        keywords: [],
        chatters: sessionDrivers.chatters,
        platforms: s.byPlatform ?? {},
        ...(said ? { said } : {}),
      };
    })
    .sort((a, b) => b.lift - a.lift);

  const from = activity[0]?.t ?? s.startedAt;
  const to = (activity[activity.length - 1]?.t ?? s.endedAt ?? s.startedAt) + bucketMs;
  const lullBins = counts.filter((c) => c < mean * 0.4).length;
  return {
    from,
    to,
    binMs: bucketMs,
    total: s.messages,
    perMin: s.avgPerMin,
    peakPerMin: s.peakPerMin,
    peakAt: s.peakAt,
    chatters: s.chatters,
    bins,
    baseline: +(mean * perMinF).toFixed(1),
    std,
    moments,
    lullPct: counts.length ? Math.round((lullBins / counts.length) * 100) : 0,
    source: "session",
    net: s.net,
    sessionDrivers,
  };
}

/** Build a grounding prompt for the AI coach report from an analysis. */
export function coachPrompt(a: PerfAnalysis, scopeLabel: string): string {
  const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const mom = a.moments
    .slice(0, 6)
    .map(
      (m, i) =>
        `${i + 1}. ${clock(m.startT)}–${clock(m.endT)} · ×${m.lift} normal · peak ${m.peakPerMin}/min · drivers: ${[
          ...m.emotes.map((e) => e.label),
          ...m.cashtags.map((c) => "$" + c.label),
          ...m.keywords.map((k) => k.label),
        ]
          .slice(0, 6)
          .join(", ") || "—"}${m.said ? `\n   said: "${m.said}"` : ""}`,
    )
    .join("\n");
  const sentWord = a.net > 0.15 ? "bullish" : a.net < -0.15 ? "bearish" : "flat";
  return [
    `You are an elite livestream performance coach for a crypto/markets show. Analyze this ${
      a.source === "session" ? "recorded session" : "session"
    } for ${scopeLabel} and give the host sharp, specific, improvement-oriented feedback. Be concrete; no fluff.`,
    "",
    `SESSION METRICS:`,
    `- Total chat messages: ${a.total}`,
    `- Average rate: ${a.perMin}/min · peak ${a.peakPerMin}/min at ${clock(a.peakAt)}`,
    `- Unique chatters: ${a.chatters}`,
    `- Baseline rate: ${a.baseline}/min · time spent in a lull: ${a.lullPct}%`,
    `- Net sentiment: ${a.net >= 0 ? "+" : ""}${Math.round(a.net * 100)} (${sentWord})`,
    `- Reaction moments detected: ${a.moments.length}`,
    "",
    `TOP MOMENTS (what made the audience react):`,
    mom || "(none detected — the room was flat)",
    "",
    `Write a coach report with these sections (markdown, use ## headers):`,
    `## What worked — the moments that landed and why (reference the drivers).`,
    `## Where you lost them — lulls / sentiment dips, and what likely caused them.`,
    `## Pacing — read the energy curve (peak vs lull %), is it front/back-loaded?`,
    `## Next show — 3 concrete, specific things to do differently.`,
  ].join("\n");
}
