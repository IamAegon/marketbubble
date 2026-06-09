import type { Platform } from "@app/shared";
import type { SavedStore } from "../state/useSaved";
import { AuthorLink } from "../feed/AuthorLink";

const PILL: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };

export function SidePanel({ store, onClose }: { store: SavedStore; onClose: () => void }) {
  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="panel-title">Saved Messages{store.items.length ? ` (${store.items.length})` : ""}</div>
        <div className="panel-head-actions">
          {store.items.length > 0 && (
            <button className="clear" onClick={store.clear}>
              Clear
            </button>
          )}
          <button className="panel-x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="panel-body">
        {store.items.length === 0 ? (
          <div className="panel-empty">
            Star (☆) or note (✎) a message and it'll be kept here — add a note inline anytime.
          </div>
        ) : (
          store.items
            .slice()
            .reverse()
            .map((it) => (
              <div className="saved-item" key={it.message.id}>
                <div className="saved-meta">
                  <span className={`pill ${it.message.platform}`}>{PILL[it.message.platform]}</span>
                  <AuthorLink m={it.message} className="saved-author" />
                  <span className="saved-ch">{it.message.channelLabel}</span>
                  <button className="saved-x" onClick={() => store.remove(it.message.id)} title="Remove">
                    ✕
                  </button>
                </div>
                <div className="saved-text">{it.message.text}</div>
                <textarea
                  className="note-input"
                  value={it.note}
                  placeholder="add a note…"
                  onChange={(e) => store.updateNote(it.message.id, e.target.value)}
                />
              </div>
            ))
        )}
      </div>
    </aside>
  );
}
