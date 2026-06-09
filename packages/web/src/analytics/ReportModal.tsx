import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Generic LaTeX-PDF preview modal: runs `fetcher`, previews the PDF in an iframe,
 * and offers download / open. Used for combined, per-session, and comparison reports. */
export function ReportModal({
  fetcher,
  filename,
  title,
  onClose,
}: {
  fetcher: () => Promise<Blob>;
  filename: string;
  title: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // One in-flight fetch per filename, reused across re-renders AND React
  // StrictMode's dev double-invoke of effects. Without this, the 2nd request
  // trips the server's per-user report cooldown and the modal shows a 429.
  const reqRef = useRef<{ key: string; p: Promise<Blob> } | null>(null);

  useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    setLoading(true);
    setErr(null);
    setUrl(null);
    if (reqRef.current?.key !== filename) reqRef.current = { key: filename, p: fetcher() };
    reqRef.current.p
      .then((blob) => {
        if (!alive) return;
        obj = URL.createObjectURL(blob);
        setUrl(obj);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : String(e) || "unknown error");
        setLoading(false);
      });
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return createPortal(
    <div className="report-overlay" onClick={onClose}>
      <div className="report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="report-head">
          <div className="report-title">
            {title}
            <span className="report-tex">LaTeX · PDF</span>
          </div>
          <div className="report-acts">
            {url && (
              <>
                <a className="cc-chip active" href={url} download={filename}>
                  ⤓ Download
                </a>
                <a className="cc-chip" href={url} target="_blank" rel="noopener noreferrer">
                  Open ↗
                </a>
              </>
            )}
            <button className="cc-icon-btn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>
        <div className="report-body">
          {loading && (
            <div className="report-state">
              <div className="report-spin" />
              <div>Generating report…</div>
              <div className="report-sub">compiling LaTeX → PDF on the server</div>
            </div>
          )}
          {err && (
            <div className="report-state">
              <div className="report-err">Couldn’t generate the report.</div>
              <div className="report-sub">{err}</div>
              <div className="report-sub">
                {/^(401|403)/.test(err)
                  ? "Sign in as a moderator or admin — reports are mod-gated."
                  : /^429/.test(err)
                    ? "It’s cooling down — wait a few seconds and try again."
                    : /^5\d\d/.test(err)
                      ? "The server errored while compiling. Check the server logs; ensure pdflatex is on the server’s PATH and restart it."
                      : "Couldn’t reach the API server — is it running, and did you restart it after the latest changes?"}
              </div>
            </div>
          )}
          {url && <iframe className="report-frame" src={url} title={title} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
