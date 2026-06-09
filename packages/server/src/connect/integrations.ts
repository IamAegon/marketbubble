import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTwitchCreds } from "./oauth-twitch.js";
import { setKickCreds } from "./oauth-kick.js";
import { logger } from "../observability/logger.js";

interface Creds {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}
interface Data {
  twitch?: Creds;
  kick?: Creds;
}

/** Admin-set OAuth app credentials, persisted server-side and applied to the
 * platform OAuth modules — so connecting can be set up entirely from the UI,
 * no .env / restart. Secrets live next to the other server-only data (never
 * returned to clients). Env vars act as the default when nothing is saved. */
export class IntegrationStore {
  private data: Data = {};

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try {
        this.data = JSON.parse(readFileSync(path, "utf8")) as Data;
        logger.info("loaded integration credentials");
      } catch (e) {
        logger.warn({ err: String(e) }, "failed to read integrations file");
      }
    }
    if (this.data.twitch) setTwitchCreds(this.data.twitch);
    if (this.data.kick) setKickCreds(this.data.kick);
  }

  setTwitch(clientId: string, clientSecret: string, redirectUri?: string): void {
    this.data.twitch = { clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri: redirectUri?.trim() || undefined };
    this.persist();
    setTwitchCreds(this.data.twitch);
  }

  clearTwitch(): void {
    delete this.data.twitch;
    this.persist();
    // revert to env defaults (if any)
    setTwitchCreds({
      clientId: process.env.TWITCH_CLIENT_ID || "",
      clientSecret: process.env.TWITCH_CLIENT_SECRET || "",
      redirectUri: process.env.TWITCH_REDIRECT_URI || "",
    });
  }

  setKick(clientId: string, clientSecret: string, redirectUri?: string): void {
    this.data.kick = { clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri: redirectUri?.trim() || undefined };
    this.persist();
    setKickCreds(this.data.kick);
  }

  clearKick(): void {
    delete this.data.kick;
    this.persist();
    setKickCreds({
      clientId: process.env.KICK_CLIENT_ID || "",
      clientSecret: process.env.KICK_CLIENT_SECRET || "",
      redirectUri: process.env.KICK_REDIRECT_URI || "",
    });
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    } catch (e) {
      logger.warn({ err: String(e) }, "failed to persist integrations");
    }
  }
}
