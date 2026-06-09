import { useState } from "react";
import type { Platform } from "@app/shared";
import { addSource } from "../lib/api";

const PLACEHOLDER: Record<Platform, string> = {
  twitch: "Twitch link or username (e.g. fazebanks)",
  kick: "Kick link or username (e.g. ansem)",
  x: "X broadcast link (x.com/i/broadcasts/…)",
  mb: "", // native room — not addable here
};

function detectPlatform(v: string): Platform | null {
  if (/kick\.com\//i.test(v)) return "kick";
  if (/twitch\.tv\//i.test(v)) return "twitch";
  if (/(?:x|twitter)\.com\/i\/broadcasts\//i.test(v)) return "x";
  return null;
}

export function AddSource() {
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await addSource(platform, value.trim(), label.trim() || undefined);
      setValue("");
      setLabel("");
    } catch (e: any) {
      setErr(e?.message ?? "failed to add");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="add-source" onSubmit={submit}>
      <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
        <option value="twitch">Twitch</option>
        <option value="kick">Kick</option>
        <option value="x">X</option>
      </select>
      <input
        placeholder={PLACEHOLDER[platform]}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          const detected = detectPlatform(v);
          if (detected) setPlatform(detected);
        }}
      />
      {platform === "x" && (
        <input
          className="label-in"
          placeholder="label (e.g. Ansem Twitter)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      )}
      <button type="submit" disabled={busy}>
        {busy ? "…" : "+ Add"}
      </button>
      {err && <span className="add-err" title={err}>{err}</span>}
    </form>
  );
}
