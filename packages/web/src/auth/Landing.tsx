import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../state/useAuth";
import * as auth from "../lib/auth";

function BubbleIcon() {
  return (
    <svg className="bubble" viewBox="0 0 24 24" fill="none" aria-hidden width="34" height="34">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.2 3.6A.6.6 0 0 1 5 19.1V16h-.5A2.5 2.5 0 0 1 2 13.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        transform="translate(1 1)"
      />
    </svg>
  );
}

export function Landing() {
  const { user, loading, setUser } = useAuth();
  const nav = useNavigate();
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/app" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await auth.login(handle, password);
      setUser(res.user);
      nav("/app", { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <div className="landing-overlay" />
      <div className="auth-card">
        <div className="auth-brand">
          <BubbleIcon />
          <div className="auth-wordmark">Market Bubble</div>
        </div>
        <div className="auth-tag">Make money. Command attention.</div>

        <form className="auth-form" onSubmit={submit}>
          <input
            className="auth-input"
            placeholder="your cool handle"
            autoCapitalize="none"
            autoCorrect="off"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            required
          />
          <input
            className="auth-input"
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {err && <div className="auth-err">{err}</div>}
          <button className="auth-btn" type="submit" disabled={busy}>
            {busy ? "…" : "Log in"}
          </button>
        </form>
      </div>
      <div className="landing-foot">Live · Thursdays · 4PM PST · Presented by Polymarket</div>
    </div>
  );
}
