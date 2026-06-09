import { useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { ChatMessage, ConnectorInfo, Platform } from "@app/shared";
import { MessageRow } from "./MessageRow";
import { ChannelControls } from "./ChannelControls";
import { onJump } from "../lib/jumpBus";
import { useAuthorFocus } from "../state/authorFocus";
import { usePlatform } from "../state/usePlatform";
import { useAuth } from "../state/useAuth";

const PILL: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };

export function ColumnFeed({
  connector,
  messages,
  onClose,
}: {
  connector: ConnectorInfo;
  messages: ChatMessage[];
  onClose: (id: string) => void;
}) {
  const ref = useRef<VirtuosoHandle>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [following, setFollowing] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const { matches, focus } = useAuthorFocus();
  const { twitchLinked } = usePlatform();
  const { user } = useAuth();
  // channel-wide modes (slow/followers/subs/emote/clear) are Twitch-only and mod-gated
  const canControl =
    connector.platform === "twitch" && twitchLinked && (user?.role === "mod" || user?.role === "admin");
  // when a chatter is focused, this column shows only their messages
  const liveData = messages.filter(matches);
  // freeze the rendered list while scrolled up so reading history isn't yanked by new
  // messages or the buffer cap (resumes to live when you return to the bottom)
  const frozenRef = useRef(liveData);
  if (following) frozenRef.current = liveData;
  const data = following ? liveData : frozenRef.current;
  const newCount = following ? 0 : liveData.length - frozenRef.current.length;
  const msgsRef = useRef(data);
  msgsRef.current = data;
  const status = connector.status.kind;
  const dot = status === "connected" ? "●" : status === "connecting" ? "…" : "○";

  const resume = () => {
    setFollowing(true);
    ref.current?.scrollToIndex({ index: data.length - 1, behavior: "smooth" });
  };

  // self-heal: if we're at the bottom but following latched false (inertial scroll delta),
  // resume live-follow so new messages don't stay frozen out of view (see UnifiedView).
  useEffect(() => {
    if (atBottom && !following) setFollowing(true);
  }, [atBottom, following]);

  // applying/clearing the author filter must re-sync this column to the filtered live tail —
  // otherwise a frozen (scrolled-up) column keeps showing every chatter while "Showing only …"
  // is active. This is the bug where one column filters and a busy one doesn't.
  useEffect(() => {
    setFollowing(true);
  }, [focus]);

  // jump-to-message (from a notification) — if this column holds it, reveal + flash
  useEffect(
    () =>
      onJump((id) => {
        const i = msgsRef.current.findIndex((m) => m.id === id);
        if (i < 0) return;
        colRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        setFollowing(false);
        ref.current?.scrollToIndex({ index: i, behavior: "smooth", align: "center" });
        setFlash(id);
        window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 2400);
      }),
    [],
  );

  return (
    <div className="column" ref={colRef} data-col={connector.id} data-platform={connector.platform}>
      <div className="col-head">
        <span className={`pill ${connector.platform}`}>{PILL[connector.platform]}</span>
        <span className="col-title" title={connector.label}>
          {connector.label}
        </span>
        <span className={`col-status ${status}`} title={status}>
          {dot}
        </span>
        {canControl && <ChannelControls channel={connector.id} label={connector.label} />}
        <button className="col-x" title="Close column" onClick={() => onClose(connector.id)}>
          ✕
        </button>
      </div>
      <div
        className="col-feed"
        onWheel={(e) => {
          if (e.deltaY < 0 && following && !atBottom) setFollowing(false);
        }}
        onTouchMove={() => following && !atBottom && setFollowing(false)}
      >
        {data.length === 0 ? (
          <div className="col-empty">{messages.length ? "no messages from this chatter" : "no messages yet"}</div>
        ) : (
          <>
            <Virtuoso
              ref={ref}
              data={data}
              followOutput={following ? "auto" : false}
              atBottomThreshold={24}
              atBottomStateChange={(b) => {
                setAtBottom(b);
                if (b) setFollowing(true);
              }}
              initialTopMostItemIndex={data.length - 1}
              computeItemKey={(_i, m) => m.id}
              itemContent={(_i, m) => <MessageRow m={m} showChannel={false} showPill={false} flash={m.id === flash} />}
            />
            {!atBottom && (
              <button className="jump col-jump" onClick={resume}>
                {newCount > 0 ? `${newCount} new ↓` : "Live ↓"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
