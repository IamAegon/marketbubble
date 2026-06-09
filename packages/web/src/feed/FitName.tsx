import { useLayoutEffect, useRef } from "react";

const BASE = 12; // px — the chip's natural name size
const MIN = 8.5; // floor so it never becomes unreadable (ellipsis fallback below this)

/** Shrinks the streamer name's font-size just enough to fit its fixed-width slot on one line
 *  (so a long name fills the card instead of truncating), and keeps it centered. Measures an
 *  inner span — reliable even when the slot is centered + clipped. Only ~visible rows mount. */
export function FitName({ name, className }: { name: string; className?: string }) {
  const slot = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const s = slot.current;
    const i = inner.current;
    if (!s || !i) return;
    i.style.fontSize = `${BASE}px`; // reset (node may be reused for another message)
    const cs = getComputedStyle(s);
    const avail = s.clientWidth - parseFloat(cs.paddingLeft || "0") - parseFloat(cs.paddingRight || "0");
    const needed = i.scrollWidth; // inner sizes to the text, independent of the slot's clipping
    if (avail > 0 && needed > avail) {
      i.style.fontSize = `${Math.max(MIN, BASE * (avail / needed)).toFixed(2)}px`;
    }
  }, [name]);
  return (
    <span ref={slot} className={className}>
      <span ref={inner} className="fit-inner">
        {name}
      </span>
    </span>
  );
}
