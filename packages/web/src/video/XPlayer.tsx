import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { StreamSource } from "./playerUrls";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

/** X Live broadcast video, played via the server HLS proxy (no iframe). */
export function XPlayer({ s }: { s: StreamSource }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"loading" | "playing" | "offline" | "error" | "unreachable">("loading");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !s.xBroadcastId) {
      setState("offline");
      return;
    }
    let hls: Hls | null = null;
    let cancelled = false;
    setState("loading");

    (async () => {
      let r: Response;
      try {
        r = await fetch(`${API}/api/x/resolve?b=${encodeURIComponent(s.xBroadcastId!)}`);
      } catch {
        // network/server-down — distinct from a broadcast that simply isn't live
        if (!cancelled) setState("unreachable");
        return;
      }
      try {
        const j = r.ok ? await r.json() : null;
        if (cancelled) return;
        if (!j?.ok || !j.master) {
          setState("offline");
          return;
        }
        const src = `${API}/api/x/seg?u=${encodeURIComponent(j.master)}`;
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src; // Safari native HLS
          video.addEventListener("loadedmetadata", () => !cancelled && setState("playing"), { once: true });
          video.play().catch(() => {});
        } else if (Hls.isSupported()) {
          hls = new Hls({ lowLatencyMode: true, enableWorker: true });
          hls.loadSource(src);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            setState("playing");
            video.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal && !cancelled) setState("error");
          });
        } else {
          setState("error");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
    };
  }, [s.xBroadcastId, nonce]);

  return (
    <div className="vp vp-xlive">
      <video ref={videoRef} className="vp-frame" muted playsInline controls />
      {state !== "playing" && (
        <div className="vp-x-overlay">
          {state === "loading" ? (
            <div className="vp-x-note">Connecting to X Live…</div>
          ) : (
            <div className="vp-x-inner">
              <span className="pill x">X</span>
              <div className="vp-x-label">{s.label}</div>
              <div className="vp-x-note">
                {state === "offline"
                  ? "Broadcast isn't live right now."
                  : state === "unreachable"
                    ? "Can't reach the server — is it running?"
                    : "Couldn't play this stream."}
              </div>
              <a className="vp-x-watch" href={s.watchUrl} target="_blank" rel="noopener noreferrer">
                Watch on X ↗
              </a>
            </div>
          )}
        </div>
      )}
      <div className="vp-ctl">
        <button className="vp-btn" title="Reload" onClick={() => setNonce((n) => n + 1)}>
          ⟳
        </button>
        <a className="vp-btn" title="Open on X" href={s.watchUrl} target="_blank" rel="noopener noreferrer">
          ↗
        </a>
      </div>
    </div>
  );
}
