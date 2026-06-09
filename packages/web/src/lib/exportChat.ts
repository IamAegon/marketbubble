import type { ChatMessage, Platform } from "@app/shared";

/** selectable AI-analysis prompt templates prepended to the transcript */
export const PROMPT_TEMPLATES: { id: string; label: string; prompt: string }[] = [
  { id: "none", label: "None", prompt: "" },
  {
    id: "overview",
    label: "Sentiment & topics",
    prompt:
      "You are analyzing a live-stream chat transcript. Identify: the main topics, overall sentiment and how it shifted over time, peak/notable moments and what triggered them, and any standout reactions. Finish with 5 concise bullet takeaways.",
  },
  {
    id: "trading",
    label: "Trading signals",
    prompt:
      "Analyze this live-stream chat from a trading lens. List every asset/$ticker mentioned with the chat's lean (bullish/bearish/mixed) and rough conviction, surface any rumored catalysts or price targets, and flag moments of capitulation or euphoria. End with a short 'what chat is positioning for' summary.",
  },
  {
    id: "moderation",
    label: "Moderation review",
    prompt:
      "Review this live-stream chat as a moderator. Flag spam, scams/links, harassment or hate, ban-evasion patterns, and raid/brigade behavior with example lines and timestamps. Suggest words to add to a mute list and rank the most disruptive chatters.",
  },
  {
    id: "clips",
    label: "Highlights & clips",
    prompt:
      "Find the most clippable moments in this live-stream chat — spikes of hype, big reactions, funny exchanges, and notable callouts. For each, give the timestamp, what happened, and a one-line caption suitable for a social clip.",
  },
  {
    id: "summary",
    label: "TL;DR recap",
    prompt:
      "Write a tight recap of this live-stream chat for someone who missed it: 1 paragraph of what happened, then bullets for key topics, mood, and standout moments. Keep it under 200 words.",
  },
];

export interface ExportOpts {
  layout: "unified" | "by-channel";
  platforms: Platform[];
  format: "text" | "markdown" | "json";
  timestamps: boolean;
  anonymize: boolean;
  /** id of a PROMPT_TEMPLATES entry to prepend ("none" = no prompt) */
  promptId: string;
  /** 0 = everything in the buffer, else only messages newer than now-sinceMs */
  sinceMs: number;
}

/** Kick embeds emotes as [emote:id:name]; normalize to :name: for clean text. */
const clean = (text: string) => text.replace(/\[emote:\d+:([^\]]+)\]/g, ":$1:").trim();

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Build an AI-analysis-ready transcript from the live message buffer. */
export function buildExport(messages: ChatMessage[], opts: ExportOpts): string {
  const now = Date.now();
  const plats = new Set(opts.platforms);
  const msgs = messages.filter(
    (m) => m.kind !== "post" && plats.has(m.platform) && (opts.sinceMs === 0 || now - m.receivedAt <= opts.sinceMs),
  );

  // stable anonymized author labels
  const alias = new Map<string, string>();
  const name = (m: ChatMessage): string => {
    if (!opts.anonymize) return m.author.displayName;
    const key = `${m.platform}:${m.author.username.toLowerCase()}`;
    if (!alias.has(key)) alias.set(key, `User${alias.size + 1}`);
    return alias.get(key)!;
  };

  if (opts.format === "json") {
    return JSON.stringify(
      msgs.map((m) => ({
        t: new Date(m.timestamp || m.receivedAt).toISOString(),
        platform: m.platform,
        channel: m.channelLabel,
        author: name(m),
        text: clean(m.text),
      })),
      null,
      2,
    );
  }

  const md = opts.format === "markdown";
  const tsPart = (m: ChatMessage) => (opts.timestamps ? `[${clock(m.receivedAt)}] ` : "");
  const line = (m: ChatMessage, withChannel: boolean) =>
    `${tsPart(m)}${withChannel ? `[${m.channelLabel}] ` : ""}${name(m)}: ${clean(m.text)}`;

  let out = "";
  const tmpl = PROMPT_TEMPLATES.find((t) => t.id === opts.promptId);
  if (tmpl && tmpl.prompt) out += `${tmpl.prompt}\n\n--- TRANSCRIPT ---\n`;

  if (opts.layout === "by-channel") {
    const byCh = new Map<string, ChatMessage[]>();
    for (const m of msgs) {
      const arr = byCh.get(m.channelLabel) ?? [];
      arr.push(m);
      byCh.set(m.channelLabel, arr);
    }
    for (const [ch, list] of byCh) {
      out += md ? `\n## ${ch} (${list.length})\n\n` : `\n=== ${ch} (${list.length}) ===\n`;
      out += list.map((m) => line(m, false)).join("\n") + "\n";
    }
  } else {
    if (md) out += `# Market Bubble chat — ${msgs.length} messages\n\n`;
    out += msgs.map((m) => line(m, true)).join("\n");
  }
  return out.trim();
}
