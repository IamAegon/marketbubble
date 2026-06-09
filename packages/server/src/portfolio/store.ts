import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Portfolio, PortfolioCall, PortfolioDraft } from "@app/shared";

const COLORS = ["#A0241F", "#1F5A3D", "#B0892F", "#6B4FA0", "#2B6C8F"];

/** Known ticker → CoinGecko id, so the UI can take a bare symbol. */
export const COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  HYPE: "hyperliquid",
  VVV: "venice-token",
  ZEC: "zcash",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  SUI: "sui",
};

const id = () => randomUUID().slice(0, 8);

/** Persisted registry of tracked portfolios (the stream's trade calls). */
export class PortfolioStore {
  private items: Portfolio[] = [];

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try {
        this.items = JSON.parse(readFileSync(path, "utf8")) as Portfolio[];
      } catch {
        /* ignore */
      }
    }
    if (this.items.length === 0) this.seed();
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.items, null, 2));
    } catch {
      /* ignore */
    }
  }

  /** Two example baskets matching the reference report (Ansem's stream calls). */
  private seed(): void {
    const startedAt = Date.UTC(2026, 3, 30); // Apr 30 2026
    const mkCall = (symbol: string): PortfolioCall => ({
      id: id(),
      symbol,
      coingeckoId: COIN_IDS[symbol] ?? symbol.toLowerCase(),
      side: "long",
      weight: 1,
      calledAt: startedAt,
      calledBy: "Ansem",
    });
    const now = Date.now();
    this.items = [
      {
        id: id(),
        name: "BTC + SOL",
        startingCapital: 100_000,
        startedAt,
        color: "#A0241F",
        calls: [mkCall("BTC"), mkCall("SOL")],
        createdBy: "system",
        createdAt: now,
        tagline: "The Majors",
      },
      {
        id: id(),
        name: "VVV + HYPE + ZEC",
        startingCapital: 100_000,
        startedAt,
        color: "#1F5A3D",
        calls: [mkCall("VVV"), mkCall("HYPE"), mkCall("ZEC")],
        createdBy: "system",
        createdAt: now,
        tagline: "Never Fade Ansem",
      },
    ];
    this.persist();
  }

  list(): Portfolio[] {
    return this.items;
  }
  get(pid: string): Portfolio | undefined {
    return this.items.find((p) => p.id === pid);
  }

  create(draft: PortfolioDraft, createdBy: string): Portfolio {
    const p: Portfolio = {
      id: id(),
      name: (draft.name || "Untitled").trim().slice(0, 60),
      startingCapital: draft.startingCapital && draft.startingCapital > 0 ? draft.startingCapital : 100_000,
      startedAt: draft.startedAt && draft.startedAt > 0 ? draft.startedAt : Date.now(),
      color: draft.color || COLORS[this.items.length % COLORS.length]!,
      calls: [],
      createdBy,
      createdAt: Date.now(),
      tagline: draft.tagline?.slice(0, 60),
    };
    this.items.push(p);
    this.persist();
    return p;
  }

  update(pid: string, patch: Partial<PortfolioDraft>): Portfolio | undefined {
    const p = this.get(pid);
    if (!p) return undefined;
    if (patch.name != null) p.name = patch.name.trim().slice(0, 60);
    if (patch.startingCapital != null && patch.startingCapital > 0) p.startingCapital = patch.startingCapital;
    if (patch.startedAt != null && patch.startedAt > 0) p.startedAt = patch.startedAt;
    if (patch.color != null) p.color = patch.color;
    if (patch.tagline != null) p.tagline = patch.tagline.slice(0, 60);
    this.persist();
    return p;
  }

  remove(pid: string): boolean {
    const n = this.items.length;
    this.items = this.items.filter((p) => p.id !== pid);
    const removed = this.items.length < n;
    if (removed) this.persist();
    return removed;
  }

  addCall(pid: string, draft: Partial<PortfolioCall>): PortfolioCall | undefined {
    const p = this.get(pid);
    if (!p) return undefined;
    const symbol = String(draft.symbol || "").trim().toUpperCase();
    if (!symbol) return undefined;
    const call: PortfolioCall = {
      id: id(),
      symbol,
      coingeckoId: (draft.coingeckoId || COIN_IDS[symbol] || symbol.toLowerCase()).trim(),
      side: draft.side === "short" ? "short" : "long",
      weight: draft.weight && draft.weight > 0 ? draft.weight : 1,
      entryPrice: draft.entryPrice && draft.entryPrice > 0 ? draft.entryPrice : undefined,
      calledAt: draft.calledAt && draft.calledAt > 0 ? draft.calledAt : Date.now(),
      calledBy: draft.calledBy?.slice(0, 40),
      note: draft.note?.slice(0, 200),
    };
    p.calls.push(call);
    this.persist();
    return call;
  }

  updateCall(pid: string, cid: string, patch: Partial<PortfolioCall>): PortfolioCall | undefined {
    const c = this.get(pid)?.calls.find((x) => x.id === cid);
    if (!c) return undefined;
    if (patch.side) c.side = patch.side === "short" ? "short" : "long";
    if (patch.weight != null && patch.weight > 0) c.weight = patch.weight;
    if (patch.entryPrice != null) c.entryPrice = patch.entryPrice > 0 ? patch.entryPrice : undefined;
    if (patch.calledAt != null && patch.calledAt > 0) c.calledAt = patch.calledAt;
    if (patch.calledBy != null) c.calledBy = patch.calledBy.slice(0, 40);
    if (patch.note != null) c.note = patch.note.slice(0, 200);
    if (patch.closedAt !== undefined) c.closedAt = patch.closedAt || undefined;
    if (patch.closePrice !== undefined) c.closePrice = patch.closePrice || undefined;
    this.persist();
    return c;
  }

  removeCall(pid: string, cid: string): boolean {
    const p = this.get(pid);
    if (!p) return false;
    const n = p.calls.length;
    p.calls = p.calls.filter((c) => c.id !== cid);
    const removed = p.calls.length < n;
    if (removed) this.persist();
    return removed;
  }

  /** Every coingecko id referenced across all portfolios (for history prefetch). */
  allCoinIds(): string[] {
    return [...new Set(this.items.flatMap((p) => p.calls.map((c) => c.coingeckoId)))];
  }
}
