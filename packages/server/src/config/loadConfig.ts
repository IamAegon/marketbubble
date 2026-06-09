import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { ChannelsConfigSchema, type ChannelsConfig } from "@app/shared";
import { logger } from "../observability/logger.js";

/** Locate a Chrome/Chromium binary across platforms (used for the Kick resolve). */
function detectChromeBin(): string {
  const candidates = [
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  // fall back to PATH lookup
  return "google-chrome";
}

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// the public web bearer token used by x.com itself
const DEFAULT_X_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export interface AppConfig {
  port: number;
  x: { bearer: string; userAgent: string; authToken?: string };
  kick: { chromeBin: string; pusherKey: string; cluster: string };
  channels: ChannelsConfig;
}

export function loadConfig(): AppConfig {
  const channelsPath = resolve(process.cwd(), process.env.CHANNELS_FILE ?? "channels.yaml");
  let channels: ChannelsConfig;
  if (existsSync(channelsPath)) {
    channels = ChannelsConfigSchema.parse(yaml.load(readFileSync(channelsPath, "utf8")) ?? {});
    logger.info({ channelsPath }, "loaded channels config");
  } else {
    channels = ChannelsConfigSchema.parse({});
    logger.warn({ channelsPath }, "no channels.yaml found; starting with no sources");
  }

  return {
    port: Number(process.env.PORT ?? 8787),
    x: {
      bearer: process.env.X_WEB_BEARER || DEFAULT_X_BEARER,
      userAgent: process.env.X_USER_AGENT || DEFAULT_UA,
      // logged-in X `auth_token` cookie — unlocks reading live-broadcast chat (guest
      // access is occupancy-only). Use a burner account; never commit it.
      authToken: process.env.X_AUTH_TOKEN || undefined,
    },
    kick: {
      chromeBin: process.env.KICK_CHROME_BIN || detectChromeBin(),
      pusherKey: process.env.KICK_PUSHER_KEY || "32cbd69e4b950bf97679",
      cluster: process.env.KICK_PUSHER_CLUSTER || "us2",
    },
    channels,
  };
}
