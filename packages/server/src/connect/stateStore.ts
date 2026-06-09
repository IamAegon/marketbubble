import { randomBytes } from "node:crypto";

interface StateRec {
  handle: string;
  /** PKCE code_verifier (Kick); unused for Twitch */
  codeVerifier?: string;
  expiresAt: number;
}

const TTL = 10 * 60_000; // OAuth round-trips are short; expire stale state fast

/** In-memory, single-use CSRF `state` store binding an OAuth round-trip to the
 * user who initiated it. No DB needed — a dropped state just means "retry connect". */
class OAuthStateStore {
  private m = new Map<string, StateRec>();

  create(handle: string, codeVerifier?: string): string {
    this.sweep();
    const state = randomBytes(16).toString("hex");
    this.m.set(state, { handle, codeVerifier, expiresAt: Date.now() + TTL });
    return state;
  }

  /** single-use: returns + removes the record, or undefined if missing/expired */
  consume(state: string): StateRec | undefined {
    const r = this.m.get(state);
    if (!r) return undefined;
    this.m.delete(state);
    return r.expiresAt < Date.now() ? undefined : r;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.m) if (v.expiresAt < now) this.m.delete(k);
  }
}

export const oauthStates = new OAuthStateStore();
