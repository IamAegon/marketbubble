/**
 * Reaction-analysis model — the shape of a "what made the room react" fold.
 * Produced server-side for the live stream (analyzeReactions) and client-side for
 * a recorded session replay (analyzeSession); the Reactions UI consumes one model.
 */

export interface Driver {
  label: string;
  n: number;
  /** public profile URL (chatters only) — so names link out to Twitch/Kick/X */
  href?: string;
}

/** A high-energy "moment" — a detected spike in chat reaction worth clipping. */
export interface Moment {
  startT: number;
  endT: number;
  peakT: number;
  count: number;
  peakPerMin: number;
  /** peak rate ÷ baseline rate (how many× normal) */
  lift: number;
  z: number;
  emotes: Driver[];
  cashtags: Driver[];
  keywords: Driver[];
  chatters: Driver[];
  platforms: Record<string, number>;
  /** what the host actually said in this window (from live transcription) */
  said?: string;
}

/** One time-bucket, enriched for the interactive energy chart + hover tooltip. */
export interface BinDetail {
  t: number;
  /** message count in the bucket */
  n: number;
  /** mean sentiment (-1..1) of chat in the bucket */
  net: number;
  bull: number;
  bear: number;
  /** messages per minute for this bucket */
  rate: number;
  /** rate ÷ baseline (1 = normal) */
  lift: number;
  /** what was spoken in this bucket (live STT or recorded transcript) */
  said?: string;
  emotes: Driver[];
  cashtags: Driver[];
  keywords: Driver[];
  chatters: Driver[];
}

export interface PerfAnalysis {
  from: number;
  to: number;
  binMs: number;
  total: number;
  perMin: number;
  peakPerMin: number;
  peakAt: number;
  chatters: number;
  bins: BinDetail[];
  baseline: number;
  std: number;
  moments: Moment[];
  /** fraction of the window spent in a lull (well below baseline) */
  lullPct: number;
  /** where the data came from — drivers are per-bucket for live, session-wide for recorded */
  source: "live" | "session";
  /** overall mean sentiment for the window (-1..1) */
  net: number;
  /** session-wide top drivers (recorded mode only — we lack per-bucket detail there) */
  sessionDrivers?: { emotes: Driver[]; cashtags: Driver[]; chatters: Driver[] };
}
