import { ulid } from "ulid";
import type { ChatMessage } from "@app/shared";
import type { Pipeline } from "../pipeline/ingest.js";
import type { RoomRegistry } from "./rooms.js";

const TEAM = [
  { username: "admin1", displayName: "Admin", color: "#e8ff9c" },
  { username: "nova", displayName: "Nova", color: "#7dd3fc" },
  { username: "jules", displayName: "Jules", color: "#f0abfc" },
  { username: "kparam", displayName: "Kparam", color: "#fcd34d" },
  { username: "modski", displayName: "Modski", color: "#86efac" },
];

const CONTENT: Record<string, string[]> = {
  "mb:shared": [
    "morning team — big stream today, Ansem's on at 2pm ET",
    "ticker overlay looks clean now 🔥",
    "can someone double-check the Polymarket feed? showing ~60 markets",
    "HYPE is pumping, chat's gonna go wild",
    "reminder: clip anything spicy for the recap",
    "analytics page is live — sentiment tracking per stream now",
    "who's modding the Faze stream tonight?",
    "i'll take Faze, you cover Ansem",
    "the market brief PDF is 🤌 for the pre-show",
    "let's gooo 🚀",
  ],
  "mb:mod": [
    "heads up — seeing spam links in Ansem chat",
    "added 'free vbucks' to the mute list",
    "timed out 3 raiders, watch for ban evasion",
    "slow mode during the big announcement?",
    "yeah, 3s slow mode while he talks targets",
    "someone's posting a fake giveaway — banning now",
    "keep an eye on the cashtag pumpers",
    "good work tonight team 💪",
    "logging the highlights for the report",
    "wrapping up — chat was clean",
  ],
  "mb:ansem": [
    "Ansem going live in 10",
    "topic today: the SOL season thesis",
    "he's bullish HYPE, chat is split",
    "someone asked about his entry on $BTC",
    "big reaction to the 2x call",
    "chat spamming 🚀🚀🚀",
    "he's reading the Polymarket odds live",
    "great segment on memecoins",
    "clip that — 'this is the cycle'",
    "stream peaked around 12k concurrent",
  ],
  "mb:faze": [
    "Faze stream starting soon",
    "CS2 ranked grind tonight",
    "chat hyped for the new roster",
    "lol someone donated 100 bits",
    "he's cracked on this map",
    "clip the ace!",
    "chat going crazy after that clutch",
    "Q&A segment starting now",
    "talking about the org's plans for next season",
    "gg — great stream everyone",
  ],
};

/** Seed each native room with a short demo discussion so the rooms aren't empty.
 * Stable platformMsgIds → de-duped by the store across restarts; spread over the
 * last ~20 minutes so they land before live chat in the backfill. */
export function seedRooms(pipeline: Pipeline, rooms: RoomRegistry): void {
  const now = Date.now();
  let seeded = 0;
  for (const room of rooms.list()) {
    const lines = CONTENT[room.id];
    if (!lines) continue;
    lines.forEach((text, i) => {
      const author = TEAM[i % TEAM.length]!;
      const ts = now - (lines.length - i) * 120_000; // 2 min apart, oldest first
      const m: ChatMessage = {
        id: ulid(),
        platform: "mb",
        platformMsgId: `seed-${room.id}-${i}`,
        channel: room.id,
        channelLabel: room.label,
        author: { username: author.username, displayName: author.displayName, color: author.color },
        text,
        timestamp: ts,
        receivedAt: ts,
        kind: "chat",
      };
      pipeline.ingest(room.id, m);
      seeded++;
    });
  }
  return void seeded;
}
