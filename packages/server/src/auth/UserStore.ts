import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import bcrypt from "bcryptjs";
import { ulid } from "ulid";
import type { PlatformId, PlatformLink, PlatformLinks, Role, User } from "@app/shared";
import { logger } from "../observability/logger.js";

/** Stored OAuth credentials for a linked platform account. SECRET — server-only,
 * never serialized to clients (excluded by strip()). */
export interface TokenRec {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms the access token expires */
  expiresAt?: number;
  login?: string;
  userId?: string;
  scopes?: string[];
}

interface StoredUser extends User {
  passwordHash: string;
  createdAt: number;
  /** linked-platform OAuth tokens — SECRET, projected to `platformLinks` for clients */
  platformTokens?: Partial<Record<PlatformId, TokenRec>>;
}

const linkOf = (t?: TokenRec): PlatformLink | undefined =>
  t ? { login: t.login, userId: t.userId, expiresAt: t.expiresAt, scopes: t.scopes } : undefined;

const COLORS = ["#e8ff9c", "#9146ff", "#53fc18", "#7dd3fc", "#fca5a5", "#fcd34d", "#f0abfc", "#86efac"];
const CONTROL = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

/** File-backed account store (bcrypt-hashed). Low volume → JSON is fine; no DB
 * dependency for auth. The first account created becomes `admin`. */
