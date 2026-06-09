import { useEffect, useState } from "react";
import { getTracked, addTracked, removeTracked, type TrackedAccountInfo } from "../lib/tracked";
import { UserLink } from "../components/UserLink";

export function TrackAccounts() {
  const [accounts, setAccounts] = useState<TrackedAccountInfo[]>([]);
  const [handle, setHandle] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => getTracked().then(setAccounts).catch(() => {});
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await addTracked(handle.trim(), category.trim() || "News");
      setHandle("");
      setCategory("");
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? "failed");
    } finally {
      setBusy(false);
    }
  };

  const cats = [...new Set(accounts.map((a) => a.category))].sort();
  const hue = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  };
  const statusLabel = (s: string) => (s === "connected" ? "Live" : s === "connecting" ? "Connecting" : "Reconnecting");

  return (
    <div className="trk">
      <form className="trk-add" onSubmit={submit}>
        <input className="trk-in" placeholder="X handle (e.g. saylor)" value={handle} onChange={(e) => setHandle(e.target.value)} />
        <input
          className="trk-in"
          placeholder="category (e.g. Crypto)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list="track-cats"
        />
        <datalist id="track-cats">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button className="trk-add-btn" type="submit" disabled={busy}>
          {busy ? "…" : "＋ Track"}
        </button>
        {err && (
          <span className="add-err" title={err}>
            {err}
          </span>
        )}
      </form>

      {accounts.length === 0 && <div className="cc-empty-sm">No tracked accounts yet.</div>}
      {cats.map((cat) => {
        const inCat = accounts.filter((a) => a.category === cat);
        return (
          <div className="trk-cat" key={cat}>
            <div className="trk-cat-head">
              <span className="trk-cat-name">{cat}</span>
              <span className="trk-cat-n">{inCat.length}</span>
            </div>
            <div className="trk-grid">
              {inCat.map((a) => (
                <div className="trk-card" key={a.id}>
                  <span className="trk-av" style={{ background: `hsl(${hue(a.handle)} 45% 38%)` }}>
                    {a.handle.charAt(0).toUpperCase()}
                  </span>
                  <span className="trk-main">
                    <UserLink platform="x" username={a.handle} kind="streamer" className="trk-handle">
                      @{a.handle}
                    </UserLink>
                    <span className="trk-status">
                      <span className={`trk-dot ${a.status}`} />
                      {statusLabel(a.status)}
                    </span>
                  </span>
                  <button className="trk-x" title="Remove" onClick={() => removeTracked(a.handle).then(refresh)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
