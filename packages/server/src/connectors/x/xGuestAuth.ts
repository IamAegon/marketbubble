/**
 * X guest-token manager. The x.com web client authenticates anonymously with a
 * public Bearer token + a short-lived guest token (~3h). Validated live.
 */
export class XGuestAuth {
  private token: string | null = null;
  private fetchedAt = 0;
  private readonly ttlMs = 3 * 60 * 60 * 1000;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly bearer: string,
    private readonly userAgent: string,
  ) {}

  private async fetchToken(): Promise<string> {
    const r = await fetch("https://api.x.com/1.1/guest/activate.json", {
      method: "POST",
      headers: { authorization: `Bearer ${this.bearer}`, "User-Agent": this.userAgent },
    });
    if (!r.ok) throw new Error(`guest/activate ${r.status}`);
    const j = (await r.json()) as { guest_token?: string };
    if (!j.guest_token) throw new Error("guest/activate: no guest_token");
    this.token = j.guest_token;
    this.fetchedAt = Date.now();
    return this.token;
  }

  async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() - this.fetchedAt < this.ttlMs) return this.token;
    if (!this.inflight) {
      this.inflight = this.fetchToken().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  async authHeaders(force = false): Promise<Record<string, string>> {
    const gt = await this.getToken(force);
    return {
      authorization: `Bearer ${this.bearer}`,
      "x-guest-token": gt,
      "User-Agent": this.userAgent,
      accept: "*/*",
    };
  }
}
