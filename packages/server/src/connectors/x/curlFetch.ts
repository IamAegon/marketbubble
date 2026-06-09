import { execFile } from "node:child_process";
import { logger } from "../../observability/logger.js";

let warnedNoCurl = false;

/** Feed-reader User-Agent for Nitter RSS. A browser-like UA (…Chrome…) gets rejected by
 * some instances (xcancel.com returns 400 "only works inside an RSS client"); a plain
 * feed-reader UA is served by every working instance. */
export const NITTER_UA = "MarketBubble/1.0 (+rss; tweet-tracker)";

/** Fetch a URL via the `curl` binary (its TLS fingerprint passes anti-bot checks that
 * block Node's undici fetch, e.g. Nitter instances). Returns the body text plus the
 * final HTTP status so callers can tell a real feed (200) from a throttle/challenge
 * (429/403/400) and back off the right way. `ok` is true only on a 2xx response. */
export function curlText(
  url: string,
  userAgent: string,
  signal: AbortSignal,
  timeoutSec = 15,
): Promise<{ ok: boolean; body: string; status: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      "curl",
      [
        "-s",
        "-L",
        "--compressed",
        "-m",
        String(timeoutSec),
        "-A",
        userAgent,
        "-H",
        "accept: application/rss+xml, text/xml, */*",
        "-w",
        "\n%{http_code}", // appended after the body so we can read the final status
        url,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          // distinguish a missing binary (host misconfig) from a transient fetch failure
          if ((err as NodeJS.ErrnoException).code === "ENOENT" && !warnedNoCurl) {
            warnedNoCurl = true;
            logger.error("`curl` not found on PATH — X/Nitter news fetching is disabled until curl is installed.");
          }
          resolve({ ok: false, body: "", status: 0 });
          return;
        }
        const s = String(stdout);
        const nl = s.lastIndexOf("\n");
        const status = nl >= 0 ? Number(s.slice(nl + 1).trim()) || 0 : 0;
        const body = nl >= 0 ? s.slice(0, nl) : s;
        resolve({ ok: status >= 200 && status < 300, body, status });
      },
    );
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
