import { useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { ChatMessage, Platform } from "@app/shared";
import { MessageRow } from "./MessageRow";
import { onJump } from "../lib/jumpBus";
import { useAuthorFocus } from "../state/authorFocus";

export function UnifiedView({
  messages,
  enabled,
  showNews,
  showChannel = true,
  showPill = true,
  bare = false,
  streamerTag = false,
  centered = false,
}: {
  messages: ChatMessage[];
  enabled: Set<Platform>;
  showNews: boolean;
  /** show the per-message room/channel label (off inside a single room — the header names it) */
  showChannel?: boolean;
  /** show the platform pill (off inside a single MB room — everything is MB) */
  showPill?: boolean;
  /** read-only rows (no hover action chrome) — for overlays */
  bare?: boolean;
  /** render the source as one prominent platform-colored streamer chip */
  streamerTag?: boolean;
  /** constrain rows to a centered max-width reading column */
  centered?: boolean;
}) {
  const ref = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  // whether to auto-stick to the newest message. Scrolling up (wheel/touch) pauses
  // it immediately so a fast feed can't snap you back while you're reading history.
  const [following, setFollowing] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const { matches, focus } = useAuthorFocus();
  // tracked-account news posts only appear when News is selected; chat is platform-filtered;
  // when a chatter is focused, show only their messages
  const liveData = messages.filter((m) => (m.kind === "post" ? showNews : enabled.has(m.platform)) && matches(m));
  // FREEZE the rendered list while scrolled up: new messages (and the buffer cap slicing
  // old ones off the top) must not move what you're reading. We hold the last snapshot and
  // only swap back to live when you return to the bottom — so the view stays rock-still.
  const frozenRef = useRef(liveData);
  if (following) frozenRef.current = liveData;
  const data = following ? liveData : frozenRef.current;
  const newCount = following ? 0 : liveData.length - frozenRef.current.length;
  const dataRef = useRef(data);
  dataRef.current = data;

  // a toast (or elsewhere) asked us to jump to a message — scroll to it + flash it
  useEffect(
    () =>
      onJump((id) => {
        const idx = dataRef.current.findIndex((m) => m.id === id);
        if (idx < 0) return;
        setFollowing(false);
        ref.current?.scrollToIndex({ index: idx, behavior: "smooth", align: "center" });
        setFlash(id);
        window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 2400);
      }),
    [],
  );

  const resume = () => {
    setFollowing(true);
    ref.current?.scrollToIndex({ index: data.length - 1, behavior: "smooth" });
  };

  // Stay glued to the live tail whenever Virtuoso reports we're actually at the bottom.
  // atBottomStateChange only fires on a TRANSITION, so a momentary desync (following=false
  // while atBottom=true — e.g. an inertial trackpad delta at rest at the bottom) would
  // otherwise stay frozen until the list length changed or a filter was toggled. This
  // self-heals it so newly-arrived messages never silently stop appearing.
  useEffect(() => {
    if (atBottom && !following) setFollowing(true);
  }, [atBottom, following]);

  // Applying or clearing the author filter is an explicit action — re-sync to the (now
  // filtered) live tail. Otherwise the freeze above keeps rendering the old unfiltered
  // snapshot while you're scrolled up, so the "Showing only …" banner shows but the feed
  // never actually narrows to that chatter.
  useEffect(() => {
    setFollowing(true);
  }, [focus]);

  if (data.length === 0) {
    return (
      <div className="feed">
        <div className="empty">
          {focus
            ? `No messages from ${focus.label} yet — clear the filter to see all chat.`
            : "Waiting for live messages… add a source above and make sure it's currently live."}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`feed ${centered ? "feed-centered" : ""}`}
      onWheel={(e) => {
        if (e.deltaY < 0 && following && !atBottom) setFollowing(false);
      }}
      onTouchMove={() => following && !atBottom && setFollowing(false)}
    >
      <Virtuoso
        ref={ref}
        data={data}
        followOutput={following ? "auto" : false}
        atBottomThreshold={24}
        atBottomStateChange={(b) => {
          setAtBottom(b);
          if (b) setFollowing(true); // reaching the bottom resumes live-follow
        }}
        initialTopMostItemIndex={data.length - 1}
        computeItemKey={(_i, m) => m.id}
        itemContent={(_i, m) => (
          <MessageRow m={m} flash={m.id === flash} showChannel={showChannel} showPill={showPill} bare={bare} streamerTag={streamerTag} />
        )}
      />
      {!atBottom && (
        <button className="jump" onClick={resume}>
          {newCount > 0 ? `${newCount} new message${newCount === 1 ? "" : "s"} ↓` : "Jump to live ↓"}
        </button>
      )}
    </div>
  );
}
