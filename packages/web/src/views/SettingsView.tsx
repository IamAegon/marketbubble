import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminUser, ConnectStatus, Platform, PlatformId, Role, TwitchFollow } from "@app/shared";
import { useDashboard } from "../state/DashboardProvider";
import { NOTIF_TYPES, NOTIF_VIEWS } from "../state/useLayout";
import { useAuth } from "../state/useAuth";
import { usePlatform } from "../state/usePlatform";
import { createUser, deleteUser, fetchUsers, patchUser } from "../lib/admin";
import { updateProfile } from "../lib/auth";
import { connectStatus, disconnect, kickLive, saveTwitchConfig, saveKickConfig, startConnect, twitchFollows, type KickLiveChannel } from "../lib/platform";
import { addSource } from "../lib/api";
import { buildExport, PROMPT_TEMPLATES } from "../lib/exportChat";
import { RoomsSettings } from "../room/RoomsSettings";
import { Handbook } from "./Handbook";
import { UserLink } from "../components/UserLink";

/** read an image file, cover-crop + resize to a 96px square JPEG data URL */
function avatarFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const size = 96;
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d")!;
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
import { useHighlights } from "../state/highlights";
import { useMuted } from "../state/muted";
import { useToasts } from "../state/toasts";
import { AddSource } from "../feed/AddSource";
import { TrackAccounts } from "../news/TrackAccounts";

function statusDot(kind: string) {
  return kind === "connected" ? "●" : kind === "connecting" ? "…" : "○";
}

/** shared term-list editor used by Highlights + Muted words */
function TermEditor({
  blurb,
  placeholder,
  cta,
  terms,
  add,
  remove,
}: {
  blurb: string;
  placeholder: string;
  cta: string;
  terms: string[];
  add: (t: string) => void;
  remove: (t: string) => void;
}) {
  const [v, setV] = useState("");
  return (
    <div>
      <p className="cc-empty-sm">{blurb}</p>
      <form
        className="add-source"
        onSubmit={(e) => {
          e.preventDefault();
          add(v);
          setV("");
        }}
      >
        <input placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
        <button type="submit">{cta}</button>
      </form>
      <div className="hl-terms">
        {terms.length === 0 && <span className="cc-empty-sm">None yet.</span>}
        {terms.map((t) => (
          <button key={t} className="hl-chip" onClick={() => remove(t)} title="Remove">
            {t} ✕
          </button>
        ))}
      </div>
    </div>
  );
}

const ACCENTS = [
  { name: "Lime", v: "" },
  { name: "Cyan", v: "#5ad1ff" },
  { name: "Violet", v: "#b18cff" },
  { name: "Pink", v: "#ff8ad1" },
  { name: "Gold", v: "#ffd24a" },
  { name: "Green", v: "#53fc18" },
];

// full color themes (data-theme on <html>); preview colors mirror each palette
const THEMES = [
  { id: "desk", name: "Walnut Desk", hint: "Warm · default", bg: "#17120f", surface: "#2c231d", accent: "#c49a40" },
  { id: "midnight", name: "Midnight", hint: "Cool · after-hours", bg: "#111726", surface: "#25304a", accent: "#4f9be0" },
  { id: "noir", name: "Noir", hint: "Mono · blackout", bg: "#0f0f11", surface: "#232327", accent: "#c2b39a" },
  { id: "paper", name: "Paper", hint: "Light · research note", bg: "#f4f0e6", surface: "#ddd5c2", accent: "#a9781b" },
] as const;

// chat backdrops (data-chatbg on <html>); preview mirrors the CSS in styles.css
const CHAT_BGS = [
  { id: "none", name: "None", hint: "Default", css: "var(--surface)" },
  { id: "dusk", name: "Dusk City", hint: "Purple skyline", css: "linear-gradient(165deg,#3a2456,#15121f)" },
  { id: "studio", name: "Studio", hint: "Warm glow", css: "radial-gradient(130% 90% at 28% -10%, rgba(196,154,64,0.55), #181109)" },
  { id: "midnight", name: "Midnight", hint: "Deep blue", css: "linear-gradient(170deg,#16263f,#080c16)" },
  { id: "aurora", name: "Aurora", hint: "Teal glow", css: "radial-gradient(120% 80% at 80% 0%, rgba(52,165,106,0.55), #0a1310)" },
  { id: "custom", name: "Custom", hint: "Your image", css: "repeating-linear-gradient(45deg,#2c231d,#2c231d 6px,#3a2f26 6px,#3a2f26 12px)" },
] as const;

