import { useEffect } from "react";
import { Virtuoso } from "react-virtuoso";
import { useChatSocket } from "../feed/useChatSocket";
import { MessageRow } from "../feed/MessageRow";

/** Transparent, read-only feed for use as an OBS browser source.
 * `/overlay?room=mb:shared` scopes to one channel; `?chroma=ff00ff` sets a key color. */
export function OverlayApp() {
  const { messages } = useChatSocket();
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  const chroma = params.get("chroma");

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = chroma ? `#${chroma}` : "transparent";
    return () => {
      document.body.style.background = prev;
    };
  }, [chroma]);

  const data = (room ? messages.filter((m) => m.channel === room) : messages).slice(-200);

  return (
    <div className="overlay">
      <Virtuoso
        data={data}
        followOutput="auto"
        initialTopMostItemIndex={Math.max(0, data.length - 1)}
        computeItemKey={(_i, m) => m.id}
        itemContent={(_i, m) => <MessageRow m={m} bare />}
      />
    </div>
  );
}
