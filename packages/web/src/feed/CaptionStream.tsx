import { useEffect, useRef, type ReactNode } from "react";

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export interface CaptionLine {
  id?: string;
  t: number;
  text: string;
  channelLabel?: string;
}

/** A scrollable transcript reader — the running STT/caption lines. Pins to the
 * bottom for a live stream (unless the user scrolls up); static for replay.
 * Extracted from the old standalone Transcript page so it can live on Reactions. */
export function CaptionStream({
  lines,
  showChannel = false,
  pin = true,
  empty,
}: {
  lines: CaptionLine[];
  showChannel?: boolean;
  pin?: boolean;
  empty?: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const onScroll = () => {
    const el = bodyRef.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (pin && pinned.current && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines.length, pin]);

  return (
    <div className="tx-body pl-tx-body" ref={bodyRef} onScroll={onScroll}>
      {lines.length === 0 ? (
        <div className="tx-empty">{empty ?? <div className="cc-empty-sm">No transcript yet.</div>}</div>
      ) : (
        lines.map((m, i) => (
          <div key={m.id ?? `${m.t}-${i}`} className="tx-line">
            <span className="tx-time">{clock(m.t)}</span>
            {showChannel && m.channelLabel && <span className="tx-ch">{m.channelLabel}</span>}
            <span className="tx-text">{m.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
