import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

export interface AssistantMsg {
  role: "user" | "assistant";
  content: string;
}

export async function assistantStatus(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/assistant/status`);
    return !!(await r.json()).configured;
  } catch {
    return false;
  }
}

export interface AssistantProvider {
  id: string;
  label: string;
  model: string;
  configured: boolean;
  needsKey: boolean;
}

/** The AI providers the server knows about + whether each is configured/reachable. */
export async function listAssistantProviders(): Promise<AssistantProvider[]> {
  try {
    const r = await fetch(`${API}/api/assistant/providers`);
    return (await r.json()).providers ?? [];
  } catch {
    return [];
  }
}

export interface AssistantTool {
  name: string;
  label: string;
  description: string;
}

/** Live-data tools the assistant can call (the user controls which are enabled).
 * Sends the auth token — the data tools are mod/admin-gated server-side. */
export async function listAssistantTools(): Promise<AssistantTool[]> {
  try {
    const t = getToken();
    const r = await fetch(`${API}/api/assistant/tools`, {
      headers: t ? { authorization: `Bearer ${t}` } : {},
    });
    return (await r.json()).tools ?? [];
  } catch {
    return [];
  }
}

/** Stream a reply token-by-token via SSE. Calls onToken for each chunk and resolves
 * with whether the server was in mock mode. Pass a signal to support a Stop button. */
export async function streamAssistant(
  messages: AssistantMsg[],
  opts: { onToken: (t: string) => void; signal?: AbortSignal; provider?: string; tools?: string[]; maxMessages?: number },
): Promise<{ mock: boolean }> {
  const t = getToken();
  const r = await fetch(`${API}/api/assistant/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify({ messages, provider: opts.provider, tools: opts.tools, maxMessages: opts.maxMessages }),
    signal: opts.signal,
  });
  if (!r.ok || !r.body) throw new Error(`assistant ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let mock = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? ""; // keep trailing partial frame
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let j: any;
      try {
        j = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (j.error) throw new Error("assistant stream error");
      if (typeof j.t === "string") opts.onToken(j.t);
      else if (j.done) mock = !!j.mock;
    }
  }
  return { mock };
}

export async function askAssistant(messages: AssistantMsg[], provider?: string): Promise<{ reply: string; mock: boolean }> {
  const t = getToken();
  const r = await fetch(`${API}/api/assistant`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify({ messages, provider }),
  });
  if (!r.ok) throw new Error(`assistant ${r.status}`);
  return await r.json();
}
