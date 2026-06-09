import { logger } from "../observability/logger.js";

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ProviderId = "local" | "venice" | "openai" | "anthropic";

interface Provider {
  id: ProviderId;
  label: string;
  /** wire format: OpenAI-compatible (Venice/OpenAI/Ollama) or Anthropic messages */
  kind: "openai" | "anthropic";
  base: string;
  model: string;
  apiKey?: string;
  /** local (Ollama) needs no key; the hosted providers do */
  needsKey: boolean;
}

/** Provider registry — resolved fresh each call so env (or future runtime config) is honored. */
function registry(): Record<ProviderId, Provider> {
  return {
    local: {
      id: "local",
      label: "Local (Ollama)",
      kind: "openai",
      base: process.env.OLLAMA_BASE || "http://localhost:11434/v1",
      model: process.env.OLLAMA_MODEL || "llama3.2",
      needsKey: false,
    },
    venice: {
      id: "venice",
      label: "Venice",
      kind: "openai",
      base: process.env.VENICE_BASE || "https://api.venice.ai/api/v1",
      model: process.env.VENICE_MODEL || "llama-3.3-70b",
      apiKey: process.env.VENICE_API_KEY,
      needsKey: true,
    },
    openai: {
      id: "openai",
      label: "OpenAI (GPT)",
      kind: "openai",
      base: process.env.OPENAI_BASE || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      apiKey: process.env.OPENAI_API_KEY,
      needsKey: true,
    },
    anthropic: {
      id: "anthropic",
      label: "Anthropic (Claude)",
      kind: "anthropic",
      base: process.env.ANTHROPIC_BASE || "https://api.anthropic.com/v1",
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
      apiKey: process.env.ANTHROPIC_API_KEY,
      needsKey: true,
    },
  };
}

/** Preference order when no provider is explicitly requested. */
const ORDER: ProviderId[] = ["venice", "openai", "anthropic", "local"];

/** A keyed provider is usable iff its key is set; local is always "usable" (it
 * errors clearly at call time if the Ollama daemon isn't running). */
function usable(p: Provider): boolean {
  return p.needsKey ? !!p.apiKey : true;
}

/** Honor an explicit provider id; otherwise default to the first configured keyed
 * provider, falling back to local so the assistant still works with Ollama. */
function resolve(id?: string): Provider {
  const reg = registry();
  if (id && (id as ProviderId) in reg) return reg[id as ProviderId];
  for (const k of ORDER) if (reg[k].needsKey && usable(reg[k])) return reg[k];
  return reg.local;
}

/** Whether the resolved provider can produce a real (non-mock) answer. */
export function llmConfigured(id?: string): boolean {
  const reg = registry();
  if (id && (id as ProviderId) in reg) return usable(reg[id as ProviderId]);
  return ORDER.some((k) => reg[k].needsKey && usable(reg[k]));
}

/** Provider list for the settings picker — which are configured + their model. The
 * local (Ollama) daemon is pinged so the UI can show whether it's actually running. */
export async function listProviders(): Promise<
  { id: ProviderId; label: string; model: string; configured: boolean; needsKey: boolean }[]
> {
  const reg = registry();
  const localUp = await ollamaReachable(reg.local.base);
  const localM = localUp ? await localModel(reg.local.base) : reg.local.model;
  return (Object.keys(reg) as ProviderId[]).map((id) => {
    const p = reg[id];
    return {
      id,
      label: p.label,
      model: id === "local" ? localM : p.model,
      needsKey: p.needsKey,
      configured: p.needsKey ? !!p.apiKey : localUp,
    };
  });
}

async function ollamaReachable(base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

let _localModel: { at: number; model: string } | null = null;
/** The model to use for local (Ollama): explicit OLLAMA_MODEL, else the first model
 * the daemon actually has pulled — so we never POST an absent model (which 404s). */
async function localModel(base: string): Promise<string> {
  if (process.env.OLLAMA_MODEL) return process.env.OLLAMA_MODEL;
  if (_localModel && Date.now() - _localModel.at < 30_000) return _localModel.model;
  try {
    const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(2000) });
    const j = (await r.json()) as any;
    const ids: string[] = (j?.data ?? []).map((m: any) => m?.id).filter(Boolean);
    // prefer a recognizable general chat model over embedding/specialty models
    const chatish = /llama|qwen|mistral|mixtral|gemma|phi|deepseek|command-r|hermes|gpt-oss/i;
    const model = ids.find((id) => chatish.test(id)) || ids[0] || "llama3.2";
    _localModel = { at: Date.now(), model };
    return model;
  } catch {
    return "llama3.2";
  }
}

