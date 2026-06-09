import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@app/shared";
import { EmojiPicker } from "./EmojiPicker";

export function MessageComposer({
  roomLabel,
  displayName,
  onSend,
  replyTo,
  onClearReply,
  disabled = false,
}: {
  roomLabel: string;
  displayName: string;
  onSend: (text: string) => void;
  replyTo?: ChatMessage | null;
  onClearReply?: () => void;
  /** no destination selected → block sending */
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // hitting ↩ on a message drops the cursor straight into the composer, so replying is
  // just: click reply → type → send (no hunting for an inline box)
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);
  /** insert at the caret (falls back to appending); functional update so quick
   * repeated picks never clobber each other */
  const insert = (s: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    setText((prev) => (start == null ? prev + s : prev.slice(0, start) + s + prev.slice(end ?? start)));
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        const p = (start ?? el.value.length) + s.length;
        el.setSelectionRange(p, p);
      });
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };
  return (
    <div className="composer-wrap">
      {replyTo && (
        <div className="composer-reply">
          <span className="composer-reply-text">
            ↩ Replying to <b>{replyTo.author.displayName}</b>
            <span className="composer-reply-snip"> · {replyTo.text.slice(0, 90)}</span>
          </span>
          <button type="button" className="composer-reply-x" onClick={onClearReply} title="Cancel reply">
            ✕
          </button>
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <span className="composer-name" title={`Posting as ${displayName}`}>
          {displayName}
        </span>
        <input
          ref={inputRef}
          className="composer-input"
          placeholder={
            disabled
              ? "Pick a chat above to message…"
              : replyTo
              ? `Reply in ${roomLabel} …`
              : `Message ${roomLabel} …`
          }
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="composer-emoji-wrap">
          <button type="button" className="composer-emoji" title="Emoji" aria-label="Emoji" onClick={() => setEmojiOpen((v) => !v)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8.5 14a4 4 0 0 0 7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="9" cy="9.8" r="1.05" fill="currentColor" />
              <circle cx="15" cy="9.8" r="1.05" fill="currentColor" />
            </svg>
          </button>
          {emojiOpen && (
            <>
              <div className="emoji-backdrop" onClick={() => setEmojiOpen(false)} />
              <EmojiPicker onPick={insert} />
            </>
          )}
        </div>
        <button className="composer-send" type="submit" disabled={!text.trim() || disabled}>
          Send
        </button>
      </form>
    </div>
  );
}
