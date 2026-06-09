import { useCallback, useMemo, useState } from "react";
import type { ChatMessage, ConnectorInfo, Platform, ReplyRef, RoomInfo } from "@app/shared";
import { ActionsProvider, type RowActions } from "../feed/actions";
import { useMuted } from "../state/muted";
import { UnifiedView } from "../feed/UnifiedView";
import { ColumnsView } from "../feed/ColumnsView";
import type { ChatView } from "../state/useLayout";
import { MessageComposer } from "../room/MessageComposer";
import { SendToPicker } from "../room/SendToPicker";
import { VideoDock } from "../video/VideoDock";
import { roomIcon } from "../lib/roomLabel";
import { usePlatform } from "../state/usePlatform";

/** The Live stage: video dock (optional) + chat feed + composer. All toolbar
 * controls live in the global TopBar now, so the stage is pure content. */
export function Stage({
  messages,
  posts,
  enabled,
  showNews,
  view,
  connectors,
  rooms,
  activeRoom,
  setActiveRoom,
  post,
  userDisplayName,
  actions,
  videoCollapsed,
  videoMode,
  centered,
}: {
  messages: ChatMessage[];
  posts: ChatMessage[];
  enabled: Set<Platform>;
  showNews: boolean;
  view: ChatView;
  connectors: ConnectorInfo[];
  rooms: RoomInfo[];
  activeRoom: string;
  setActiveRoom: (id: string) => void;
  post: (room: string, text: string, replyTo?: ReplyRef) => void;
  userDisplayName: string;
  actions: RowActions;
  videoCollapsed: boolean;
  videoMode: "theater" | "grid";
  /** center the unified feed in a reading column (vs full-width) */
  centered: boolean;
}) {
  // Composer destinations: MB rooms + connected Twitch streams you can post to.
  // Multi-select — one message can go to several chats at once.
  const { post: platformSend, twitchLinked, kickLinked } = usePlatform();
  const streamTargets = useMemo(
    () =>
      connectors
        .filter((c) => (c.platform === "twitch" || c.platform === "kick") && !c.id.startsWith("xnews:"))
        .map((c) => ({ id: c.id, label: c.label, platform: c.platform })),
    [connectors],
  );
  const enabledPlatforms = useMemo(() => {
    const s = new Set<string>();
    if (twitchLinked) s.add("twitch");
    if (kickLinked) s.add("kick");
    return s;
  }, [twitchLinked, kickLinked]);
  const [targets, setTargets] = useState<Set<string>>(() => new Set([activeRoom]));
  const toggleTarget = (id: string, isRoom: boolean) => {
    setTargets((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    if (isRoom) setActiveRoom(id);
  };
  const fmtTarget = (id: string) => {
    const r = rooms.find((x) => x.id === id);
    if (r) return `#${r.label}`;
    return streamTargets.find((x) => x.id === id)?.label ?? id;
  };
  const targetLabel = targets.size === 0 ? "" : targets.size === 1 ? fmtTarget([...targets][0]!) : `${targets.size} chats`;

  // mod-side muted-word filter applied before either view (so both feeds honor it)
  const muted = useMuted();
  const shown = useMemo(
    () => (muted.terms.length ? messages.filter((m) => !muted.match(m.text)) : messages),
    [messages, muted],
  );
  const shownPosts = useMemo(
    () => (muted.terms.length ? posts.filter((m) => !muted.match(m.text)) : posts),
    [posts, muted],
  );

  // reply / forward state (composer-local) — both target Market Bubble rooms
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  // after sending, reveal the destination column (Columns view) so you see it land
  const [focusCol, setFocusCol] = useState<{ id: string; n: number } | null>(null);
  // start a reply in the MAIN composer (not an inline box) and aim it at the chat the
  // message came from, so hitting ↩ on a Twitch/Kick/MB message just lets you type below.
  const startReply = useCallback(
    (m: ChatMessage) => {
      setReplyTo(m);
      setTargets(new Set([m.channel]));
      if (rooms.some((r) => r.id === m.channel)) setActiveRoom(m.channel);
    },
    [rooms, setActiveRoom],
  );
  const mergedActions = useMemo(
    () => ({ ...actions, reply: startReply, forward: setForwardMsg }),
    [actions, startReply],
  );

  const onSend = (text: string) => {
    const ref: ReplyRef | undefined = replyTo
      ? { id: replyTo.id, author: replyTo.author.displayName, textPreview: replyTo.text.slice(0, 120) }
      : undefined;
    // fan the message out to every selected destination — MB rooms via the socket,
    // Twitch/Kick streams via your linked account (threading the reply when the reply
    // target is a message in that same channel)
    for (const id of targets) {
      if (rooms.some((r) => r.id === id)) post(id, text, ref);
      else {
        const replyToMsgId = replyTo && replyTo.channel === id ? replyTo.platformMsgId : undefined;
        platformSend({ channel: id, text, ...(replyToMsgId ? { replyToMsgId } : {}) });
      }
    }
    const first = [...targets][0];
    if (first) setFocusCol((p) => ({ id: first, n: (p?.n ?? 0) + 1 }));
    setReplyTo(null);
  };
  const doForward = (roomId: string) => {
    if (!forwardMsg) return;
    post(roomId, forwardMsg.text, {
      id: forwardMsg.id,
      author: `${forwardMsg.author.displayName} · ${forwardMsg.channelLabel}`,
      textPreview: "",
    });
    setForwardMsg(null);
  };

  return (
    <div className="cc-stage">
      {!videoCollapsed && <VideoDock connectors={connectors} mode={videoMode} />}

      <div className="cc-stage-body">
        <ActionsProvider value={mergedActions}>
          {view === "unified" ? (
            <UnifiedView messages={shown} enabled={enabled} showNews={showNews} streamerTag centered={centered} />
          ) : (
            <ColumnsView
              connectors={connectors}
              messages={shown}
              posts={shownPosts}
              enabled={enabled}
              showNews={showNews}
              focus={focusCol}
            />
          )}
        </ActionsProvider>
      </div>

      <div className="composer-bar">
        <SendToPicker
          rooms={rooms}
          streams={streamTargets}
          enabledPlatforms={enabledPlatforms}
          targets={targets}
          onToggle={toggleTarget}
        />
        <MessageComposer
          roomLabel={targetLabel}
          displayName={userDisplayName}
          onSend={onSend}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          disabled={targets.size === 0}
        />
      </div>

      {forwardMsg && (
        <div className="fwd-overlay" onClick={() => setForwardMsg(null)}>
          <div className="fwd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fwd-head">Forward to a room</div>
            <div className="fwd-quote">
              <b>{forwardMsg.author.displayName}</b> · {forwardMsg.channelLabel}
              <div className="fwd-quote-text">{forwardMsg.text.slice(0, 160)}</div>
            </div>
            <div className="fwd-rooms">
              {rooms.map((r) => (
                <button key={r.id} onClick={() => doForward(r.id)}>
                  {roomIcon(r)}
                  {r.label}
                </button>
              ))}
            </div>
            <button className="fwd-cancel" onClick={() => setForwardMsg(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