export class UserStore {
  private users = new Map<string, StoredUser>(); // keyed by lowercased handle

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try {
        const arr = JSON.parse(readFileSync(path, "utf8")) as StoredUser[];
        for (const u of arr) this.users.set(u.handle.toLowerCase(), u);
        logger.info({ count: this.users.size }, "loaded users");
      } catch (e) {
        logger.warn({ err: String(e) }, "failed to read users file");
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify([...this.users.values()], null, 2));
  }

  private strip(u: StoredUser): User {
    const { passwordHash, createdAt, platformTokens, ...rest } = u;
    let platformLinks: PlatformLinks | undefined;
    if (platformTokens) {
      const links: PlatformLinks = {};
      if (platformTokens.twitch) links.twitch = linkOf(platformTokens.twitch);
      if (platformTokens.kick) links.kick = linkOf(platformTokens.kick);
      if (Object.keys(links).length) platformLinks = links;
    }
    return { ...rest, platformLinks };
  }

  // ---- linked-platform OAuth tokens (server-only; never leave via strip) ----

  /** internal: the full token record (with secrets) for a user+platform */
  getPlatformToken(handle: string, platform: PlatformId): TokenRec | undefined {
    return this.users.get(handle.trim().toLowerCase().replace(/^@/, ""))?.platformTokens?.[platform];
  }

  setPlatformToken(handle: string, platform: PlatformId, rec: TokenRec): boolean {
    const u = this.users.get(handle.trim().toLowerCase().replace(/^@/, ""));
    if (!u) return false;
    u.platformTokens = { ...(u.platformTokens ?? {}), [platform]: rec };
    this.persist();
    return true;
  }

  /** merge a partial update (used by refresh-before-expiry) */
  updatePlatformToken(handle: string, platform: PlatformId, patch: Partial<TokenRec>): void {
    const u = this.users.get(handle.trim().toLowerCase().replace(/^@/, ""));
    const cur = u?.platformTokens?.[platform];
    if (!u || !cur) return;
    u.platformTokens![platform] = { ...cur, ...patch };
    this.persist();
  }

  clearPlatformToken(handle: string, platform: PlatformId): boolean {
    const u = this.users.get(handle.trim().toLowerCase().replace(/^@/, ""));
    if (!u?.platformTokens?.[platform]) return false;
    delete u.platformTokens[platform];
    this.persist();
    return true;
  }

  async signup(handle: string, password: string, displayName?: string): Promise<{ user?: User; error?: string }> {
    const h = handle.trim().toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,20}$/.test(h)) return { error: "handle must be 3–20 chars (a–z, 0–9, _)" };
    if (typeof password !== "string" || password.length < 6) return { error: "password must be at least 6 characters" };
    if (this.users.has(h)) return { error: "that handle is taken" };
    const role: Role = this.users.size === 0 ? "admin" : "user"; // first user = admin
    const u: StoredUser = {
      id: ulid(),
      handle: h,
      displayName: (displayName || handle).trim().slice(0, 24) || h,
      color: COLORS[this.users.size % COLORS.length]!,
      role,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: Date.now(),
    };
    this.users.set(h, u);
    this.persist();
    return { user: this.strip(u) };
  }

  async login(handle: string, password: string): Promise<{ user?: User; error?: string }> {
    const u = this.users.get(handle.trim().toLowerCase().replace(/^@/, ""));
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) return { error: "invalid handle or password" };
    return { user: this.strip(u) };
  }

  // ---- admin operations ----

  /** a single account (no secrets), fresh from the store */
  get(handle: string): User | undefined {
    const u = this.users.get(handle.trim().toLowerCase().replace(/^@/, ""));
    return u ? this.strip(u) : undefined;
  }

  /** self-service profile update (display name, color, avatar, welcome greeting) */
  updateProfile(
    handle: string,
    patch: { displayName?: string; color?: string; avatarUrl?: string; welcomeTitle?: string },
  ): { user?: User; error?: string } {
    const u = this.users.get(handle.trim().toLowerCase().replace(/^@/, ""));
    if (!u) return { error: "no such user" };
    if (patch.displayName !== undefined) {
      const dn = patch.displayName.trim().slice(0, 24);
      if (dn) u.displayName = dn;
    }
    if (patch.welcomeTitle !== undefined) {
      const w = String(patch.welcomeTitle).replace(CONTROL, " ").trim().slice(0, 80);
      u.welcomeTitle = w || undefined;
    }
    if (patch.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(patch.color)) u.color = patch.color;
    if (patch.avatarUrl !== undefined) {
      const a = String(patch.avatarUrl);
      // accept https image URLs or small data URLs; cap size to keep the JSON sane
      if (a === "") u.avatarUrl = undefined;
      else if ((/^https:\/\//.test(a) || /^data:image\//.test(a)) && a.length < 200_000) u.avatarUrl = a;
    }
    this.persist();
    return { user: this.strip(u) };
  }

  /** all accounts (no password hashes), oldest first */
  list(): (User & { createdAt: number })[] {
    return [...this.users.values()]
      .map((u) => ({ ...this.strip(u), createdAt: u.createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** admin-create an account with an explicit role (does not auto-promote). */
  async create(handle: string, password: string, displayName: string, role: Role): Promise<{ user?: User; error?: string }> {
    const h = handle.trim().toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,20}$/.test(h)) return { error: "handle must be 3–20 chars (a–z, 0–9, _)" };
    if (typeof password !== "string" || password.length < 6) return { error: "password must be at least 6 characters" };
    if (this.users.has(h)) return { error: "that handle is taken" };
    const r: Role = role === "mod" || role === "admin" ? role : "user";
    const u: StoredUser = {
      id: ulid(),
      handle: h,
      displayName: (displayName || h).trim().slice(0, 24) || h,
      color: COLORS[this.users.size % COLORS.length]!,
      role: r,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: Date.now(),
    };
    this.users.set(h, u);
    this.persist();
    return { user: this.strip(u) };
  }

  setRole(handle: string, role: Role): { ok: boolean; error?: string } {
    const u = this.users.get(handle.toLowerCase());
    if (!u) return { ok: false, error: "no such user" };
    if (role !== "user" && role !== "mod" && role !== "admin") return { ok: false, error: "invalid role" };
    // never leave zero admins
    if (u.role === "admin" && role !== "admin" && [...this.users.values()].filter((x) => x.role === "admin").length <= 1)
      return { ok: false, error: "can't demote the last admin" };
    u.role = role;
    this.persist();
    return { ok: true };
  }

  async setPassword(handle: string, password: string): Promise<{ ok: boolean; error?: string }> {
    const u = this.users.get(handle.toLowerCase());
    if (!u) return { ok: false, error: "no such user" };
    if (typeof password !== "string" || password.length < 6) return { ok: false, error: "password must be at least 6 characters" };
    u.passwordHash = await bcrypt.hash(password, 10);
    this.persist();
    return { ok: true };
  }

  remove(handle: string): { ok: boolean; error?: string } {
    const u = this.users.get(handle.toLowerCase());
    if (!u) return { ok: false, error: "no such user" };
    if (u.role === "admin" && [...this.users.values()].filter((x) => x.role === "admin").length <= 1)
      return { ok: false, error: "can't delete the last admin" };
    this.users.delete(handle.toLowerCase());
    this.persist();
    return { ok: true };
  }
}