// ---- mock fallback ---------------------------------------------------------
function mockReply(messages: ChatMsg[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  return (
    "⚠️ The assistant is in **mock mode** — the selected AI provider isn't configured.\n\n" +
    "Pick a configured provider in the Assistant header, or set one up on the server:\n" +
    "- **Local (Ollama)** — `ollama serve` then `ollama pull llama3.2` (no API key)\n" +
    "- **Venice / OpenAI / Anthropic** — set `VENICE_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`\n\n" +
    `You asked: “${last.slice(0, 200)}”.`
  );
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- OpenAI-compatible transport (Venice · OpenAI · Ollama) ----------------
function openaiHeaders(p: Provider): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (p.apiKey) h.authorization = `Bearer ${p.apiKey}`;
  return h;
}
async function* openaiStream(p: Provider, messages: ChatMsg[], opts: StreamOpts): AsyncGenerator<string> {
  const r = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: openaiHeaders(p),
    body: JSON.stringify({
      model: p.model,
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.6,
      stream: true,
    }),
    signal: opts.signal ?? AbortSignal.timeout(120_000),
  });
  if (!r.ok || !r.body) throw new Error(`${p.id} ${r.status}`);
  yield* sseTokens(r.body, (data) => {
    try {
      return JSON.parse(data)?.choices?.[0]?.delta?.content ?? "";
    } catch {
      return "";
    }
  });
}
async function openaiChat(p: Provider, messages: ChatMsg[], opts: ChatOpts): Promise<string> {
  const r = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: openaiHeaders(p),
    body: JSON.stringify({ model: p.model, messages, max_tokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.6 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`${p.id} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as any;
  return String(j?.choices?.[0]?.message?.content ?? "").trim();
}

// ---- Anthropic transport (Claude) ------------------------------------------
function splitSystem(messages: ChatMsg[]): { system: string; msgs: { role: string; content: string }[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const msgs = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  return { system, msgs };
}
function anthropicHeaders(p: Provider): Record<string, string> {
  return { "content-type": "application/json", "x-api-key": p.apiKey ?? "", "anthropic-version": "2023-06-01" };
}
async function* anthropicStream(p: Provider, messages: ChatMsg[], opts: StreamOpts): AsyncGenerator<string> {
  const { system, msgs } = splitSystem(messages);
  const r = await fetch(`${p.base}/messages`, {
    method: "POST",
    headers: anthropicHeaders(p),
    body: JSON.stringify({
      model: p.model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.6,
      system,
      messages: msgs,
      stream: true,
    }),
    signal: opts.signal ?? AbortSignal.timeout(120_000),
  });
  if (!r.ok || !r.body) throw new Error(`anthropic ${r.status}`);
  yield* sseTokens(r.body, (data) => {
    try {
      const ev = JSON.parse(data);
      return ev?.type === "content_block_delta" && ev?.delta?.type === "text_delta" ? (ev.delta.text as string) : "";
    } catch {
      return "";
    }
  });
}
async function anthropicChat(p: Provider, messages: ChatMsg[], opts: ChatOpts): Promise<string> {
  const { system, msgs } = splitSystem(messages);
  const r = await fetch(`${p.base}/messages`, {
    method: "POST",
    headers: anthropicHeaders(p),
    body: JSON.stringify({ model: p.model, max_tokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.6, system, messages: msgs }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as any;
  return String((j?.content ?? []).map((b: any) => b?.text ?? "").join("")).trim();
}

// ---- shared SSE line reader ------------------------------------------------
async function* sseTokens(body: ReadableStream<Uint8Array>, extract: (data: string) => string): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? ""; // keep the trailing partial line
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const data = s.slice(5).trim();
        if (data === "[DONE]") return;
        const tok = extract(data);
        if (tok) yield tok;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

interface StreamOpts {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  provider?: string;
}
interface ChatOpts {
  maxTokens?: number;
  temperature?: number;
  provider?: string;
}

/** Streaming chat — yields content tokens as they arrive. Mock mode (no usable
 * provider) streams a helpful word-by-word reply so the UI feels live end-to-end. */
export async function* chatStream(messages: ChatMsg[], opts: StreamOpts = {}): AsyncGenerator<string, void, unknown> {
  let p = resolve(opts.provider);
  if (!usable(p)) {
    const text = mockReply(messages);
    for (const tok of text.match(/\s*\S+/g) ?? [text]) {
      if (opts.signal?.aborted) return;
      yield tok;
      await sleep(16);
    }
    return;
  }
  if (p.id === "local") p = { ...p, model: await localModel(p.base) };
  if (p.kind === "anthropic") yield* anthropicStream(p, messages, opts);
  else yield* openaiStream(p, messages, opts);
}

/** Non-streaming chat. Falls back to a mock reply when the provider isn't configured. */
export async function chat(messages: ChatMsg[], opts: ChatOpts = {}): Promise<{ reply: string; mock: boolean }> {
  let p = resolve(opts.provider);
  if (!usable(p)) return { reply: mockReply(messages), mock: true };
  if (p.id === "local") p = { ...p, model: await localModel(p.base) };
  try {
    const reply = p.kind === "anthropic" ? await anthropicChat(p, messages, opts) : await openaiChat(p, messages, opts);
    return { reply, mock: false };
  } catch (e) {
    logger.warn({ err: String(e), provider: p.id }, "assistant chat failed");
    throw e;
  }
}

// ---- tool-calling loop (lets the model query live MB data) -----------------
export interface ToolForLLM {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

/** Run the model with tools available; it may call them (one or many rounds), we
 * feed results back, and loop until it produces a final answer (or maxRounds).
 * Non-streaming. Falls back to a plain mock reply when no provider is configured. */
export async function chatWithTools(
  messages: ChatMsg[],
  tools: ToolForLLM[],
  exec: (name: string, args: any) => Promise<string>,
  opts: { provider?: string; maxTokens?: number; temperature?: number; maxRounds?: number } = {},
): Promise<{ reply: string; mock: boolean; used: string[] }> {
  let p = resolve(opts.provider);
  if (!usable(p)) return { reply: mockReply(messages), mock: true, used: [] };
  if (p.id === "local") p = { ...p, model: await localModel(p.base) };
  const used: string[] = [];
  try {
    const reply =
      p.kind === "anthropic"
        ? await anthropicToolLoop(p, messages, tools, exec, used, opts)
        : await openaiToolLoop(p, messages, tools, exec, used, opts);
    return { reply, mock: false, used };
  } catch (e) {
    logger.warn({ err: String(e), provider: p.id }, "tool chat failed — falling back to plain chat");
    // some local models don't support tool-calling; still return a real answer
    try {
      const reply = p.kind === "anthropic" ? await anthropicChat(p, messages, opts) : await openaiChat(p, messages, opts);
      return { reply, mock: false, used };
    } catch (e2) {
      logger.warn({ err: String(e2), provider: p.id }, "assistant chat failed");
      throw e2;
    }
  }
}

type LoopOpts = { maxTokens?: number; temperature?: number; maxRounds?: number };

async function openaiToolLoop(p: Provider, messages: ChatMsg[], tools: ToolForLLM[], exec: (n: string, a: any) => Promise<string>, used: string[], opts: LoopOpts): Promise<string> {
  const toolDefs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const msgs: any[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const rounds = opts.maxRounds ?? 4;
  for (let i = 0; i <= rounds; i++) {
    const withTools = i < rounds;
    const r = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      headers: openaiHeaders(p),
      body: JSON.stringify({
        model: p.model,
        messages: msgs,
        ...(withTools ? { tools: toolDefs, tool_choice: "auto" } : {}),
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.4,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`${p.id} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as any;
    const msg = j?.choices?.[0]?.message;
    const calls = msg?.tool_calls;
    if (!withTools || !calls || calls.length === 0) return String(msg?.content ?? "").trim();
    msgs.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    for (const c of calls) {
      let args: any = {};
      try {
        args = JSON.parse(c.function?.arguments || "{}");
      } catch {
        /* tolerate malformed args */
      }
      if (c.function?.name) used.push(c.function.name);
      const result = await exec(c.function?.name, args);
      msgs.push({ role: "tool", tool_call_id: c.id, content: result });
    }
  }
  return "";
}

async function anthropicToolLoop(p: Provider, messages: ChatMsg[], tools: ToolForLLM[], exec: (n: string, a: any) => Promise<string>, used: string[], opts: LoopOpts): Promise<string> {
  const { system, msgs } = splitSystem(messages);
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const conv: any[] = msgs.map((m) => ({ role: m.role, content: m.content }));
  const rounds = opts.maxRounds ?? 4;
  const textOf = (content: any[]) =>
    content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  for (let i = 0; i <= rounds; i++) {
    const withTools = i < rounds;
    const r = await fetch(`${p.base}/messages`, {
      method: "POST",
      headers: anthropicHeaders(p),
      body: JSON.stringify({
        model: p.model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.4,
        system,
        messages: conv,
        ...(withTools ? { tools: toolDefs } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as any;
    const content: any[] = j?.content ?? [];
    const toolUses = content.filter((b) => b.type === "tool_use");
    if (!withTools || toolUses.length === 0) return textOf(content);
    conv.push({ role: "assistant", content });
    const results: any[] = [];
    for (const tu of toolUses) {
      used.push(tu.name);
      const result = await exec(tu.name, tu.input || {});
      results.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    conv.push({ role: "user", content: results });
  }
  return "";
}
