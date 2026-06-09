export type Role = "user" | "mod" | "admin";

export interface User {
  id: string;
  handle: string;
  displayName: string;
  color: string;
  role: Role;
  /** profile avatar (image URL or small data URL) */
  avatarUrl?: string;
  /** personal greeting shown on login, e.g. "welcome {welcomeTitle}" */
  welcomeTitle?: string;
  /** linked streaming platform accounts (Twitch/Kick) — public projection, NO tokens */
  platformLinks?: PlatformLinks;
}

/** Public projection of a linked platform account — what the UI may see (never the token). */
export interface PlatformLink {
  /** the platform login/username the account authorized as */
  login?: string;
  /** the platform's user id */
  userId?: string;
  /** epoch ms the access token expires (for "reconnect needed" hints) */
  expiresAt?: number;
  /** granted OAuth scopes */
  scopes?: string[];
}
export type PlatformLinks = { twitch?: PlatformLink; kick?: PlatformLink };

export interface AuthResponse {
  token: string;
  user: User;
}

/** A user row in the admin panel (no secrets). */
export interface AdminUser extends User {
  createdAt: number;
}

/** A native Market Bubble chat room. */
export interface RoomInfo {
  id: string; // e.g. "mb:shared" or "dm:ansem~nova"
  label: string; // "Shared"
  access: "all" | "mod";
  /** if set, a private room — only these handles can read/write (DMs/group DMs) */
  members?: string[];
  /** normalized handle of the user who created a private room — enables creator-only edit */
  creator?: string;
  /** true once the label was set by an explicit rename (suppresses auto-relabel on member changes) */
  renamed?: boolean;
}

/** A teammate in the people-picker (no secrets). */
export interface DirectoryUser {
  handle: string;
  displayName: string;
  color: string;
  /** profile picture (used as the DM avatar) */
  avatarUrl?: string;
}
