import type { ChatMessage, SentimentGauge } from "@app/shared";
import type { SideBus } from "../bus/SideBus.js";

const BULL = ["🚀", "📈", "🟢", "moon", "pump", "long ", "bull", "buy", "lfg", "ath", "send it", "wagmi", "up only", "green"];
const BEAR = ["📉", "🐻", "🔴", "dump", "rug", "short ", "bear", "sell", "rekt", "crash", "liquidat", "ngmi", "red", "down bad"];

/** Bull/bear lean of a single message: +1 bullish, -1 bearish, 0 neutral. */
export function scoreSentiment(text: string): number {
  const t = ` ${text.toLowerCase()} `;
  let v = 0;
  for (const w of BULL) if (t.includes(w)) v++;
  for (const w of BEAR) if (t.includes(w)) v--;
  return Math.sign(v);
}

/** Lightweight rolling bullish/bearish gauge from chat keywords/emojis. */
export class Sentiment {
  private events: { t: number; v: number }[] = [];
  private readonly windowMs = 60_000;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly sideBus: SideBus) {}

  start(): void {
    this.timer = setInterval(() => this.publish(), 2000);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  observe(m: ChatMessage): void {
    // chat-mood gauge: streamer captions and tracked-account posts aren't chat
    if (m.kind === "caption" || m.kind === "post") return;
    const v = m.sentiment ?? scoreSentiment(m.text);
    if (v !== 0) this.events.push({ t: Date.now(), v });
  }

  private publish(): void {
    const now = Date.now();
    this.events = this.events.filter((e) => now - e.t < this.windowMs);
    const bullish = this.events.filter((e) => e.v > 0).length;
    const bearish = this.events.filter((e) => e.v < 0).length;
    const sample = bullish + bearish;
    const net = sample ? (bullish - bearish) / sample : 0;
    const gauge: SentimentGauge = { bullish, bearish, net, windowMs: this.windowMs, sample };
    this.sideBus.publish({ type: "sentiment", gauge });
  }
}