/** An elegant on/off switch row — label + description on the left, pill switch on the right. */
function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; desc?: ReactNode }) {
  return (
    <button type="button" className="set-toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="set-toggle-txt">
        <span className="set-toggle-label">{label}</span>
        {desc && <span className="set-toggle-desc">{desc}</span>}
      </span>
      <span className={`cc-switch ${on ? "on" : ""}`} />
    </button>
  );
}

function Appearance() {
  const { layout } = useDashboard();
  return (
    <>
      <div className="theme-field">
        <span className="set-label">Theme</span>
        <div className="theme-picker">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-card ${(layout.theme || "desk") === t.id ? "on" : ""}`}
              onClick={() => layout.setTheme(t.id)}
              title={t.name}
            >
              <span className="theme-prev" style={{ background: t.bg }}>
                <span className="theme-prev-s" style={{ background: t.surface }} />
                <span className="theme-prev-a" style={{ background: t.accent }} />
              </span>
              <span className="theme-name">{t.name}</span>
              <span className="theme-hint">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="set-toggles">
        <Toggle
          on={!layout.tickerCollapsed}
          onChange={() => layout.toggleTicker()}
          label="Show market ticker"
          desc="The scrolling price + crowd-sentiment bar under the top bar."
        />
        <Toggle
          on={layout.loginBrief}
          onChange={layout.setLoginBrief}
          label="Show the daily brief on login"
          desc="A market read + streamer pulse, shown once when you sign in."
        />
      </div>
      <div className="set-row">
        <span className="set-label">Accent color</span>
        <div className="accent-swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.name}
              className={`swatch ${(layout.accent || "") === a.v ? "on" : ""}`}
              style={{ background: a.v || "var(--accent)" }}
              title={a.name}
              onClick={() => layout.setAccent(a.v)}
            />
          ))}
        </div>
      </div>
      <div className="set-row">
        <span className="set-label">
          Chat density <span className="set-sub">— Compact tightens chat rows to fit more messages on screen</span>
        </span>
        <div className="range-toggle">
          <button className={layout.density === "comfortable" ? "active" : ""} onClick={() => layout.setDensity("comfortable")}>
            Comfortable
          </button>
          <button className={layout.density === "compact" ? "active" : ""} onClick={() => layout.setDensity("compact")}>
            Compact
          </button>
        </div>
      </div>
      <div className="theme-field">
        <span className="set-label">
          Chat background <span className="set-sub">— A vibe behind the live feed. Pick a preset or drop your own image.</span>
        </span>
        <div className="theme-picker">
          {CHAT_BGS.map((b) => (
            <button
              key={b.id}
              className={`theme-card ${(layout.chatBg || "none") === b.id ? "on" : ""}`}
              onClick={() => layout.setChatBg(b.id)}
              title={b.name}
            >
              <span className="theme-prev" style={{ background: b.css }} />
              <span className="theme-name">{b.name}</span>
              <span className="theme-hint">{b.hint}</span>
            </button>
          ))}
        </div>
        {layout.chatBg === "custom" && (
          <input
            className="pf-in"
            style={{ marginTop: 10 }}
            placeholder="https://…/your-background.jpg"
            value={layout.chatBgUrl}
            onChange={(e) => layout.setChatBgUrl(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
      <p className="cc-empty-sm" style={{ marginTop: 8 }}>
        Press <b>⌘K</b> / <b>Ctrl-K</b> anywhere for the command palette.
      </p>
    </>
  );
}

const SIGMAS = [2, 2.5, 3];
const VIEW_LABELS: Record<string, string> = {
  live: "Live",
  rooms: "Rooms",
  markets: "Markets",
  portfolio: "Portfolio",
  checklist: "Run of Show",
  show: "Show Planning",
  trends: "Trends",
  feed: "X Feed",
  assistant: "Assistant",
  analytics: "Analytics",
  settings: "Settings",
};

function Notifications() {
  const { layout } = useDashboard();
  const { push } = useToasts();
  const supported = typeof Notification !== "undefined";
  const [perm, setPerm] = useState<NotificationPermission>(supported ? Notification.permission : "denied");
  const ensure = async (): Promise<NotificationPermission> => {
    if (!supported) return "denied";
    let p = Notification.permission;
    if (p === "default") p = await Notification.requestPermission();
    setPerm(p);
    return p;
  };
  const test = async () => {
    push({ title: "🔔 Test alert", body: "Alerts are working — they'll show right here.", kind: "info" });
    if (supported && (await ensure()) === "granted") {
      try {
        new Notification("Market Bubble", { body: "Test desktop notification ✓" });
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <>
      <p className="cc-empty-sm">
        Alerts appear as in-app toasts (always visible) — and as desktop notifications too when your browser/OS allows.
      </p>
      <div className="set-toggles">
        <Toggle
          on={layout.notify}
          onChange={(v) => {
            layout.setNotify(v);
            if (v) void ensure();
          }}
          label="Highlight matches"
          desc="When chat hits one of your highlight terms (from the Word filters tab)."
        />
        <Toggle
          on={layout.priceAlerts}
          onChange={(v) => {
            layout.setPriceAlerts(v);
            if (v) void ensure();
          }}
          label="Price moves"
          desc="When an asset moves past N σ vs the last hour."
        />
        {layout.priceAlerts && (
          <div className="set-subrow">
            <span className="set-label">
              Sensitivity <span className="set-sub">— lower σ = more alerts</span>
            </span>
            <div className="range-toggle">
              {SIGMAS.map((s) => (
                <button key={s} className={layout.priceSigma === s ? "active" : ""} onClick={() => layout.setPriceSigma(s)}>
                  {s}σ
                </button>
              ))}
            </div>
          </div>
        )}
        <Toggle
          on={layout.roomNotify}
          onChange={(v) => {
            layout.setRoomNotify(v);
            if (v) void ensure();
          }}
          label="Market Bubble room messages"
          desc="New messages in rooms you’re not currently focused on."
        />
      </div>
      <div className="npages">
        <div className="npages-head">
          <b>Pop-ups by page</b>
          <span className="set-sub">
            Pick which pages still flash a pop-up for each alert. Switched-off pages stay quiet — the alert is still
            saved to the Notifications panel either way.
          </span>
        </div>
        <div className="npages-grid" style={{ gridTemplateColumns: `minmax(120px,1.2fr) repeat(${NOTIF_VIEWS.length}, 1fr)` }}>
          <div className="npages-corner" />
          {NOTIF_VIEWS.map((v) => (
            <div key={v} className="npages-col">
              {VIEW_LABELS[v] ?? v}
            </div>
          ))}
          {NOTIF_TYPES.map((t) => {
            const on = layout.notifyPages[t.id] ?? [...NOTIF_VIEWS];
            return (
              <div key={t.id} className="npages-row" style={{ display: "contents" }}>
                <div className="npages-type">{t.label}</div>
                {NOTIF_VIEWS.map((v) => {
                  const active = on.includes(v);
                  return (
                    <button
                      key={v}
                      className={`npages-cell ${active ? "on" : ""}`}
                      onClick={() => layout.toggleNotifyPage(t.id, v)}
                      title={`${t.label} pop-ups on ${VIEW_LABELS[v] ?? v}: ${active ? "on" : "off"}`}
                      aria-pressed={active}
                    >
                      {active ? "✓" : ""}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="set-actions">
        <button className="cc-chip" onClick={test}>
          Send test alert
        </button>
        <span className="set-sub">desktop: {!supported ? "unsupported" : perm}</span>
      </div>
      <p className="cc-empty-sm" style={{ marginTop: 8 }}>
        Lower σ = more alerts. <b>2σ</b> ≈ a notable move, <b>3σ</b> ≈ a rare, sharp move.
        {perm === "denied" && " Desktop notifications are blocked in your browser, but in-app toasts still work."}
      </p>
    </>
  );
}

function AccountData() {
  const { user, setUser } = useAuth();
  const d = useDashboard();
  const [name, setName] = useState(user?.displayName ?? "");
  const [color, setColor] = useState(user?.color ?? "#c49a40");
  const [avatar, setAvatar] = useState(user?.avatarUrl ?? "");
  const [welcome, setWelcome] = useState(user?.welcomeTitle ?? "");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (user) {
      setName(user.displayName);
      setColor(user.color);
      setAvatar(user.avatarUrl ?? "");
      setWelcome(user.welcomeTitle ?? "");
    }
  }, [user?.id]);
  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 2200);
  };
  const dirty =
    !!user &&
    (name !== user.displayName ||
      color !== user.color ||
      avatar !== (user.avatarUrl ?? "") ||
      welcome !== (user.welcomeTitle ?? ""));
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setAvatar(await avatarFromFile(f));
    } catch {
      flash("Couldn’t read that image.");
    }
  };
  const save = async () => {
    try {
      const u = await updateProfile({ displayName: name, color, avatarUrl: avatar, welcomeTitle: welcome });
      if (u) {
        setUser(u);
        flash("Profile saved.");
      }
    } catch (err) {
      flash((err as Error).message || "Save failed.");
    }
  };

  return (
    <>
      {user && (
        <div className="prof-edit">
          <div className="prof-avatar">
            {avatar ? (
              <img src={avatar} alt="" />
            ) : (
              <span className="prof-initials" style={{ background: color, color: "var(--on-accent)" }}>
                {(name || user.handle).slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="prof-fields">
            <div className="prof-name-row">
              <input value={name} maxLength={24} placeholder="display name" onChange={(e) => setName(e.target.value)} />
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="chat color" />
            </div>
            <div className="prof-name-row">
              <input
                value={welcome}
                maxLength={80}
                placeholder="login greeting — e.g. the oldest one breathing"
                onChange={(e) => setWelcome(e.target.value)}
              />
            </div>
            <div className="set-sub">
              @{user.handle} · role {user.role} · shows as “Welcome {welcome.trim() || name || user.handle}” on login
            </div>
            <div className="set-actions">
              <label className="cc-chip">
                Upload avatar
                <input type="file" accept="image/*" hidden onChange={onFile} />
              </label>
              {avatar && (
                <button className="cc-chip" onClick={() => setAvatar("")}>
                  Remove
                </button>
              )}
              <button className="cc-chip active" disabled={!dirty} onClick={save}>
                Save profile
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="set-actions" style={{ marginTop: 14 }}>
        <button
          className="cc-chip"
          onClick={() => {
            d.store.clear();
            flash("Saved messages cleared.");
          }}
        >
          Clear saved messages ({d.store.items.length})
        </button>
        <button
          className="cc-chip"
          onClick={() => {
            d.layout.reset();
            flash("Preferences reset.");
          }}
        >
          Reset preferences
        </button>
      </div>
      {msg && <span className="cc-empty-sm">{msg}</span>}
    </>
  );
}

const MOD_PLATFORMS = [
  {
    id: "twitch",
    name: "Twitch",
    note: "Connects via Twitch OAuth + the Helix moderation API.",
    consoleUrl: "https://dev.twitch.tv/console/apps/create",
    ops: ["Timeout / ban users", "Delete messages", "Slow · followers-only · sub-only · emote-only", "Clear chat"],
  },
  {
    id: "kick",
    name: "Kick",
    note: "Connects via Kick's official API (OAuth 2.1 + PKCE). Posting, timeout/ban, and message delete.",
    consoleUrl: "https://dev.kick.com",
    ops: ["Post & reply as you", "Timeout / ban users", "Delete messages"],
  },
];

/** Admin-only, one-time: register MB's platform app + paste its Client ID/Secret.
 * This is the shared "app" — every user then connects their OWN account through it.
 * Works for both Twitch and Kick (same shape; different console + save endpoint). */
function AppSetup({
  platform,
  name,
  consoleUrl,
  redirectUri,
  onSaved,
}: {
  platform: PlatformId;
  name: string;
  consoleUrl: string;
  redirectUri?: string;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [redirect, setRedirect] = useState(redirectUri || `http://localhost:8787/api/connect/${platform}/callback`);
  const save = async () => {
    setBusy(true);
    setErr(null);
    const fn = platform === "kick" ? saveKickConfig : saveTwitchConfig;
    const r = await fn(clientId.trim(), clientSecret.trim(), redirect.trim());
    setBusy(false);
    if (r.ok) onSaved();
    else setErr(r.error || "couldn't save");
  };
  const copy = () => {
    navigator.clipboard?.writeText(redirect);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="conn-setup">
      <p className="cc-empty-sm">
        <b>1.</b> Open the{" "}
        <a href={consoleUrl} target="_blank" rel="noreferrer">
          {name} developer console ↗
        </a>{" "}
        and register an app.
      </p>
      <p className="cc-empty-sm">
        <b>2.</b> Set its <b>OAuth Redirect URL</b> to this exact value (HTTPS required —{" "}
        <code>http://localhost</code> is the only http allowed). Edit it if you serve MB from a domain or tunnel:
      </p>
      <div className="conn-redirect">
        <input className="pf-in" value={redirect} onChange={(e) => setRedirect(e.target.value)} spellCheck={false} />
        <button className="cc-chip sm" onClick={copy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <p className="cc-empty-sm">
        <b>3.</b> Paste the app's Client ID + Secret here (stored on the server, never shown again):
      </p>
      <div className="conn-form">
        <input className="pf-in" placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <input
          className="pf-in"
          type="password"
          placeholder="Client Secret"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
        <button className="cc-chip accent" disabled={busy || !clientId.trim() || !clientSecret.trim()} onClick={save}>
          {busy ? "Saving…" : "Save & enable"}
        </button>
      </div>
      {err && <div className="conn-info">{err}</div>}
    </div>
  );
}

function Connections() {
  const [params, setParams] = useSearchParams();
  const platform = usePlatform();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = () => connectStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  // returning from the OAuth round-trip → flash + refresh the linked state
  useEffect(() => {
    const ok = params.get("connected");
    const err = params.get("connect_error");
    if (ok) {
      setFlash(`✓ Connected ${ok}.`);
      load();
      platform.refresh();
    } else if (err) {
      setFlash(`Connection failed: ${err}`);
    }
    if (ok || err) {
      params.delete("connected");
      params.delete("connect_error");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConnect = async (id: PlatformId) => {
    setBusy(id);
    try {
      await startConnect(id); // navigates away on success
    } catch (e) {
      setFlash(String((e as Error).message));
      setBusy(null);
    }
  };
  const onDisconnect = async (id: PlatformId) => {
    setBusy(id);
    await disconnect(id);
    await load();
    platform.refresh();
    setBusy(null);
  };

  return (
    <>
      <p className="cc-empty-sm">
        Connect your accounts to act on chat — <b>post, reply, timeout, ban, delete</b> — using your own account, without
        leaving Market Bubble.
      </p>
      {flash && <div className="conn-info">{flash}</div>}
      {MOD_PLATFORMS.map((p) => {
        const id = p.id as PlatformId;
        const s = status?.[id];
        return (
          <div className={`conn-card ${s?.linked ? "linked" : ""}`} key={p.id}>
            <div className="conn-row">
              <span className={`pill ${p.id}`}>{p.name}</span>
              {s?.linked ? (
                <>
                  <span className="conn-status ok">Connected{s.login ? ` · ${s.login}` : ""}</span>
                  <button className="cc-chip" disabled={busy === id} onClick={() => onDisconnect(id)}>
                    Disconnect
                  </button>
                </>
              ) : !s?.configured ? (
                <span className="conn-status">Needs server setup</span>
              ) : (
                <>
                  <span className="conn-status">Not connected</span>
                  <button className="cc-chip accent" disabled={busy === id} onClick={() => onConnect(id)}>
                    Connect {p.name}
                  </button>
                </>
              )}
            </div>
            <ul className="conn-ops">
              {p.ops.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            {s?.configured ? (
              <div className="conn-note">{p.note}</div>
            ) : isAdmin ? (
              <AppSetup
                platform={id}
                name={p.name}
                consoleUrl={p.consoleUrl}
                redirectUri={s?.redirectUri}
                onSaved={() => {
                  setFlash(`✓ ${p.name} app saved — now click Connect ${p.name}.`);
                  load();
                  platform.refresh();
                }}
              />
            ) : (
              <div className="conn-note">Ask an admin to set up the {p.name} app in Settings → Connections.</div>
            )}
          </div>
        );
      })}
      <p className="cc-empty-sm" style={{ marginTop: 8 }}>
        Your token is stored securely on the server and never sent back to the browser. Mod actions appear on each
        message for channels you can moderate. X broadcasts have no mod API, so they stay view-only.
      </p>
    </>
  );
}

const EXPORT_PLATS: { id: Platform; label: string }[] = [
  { id: "twitch", label: "Twitch" },
  { id: "kick", label: "Kick" },
  { id: "x", label: "X" },
  { id: "mb", label: "MB rooms" },
];
const EXPORT_RANGES = [
  { ms: 0, label: "All buffered" },
  { ms: 3_600_000, label: "Last 1h" },
  { ms: 900_000, label: "Last 15m" },
];

function ExportPanel() {
  const d = useDashboard();
  const [layout, setLayout] = useState<"unified" | "by-channel">("unified");
  const [format, setFormat] = useState<"text" | "markdown" | "json">("markdown");
  const [platforms, setPlatforms] = useState<Platform[]>(["twitch", "kick", "x", "mb"]);
  const [timestamps, setTimestamps] = useState(true);
  const [anonymize, setAnonymize] = useState(false);
  const [promptId, setPromptId] = useState("overview");
  const [sinceMs, setSinceMs] = useState(0);
  const [copied, setCopied] = useState(false);

  const togglePlat = (p: Platform) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const out = useMemo(
    () => buildExport(d.messages, { layout, platforms, format, timestamps, anonymize, promptId: format === "json" ? "none" : promptId, sinceMs }),
    [d.messages, layout, platforms, format, timestamps, anonymize, promptId, sinceMs],
  );
  const ext = format === "json" ? "json" : format === "markdown" ? "md" : "txt";
  const kb = (new Blob([out]).size / 1024).toFixed(1);
  const preview = out.length > 20000 ? out.slice(0, 20000) + "\n…" : out;

  const download = () => {
    const blob = new Blob([out], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `marketbubble-chat-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(out);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <p className="cc-empty-sm">
        Export the session chat as a clean transcript to feed into an AI for analysis — sentiment, topics, notable
        moments. Exports from the live buffer ({d.messages.length.toLocaleString()} messages).
      </p>
      <div className="set-row">
        <span className="set-label">Channels</span>
        <div className="exp-checks">
          {EXPORT_PLATS.map((p) => (
            <label key={p.id} className="exp-check">
              <input type="checkbox" checked={platforms.includes(p.id)} onChange={() => togglePlat(p.id)} /> {p.label}
            </label>
          ))}
        </div>
      </div>
      <div className="set-row">
        <span className="set-label">Layout</span>
        <div className="range-toggle">
          <button className={layout === "unified" ? "active" : ""} onClick={() => setLayout("unified")}>Unified</button>
          <button className={layout === "by-channel" ? "active" : ""} onClick={() => setLayout("by-channel")}>By channel</button>
        </div>
      </div>
      <div className="set-row">
        <span className="set-label">Format</span>
        <div className="range-toggle">
          {(["text", "markdown", "json"] as const).map((f) => (
            <button key={f} className={format === f ? "active" : ""} onClick={() => setFormat(f)}>
              {f === "text" ? "Text" : f === "markdown" ? "Markdown" : "JSON"}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <span className="set-label">Range</span>
        <div className="range-toggle">
          {EXPORT_RANGES.map((r) => (
            <button key={r.ms} className={sinceMs === r.ms ? "active" : ""} onClick={() => setSinceMs(r.ms)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="set-toggles">
        <Toggle on={timestamps} onChange={setTimestamps} label="Include timestamps" desc="Prefix each line with its clock time." />
        <Toggle
          on={anonymize}
          onChange={setAnonymize}
          label="Anonymize chatters"
          desc="Replace names with User1, User2… before exporting."
        />
      </div>
      <div className="set-row">
        <span className="set-label">AI prompt</span>
        <select
          className="set-select"
          value={format === "json" ? "none" : promptId}
          disabled={format === "json"}
          onChange={(e) => setPromptId(e.target.value)}
        >
          {PROMPT_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="set-actions">
        <button className="cc-chip active" onClick={download}>⤓ Download .{ext}</button>
        <button className="cc-chip" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
        <span className="set-sub">{kb} KB</span>
      </div>
      <textarea className="exp-preview" readOnly value={preview} placeholder="Nothing to export for these filters." />
    </>
  );
}

const ROLES: Role[] = ["user", "mod", "admin"];

function AdminPanel() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState<{ handle: string; displayName: string; password: string; role: Role }>({
    handle: "",
    displayName: "",
    password: "",
    role: "user",
  });
  const [msg, setMsg] = useState("");
  const refresh = () => fetchUsers().then(setUsers);
  useEffect(() => {
    refresh();
  }, []);
  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 2500);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await createUser(form.handle, form.password, form.displayName, form.role);
    if (!r.ok) return flash(r.error || "failed");
    setForm({ handle: "", displayName: "", password: "", role: "user" });
    flash("Account created.");
    refresh();
  };
  const changeRole = async (h: string, role: Role) => {
    const r = await patchUser(h, { role });
    if (!r.ok) flash(r.error || "failed");
    refresh();
  };
  const resetPw = async (h: string) => {
    const pw = window.prompt(`New password for @${h} (min 6 chars):`);
    if (!pw) return;
    const r = await patchUser(h, { password: pw });
    flash(r.ok ? `Password reset for @${h}.` : r.error || "failed");
  };
  const del = async (h: string) => {
    if (!window.confirm(`Delete @${h}? This can't be undone.`)) return;
    const r = await deleteUser(h);
    if (!r.ok) flash(r.error || "failed");
    refresh();
  };
  const when = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

  return (
    <>
      <p className="cc-empty-sm">
        Create accounts, set roles, reset passwords. <b>Roles</b>: <b>admin</b> (everything incl. this page),{" "}
        <b>mod</b> (recording control + moderation), <b>user</b> (view + chat).
      </p>
      <form className="add-source admin-create" onSubmit={create}>
        <input placeholder="handle" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
        <input placeholder="display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        <input type="password" placeholder="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className="set-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="submit">+ Create</button>
      </form>
      {msg && <div className="ctrl-err">{msg}</div>}
      <table className="cmp-table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                <span style={{ color: u.color, fontWeight: 700 }}>{u.displayName}</span>{" "}
                <span className="set-sub">@{u.handle}</span>
                {user?.handle === u.handle && <span className="spick-tag" style={{ marginLeft: 6 }}>you</span>}
              </td>
              <td>
                <select className="set-select" value={u.role} onChange={(e) => changeRole(u.handle, e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td>{when(u.createdAt)}</td>
              <td>
                <button className="cc-chip sm" onClick={() => resetPw(u.handle)}>
                  Reset password
                </button>{" "}
                {user?.handle !== u.handle && (
                  <button className="cc-chip sm" onClick={() => del(u.handle)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Add channels straight from the linked user's Twitch follows (live-first). */
function TwitchFollows() {
  const d = useDashboard();
  const { twitchLinked } = usePlatform();
  const [follows, setFollows] = useState<TwitchFollow[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    if (!twitchLinked) return;
    setFollows(null);
    twitchFollows().then((r) => {
      if (r.ok) {
        setFollows(r.follows ?? []);
        setMsg(null);
      } else {
        setFollows([]);
        setMsg(r.reconnect ? "Reconnect Twitch in Connections to grant the “read follows” permission." : r.error ?? "couldn't load follows");
      }
    });
  };
  useEffect(load, [twitchLinked]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!twitchLinked) return null;
  const have = new Set(d.connectors.filter((c) => c.platform === "twitch").map((c) => c.id.replace(/^twitch:#?/, "").toLowerCase()));
  const add = async (login: string) => {
    setBusy(login);
    try {
      await addSource("twitch", login);
    } catch {
      /* the channel list updates over the socket; failures stay silent */
    }
    setBusy(null);
  };

  return (
    <section className="scard">
      <div className="acard-h">
        <h3>From your Twitch follows</h3>
        <button className="cc-chip sm" onClick={load} title="Refresh">
          ↻
        </button>
      </div>
      {msg && <div className="conn-info">{msg}</div>}
      {follows === null && !msg && <div className="cc-empty-sm">Loading your follows…</div>}
      {follows && follows.length === 0 && !msg && <div className="cc-empty-sm">No followed channels found.</div>}
      <div className="follows-grid">
        {(follows ?? []).map((f) => {
          const added = have.has(f.login.toLowerCase());
          return (
            <div className="follow-row" key={f.login}>
              <UserLink platform="twitch" username={f.login} kind="streamer" name={f.name} className="follow-name" />
              {f.live && <span className="follow-live">● LIVE</span>}
              {added ? (
                <span className="follow-added">✓ Added</span>
              ) : (
                <button className="cc-chip sm accent" disabled={busy === f.login} onClick={() => add(f.login)}>
                  + Add
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Kick has no "your follows" API — so add from who's LIVE on Kick right now (official). */
function KickLive() {
  const d = useDashboard();
  const { status } = usePlatform();
  const configured = !!status?.kick?.configured;
  const [channels, setChannels] = useState<KickLiveChannel[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    if (!configured) return;
    setChannels(null);
    kickLive().then((r) => {
      if (r.ok) {
        setChannels(r.channels ?? []);
        setMsg(null);
      } else {
        setChannels([]);
        setMsg(r.error ?? "couldn't load live channels");
      }
    });
  };
  useEffect(load, [configured]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!configured) return null;
  const have = new Set(d.connectors.filter((c) => c.platform === "kick").map((c) => c.id.replace(/^kick:#?/, "").toLowerCase()));
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  const add = async (slug: string) => {
    setBusy(slug);
    try {
      await addSource("kick", slug);
    } catch {
      /* the channel list updates over the socket; failures stay silent */
    }
    setBusy(null);
  };

  return (
    <section className="scard">
      <div className="acard-h">
        <h3>Live on Kick now</h3>
        <button className="cc-chip sm" onClick={load} title="Refresh">
          ↻
        </button>
      </div>
      <p className="cc-empty-sm">Kick's API doesn't expose your follows — here's who's live right now, by viewers.</p>
      {msg && <div className="conn-info">{msg}</div>}
      {channels === null && !msg && <div className="cc-empty-sm">Loading live channels…</div>}
      {channels && channels.length === 0 && !msg && <div className="cc-empty-sm">No live channels found.</div>}
      <div className="follows-grid">
        {(channels ?? []).map((c) => {
          const added = have.has(c.slug.toLowerCase());
          return (
            <div className="follow-row" key={c.slug}>
              <span className="follow-name" title={c.title || c.slug}>
                {c.slug}
              </span>
              <span className="follow-live">● {fmt(c.viewers)}</span>
              {added ? (
                <span className="follow-added">✓ Added</span>
              ) : (
                <button className="cc-chip sm accent" disabled={busy === c.slug} onClick={() => add(c.slug)}>
                  + Add
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: "◐", hint: "Theme · density" },
  { id: "notifications", label: "Notifications", icon: "◔", hint: "Desktop alerts" },
  { id: "filters", label: "Word filters", icon: "⚑", hint: "Highlight · mute" },
  { id: "export", label: "Export chat", icon: "⇪", hint: "AI-ready transcript" },
  { id: "streams", label: "Streams", icon: "▦", hint: "Twitch · Kick · X" },
  { id: "connections", label: "Connections", icon: "⚡", hint: "Mod accounts" },
  { id: "tracked", label: "Tracked X", icon: "✦", hint: "News accounts" },
  { id: "rooms", label: "Rooms", icon: "#", hint: "Chat rooms" },
  { id: "account", label: "Account & data", icon: "⚙", hint: "Profile · reset" },
] as const;
type SectionId = string;

export function SettingsView() {
  const d = useDashboard();
  const { user } = useAuth();
  const highlights = useHighlights();
  const muted = useMuted();
  const [active, setActive] = useState<SectionId>("appearance");
  // real streams only — exclude MB rooms and the tracked-X news accounts (xnews:*),
  // which aren't streams and live under the "Tracked X" section
  const sources = d.connectors.filter((c) => c.platform !== "mb" && !c.id.startsWith("xnews:"));
  const isAdmin = user?.role === "admin";
  const isStaff = isAdmin || user?.role === "mod";
  // mods/admins get the team handbook; admins also get the accounts panel
  const sections = [
    ...SECTIONS,
    ...(isStaff ? [{ id: "handbook", label: "Handbook", icon: "❡", hint: "How the show runs" }] : []),
    ...(isAdmin ? [{ id: "admin", label: "Admin", icon: "★", hint: "Accounts · roles" }] : []),
  ];

  return (
    <div className="asection">
      <nav className="asub">
        <div className="asub-title">Settings</div>
        {sections.map((s) => (
          <button key={s.id} className={`asub-item ${active === s.id ? "active" : ""}`} onClick={() => setActive(s.id)}>
            <span className="asub-ico">{s.icon}</span>
            <span className="asub-lbl">{s.label}</span>
            <span className="asub-hint">{s.hint}</span>
          </button>
        ))}
      </nav>

      <div className="asection-body">
        {active === "handbook" && isStaff ? (
          <Handbook />
        ) : (
        <div className="spane">
          {active === "appearance" && (
            <section className="scard">
              <h3>Appearance</h3>
              <Appearance />
            </section>
          )}

          {active === "notifications" && (
            <section className="scard">
              <h3>Notifications</h3>
              <Notifications />
            </section>
          )}

          {active === "filters" && (
            <>
              <section className="scard">
                <h3>Highlights</h3>
                <TermEditor
                  blurb="Messages containing these words glow in the feed (and can trigger notifications)."
                  placeholder="term (e.g. $BTC, raid, ansem)"
                  cta="+ Highlight"
                  terms={highlights.terms}
                  add={highlights.add}
                  remove={highlights.remove}
                />
              </section>
              <section className="scard">
                <h3>Muted words</h3>
                <TermEditor
                  blurb="Messages containing these words are hidden from the feed (Unified + Columns)."
                  placeholder="word to mute"
                  cta="+ Mute"
                  terms={muted.terms}
                  add={muted.add}
                  remove={muted.remove}
                />
              </section>
            </>
          )}

          {active === "streams" && (
            <>
            <section className="scard">
              <h3>Streams</h3>
              <p className="cc-empty-sm">Add a Twitch / Kick channel or an X live-broadcast link. Paste a URL or a handle.</p>
              <AddSource />
              <div className="cc-src-list big">
                {sources.length === 0 && <div className="cc-empty-sm">No streams yet.</div>}
                {sources.map((c) => (
                  <div className="cc-src" key={c.id}>
                    <span className={`src-dot ${c.status.kind}`}>{statusDot(c.status.kind)}</span>
                    <span className="cc-src-plat">{c.platform}</span>
                    <span className="cc-src-label">{c.label}</span>
                    <span className="cc-src-status">{c.status.kind}</span>
                    <button className="cc-src-x text" onClick={() => d.onRemoveSource(c.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <TwitchFollows />
            <KickLive />
            </>
          )}

          {active === "export" && (
            <section className="scard">
              <h3>Export chat</h3>
              <ExportPanel />
            </section>
          )}

          {active === "connections" && (
            <section className="scard">
              <h3>Connections</h3>
              <Connections />
            </section>
          )}

          {active === "tracked" && (
            <section className="scard">
              <h3>Tracked X accounts</h3>
              <p className="cc-empty-sm">
                Follow X accounts as live news (via Nitter), filed into your own categories. Posts appear in the News
                rail and the feed.
              </p>
              <TrackAccounts />
            </section>
          )}

          {active === "rooms" && (
            <section className="scard">
              <h3>Rooms</h3>
              <RoomsSettings />
            </section>
          )}

          {active === "account" && (
            <section className="scard">
              <h3>Account &amp; data</h3>
              <AccountData />
            </section>
          )}

          {active === "admin" && isAdmin && (
            <section className="scard">
              <h3>Admin · accounts</h3>
              <AdminPanel />
            </section>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
