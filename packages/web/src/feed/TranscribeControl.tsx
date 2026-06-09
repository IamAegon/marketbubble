import { useEffect, useState } from "react";
import { startTranscribe, stopTranscribe, transcribeStatus, type TranscribeStatus } from "../lib/transcribe";

/** Start/stop live transcription per stream + worker status. Captions flow back
 * into the feed and power the "what was said" attribution + the Transcript view.
 * Shared by the Performance Lab and the Transcript page. */
export function TranscribeControl({ channels }: { channels: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<TranscribeStatus>({ active: [], worker: { online: false } });
  const refresh = () => transcribeStatus().then(setSt);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);
  const streams = channels.filter((c) => /^(twitch|kick):/.test(c.id));
  const isOn = (id: string) => st.active.some((a) => a.connector === id);
  const toggle = async (c: { id: string; label: string }) => {
    if (isOn(c.id)) await stopTranscribe(c.id);
    else await startTranscribe(c.id, c.label);
    refresh();
  };
  const liveN = st.active.length;
  return (
    <div className="pl-tx">
      <button className={`cc-chip ${liveN ? "active" : ""}`} onClick={() => setOpen((v) => !v)} title="Live transcription">
        🎙 Transcribe{liveN ? ` · ${liveN}` : ""}
      </button>
      {open && (
        <div className="pl-tx-pop">
          <div className="pl-tx-status">
            Worker:{" "}
            <b className={st.worker.online ? "ok" : "off"}>
              {st.worker.online ? `online · ${st.worker.model ?? ""} ${st.worker.device ?? ""}` : "offline"}
            </b>
          </div>
          {!st.worker.online && (
            <div className="cc-empty-sm">
              Start it: <code>packages/transcriber</code> → <code>uvicorn app:app --port 8799</code>
            </div>
          )}
          {streams.length === 0 && <div className="cc-empty-sm">No Twitch/Kick streams in view to transcribe.</div>}
          {streams.map((c) => (
            <label key={c.id} className="pl-tx-row">
              <input type="checkbox" checked={isOn(c.id)} onChange={() => toggle(c)} disabled={!st.worker.online && !isOn(c.id)} />
              <span>{c.label}</span>
              {isOn(c.id) && <span className="pl-tx-live">● live</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
