/**
 * Show planning — past episodes (with guests/topics) and a forward schedule.
 * Guests carry an optional X handle so the team can pull recent-post intel and
 * an AI pre-show brief.
 */

export type EpisodeStatus = "planned" | "live" | "done";

export interface ShowGuest {
  name: string;
  /** X handle without the @ (used for intel + brief) */
  handle?: string;
  note?: string;
}

export interface Episode {
  id: string;
  title: string;
  /** scheduled date/time (ms epoch) */
  scheduledAt: number;
  status: EpisodeStatus;
  guests: ShowGuest[];
  /** planned segments / talking points */
  topics: string[];
  notes?: string;
  createdBy: string;
  createdAt: number;
}

export interface EpisodeDraft {
  title?: string;
  scheduledAt?: number;
  status?: EpisodeStatus;
  guests?: ShowGuest[];
  topics?: string[];
  notes?: string;
}

/** A recent post pulled for guest intel. */
export interface GuestPost {
  text: string;
  link: string;
  at: number;
  author: string;
}
