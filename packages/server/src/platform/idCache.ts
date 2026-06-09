// channel login → platform user id, cached (resolving via Get Users is rate-limited)
const TTL = 10 * 60_000;
const cache = new Map<string, { id: string; at: number }>();

const key = (platform: string, login: string) => `${platform}:${login.toLowerCase()}`;

export function getCachedId(platform: string, login: string): string | undefined {
  const e = cache.get(key(platform, login));
  if (!e) return undefined;
  if (Date.now() - e.at > TTL) {
    cache.delete(key(platform, login));
    return undefined;
  }
  return e.id;
}

export function setCachedId(platform: string, login: string, id: string): void {
  cache.set(key(platform, login), { id, at: Date.now() });
}
