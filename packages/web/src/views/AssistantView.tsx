import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  streamAssistant,
  listAssistantProviders,
  listAssistantTools,
  type AssistantMsg,
  type AssistantProvider,
  type AssistantTool,
} from "../lib/assistant";
import { useLocation } from "react-router-dom";
import { mdToHtml } from "../lib/markdown";
import { useDashboard } from "../state/DashboardProvider";
import { useToasts } from "../state/toasts";
import { roomIcon } from "../lib/roomLabel";

/** The assistant's profile picture (Market Bubble mark). */
const ASSISTANT_PFP = "/pfps/mb-bubble-assistant.jpg";

/** Prompt templates, surfaced via the `/` slash menu (or the ＋ button) in the composer. */
const TEMPLATES = [
  { cmd: "market-read", label: "Market read", icon: "📈", desc: "Tone, what's moving, what to watch", prompt: "Give me a tight read on the market right now — overall tone, what's moving, and what to watch." },
  { cmd: "talking-points", label: "Talking points", icon: "🎙", desc: "5 sharp points for today's stream", prompt: "Draft 5 sharp talking points for today's stream based on the current market mood and what's trending." },
  { cmd: "explain-trend", label: "Explain a trend", icon: "🔥", desc: "Why a trending topic matters", prompt: "Pick the most interesting thing trending right now and explain why it matters for our audience." },
  { cmd: "guest-prep", label: "Guest prep", icon: "🎯", desc: "Questions + pushbacks for a guest", prompt: "We have a markets/crypto guest on today. Suggest 5 questions to ask and 3 things to respectfully push back on." },
  { cmd: "title-ideas", label: "Title ideas", icon: "✏️", desc: "5 punchy stream titles", prompt: "Give me 5 punchy livestream title ideas for today based on the market mood." },
  { cmd: "trade-ideas", label: "Trade ideas", icon: "💡", desc: "3 themes, bull + bear case", prompt: "Suggest 3 trade ideas/themes worth discussing on stream today, each with a one-line bull and bear case." },
  { cmd: "recap", label: "Recap last hour", icon: "⏱", desc: "5-bullet recap of the last hour", prompt: "Summarize the last hour of market action and chat sentiment into a 5-bullet recap." },
  {
    cmd: "prompt-5",
    label: "Prompt scaffold (5-step)",
    icon: "🧱",
    desc: "Role · context · instructions · examples · reminder",
    prompt:
      "1 · Role & task — 1–2 sentences establishing your role and the high-level task:\n\n2 · Context — dynamic / retrieved content to ground the answer:\n\n3 · Instructions — the detailed, step-by-step task instructions:\n\n4 · Examples (optional) — one or two n-shot examples:\n\n5 · Reminder — repeat the most critical instructions (matters most on long prompts):\n",
  },
  {
    cmd: "prompt-10",
    label: "Prompt scaffold (10-step)",
    icon: "🏗",
    desc: "The full 10-part prompt structure",
    prompt:
      "1 · Task context — who you are and the goal:\n\n2 · Tone context — the voice/style to use:\n\n3 · Background data, documents & images:\n\n4 · Detailed task description & rules:\n\n5 · Examples:\n\n6 · Conversation history:\n\n7 · Immediate task / request:\n\n8 · Think step by step before answering:\n\n9 · Output formatting — exactly how the answer should be shaped:\n\n10 · Prefilled response (if any):\n",
  },
];
const SUGGESTIONS = TEMPLATES.slice(0, 4);

interface Convo {
  id: string;
  title: string;
  messages: AssistantMsg[];
  updatedAt: number;
  /** true once the user manually renamed it — stops the auto-title from overwriting */
  pinned?: boolean;
}
const KEY = "mb.ai.convos.v1";
const loadConvos = (): Convo[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function AssistantView() {
  const d = useDashboard();
  const { push } = useToasts();
  const [convos, setConvos] = useState<Convo[]>(loadConvos);
  // open straight into a fresh "new chat"; past chats live in the Recents rail
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  // per-conversation streaming: id -> accumulated partial text ("" until the first
  // token). A key's presence means that chat is generating — so the typing bubble
  // only ever shows in the chat that's actually answering, never the others.
  const [streams, setStreams] = useState<Record<string, string>>({});
  // conversation ids whose last turn failed to reach the assistant
  const [erroredIds, setErroredIds] = useState<string[]>([]);
  const [providers, setProviders] = useState<AssistantProvider[]>([]);
  const [provider, setProvider] = useState<string>(() => localStorage.getItem("mb.ai.provider.v1") || "");
  const [tools, setTools] = useState<AssistantTool[]>([]);
  // null = all tools enabled (default); otherwise the explicit enabled set
  const [enabledTools, setEnabledTools] = useState<string[] | null>(() => {
    try {
      const r = localStorage.getItem("mb.ai.tools.v1");
      return r ? JSON.parse(r) : null;
    } catch {
      return null;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slashSel, setSlashSel] = useState(0);
  const [tmplOpen, setTmplOpen] = useState(false);
  const [fwd, setFwd] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  // one AbortController per in-flight conversation, so chats stream independently
  const abortMap = useRef<Map<string, AbortController>>(new Map());

  const active = convos.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  // streaming/typing/error state scoped to the *active* chat only
  const activeStreaming = activeId != null && Object.prototype.hasOwnProperty.call(streams, activeId);
  const activeStreamText = activeId != null ? streams[activeId] ?? "" : "";
  const activeErrored = activeId != null && erroredIds.includes(activeId);

  // slash menu opens on a leading "/", or via the ＋ button (tmplOpen)
  const slashOpen = input.startsWith("/") && !input.includes("\n");
  const slashQuery = slashOpen ? input.slice(1).toLowerCase().trim() : "";
  const slashMatches = slashOpen
    ? TEMPLATES.filter((t) => (t.cmd + " " + t.label + " " + t.desc).toLowerCase().includes(slashQuery))
    : [];
  const menuOpen = slashOpen || tmplOpen;
  const menuItems = slashOpen ? slashMatches : TEMPLATES;

  useEffect(() => {
    listAssistantProviders().then((ps) => {
      setProviders(ps);
      setProvider((cur) => cur || ps.find((p) => p.configured)?.id || ps[0]?.id || "");
    });
    listAssistantTools().then(setTools);
  }, []);
  useEffect(() => {
    if (provider) localStorage.setItem("mb.ai.provider.v1", provider);
  }, [provider]);
  useEffect(() => {
    if (enabledTools) localStorage.setItem("mb.ai.tools.v1", JSON.stringify(enabledTools));
  }, [enabledTools]);
  const toggleTool = (name: string) =>
    setEnabledTools((cur) => {
      const base = cur ?? tools.map((t) => t.name);
      return base.includes(name) ? base.filter((n) => n !== name) : [...base, name];
    });
  const toolOn = (name: string) => enabledTools === null || enabledTools.includes(name);
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(convos.slice(0, 50)));
  }, [convos]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeStreaming, activeStreamText]);
  useEffect(() => {
    setSlashSel(0);
  }, [slashQuery, slashOpen]);
  // click-away closes the ＋ template menu
  useEffect(() => {
    if (!tmplOpen) return;
    const h = (e: MouseEvent) => {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) setTmplOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [tmplOpen]);

  // auto-grow the textarea to fit its content (capped)
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(220, ta.scrollHeight) + "px";
  }, [input]);

  const upsert = (id: string, msgs: AssistantMsg[]) =>
    setConvos((prev) => {
      const existing = prev.find((c) => c.id === id);
      // keep a user-renamed title; otherwise derive it from the first message
      const title = existing?.pinned ? existing.title : msgs.find((m) => m.role === "user")?.content.slice(0, 48) || "New chat";
      const rest = prev.filter((c) => c.id !== id);
      return [{ id, title, messages: msgs, updatedAt: Date.now(), pinned: existing?.pinned }, ...rest];
    });

  /** Run a streaming turn against the given history (which must end with a user msg).
   *  Streaming state is keyed by conversation id, so multiple chats can generate at
   *  once and each chat only ever shows its own typing bubble. */
  const runStream = async (id: string, history: AssistantMsg[]) => {
    setErroredIds((e) => e.filter((x) => x !== id));
    setStreams((s) => ({ ...s, [id]: "" }));
    const ac = new AbortController();
    abortMap.current.set(id, ac);
    let acc = "";
    try {
      await streamAssistant(history, {
        signal: ac.signal,
        provider: provider || undefined,
        tools: enabledTools ?? undefined,
        onToken: (tok) => {
          acc += tok;
          setStreams((s) => (id in s ? { ...s, [id]: acc } : s));
        },
      });
      upsert(id, [...history, { role: "assistant", content: acc }]);
    } catch {
      if (ac.signal.aborted) {
        if (acc.trim()) upsert(id, [...history, { role: "assistant", content: acc + " …" }]);
      } else {
        setErroredIds((e) => (e.includes(id) ? e : [...e, id]));
      }
    } finally {
      abortMap.current.delete(id);
      setStreams((s) => {
        if (!(id in s)) return s;
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t || activeStreaming) return;
    const id = activeId ?? newId();
    if (!activeId) setActiveId(id);
    const history = [...(active?.messages ?? []), { role: "user" as const, content: t }];
    upsert(id, history);
    setInput("");
    setTmplOpen(false);
    runStream(id, history);
  };

  // open a FRESH chat and immediately ask (used by "Ask AI about this" from the feed/news)
  const askNew = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const id = newId();
    setActiveId(id);
    const history = [{ role: "user" as const, content: t }];
    upsert(id, history);
    runStream(id, history);
  };

  // consume a pending "ask" handed over by the feed/news (router state), once
  const location = useLocation();
  const askedRef = useRef<string | null>(null);
  useEffect(() => {
    const ask = (location.state as { ask?: string } | null)?.ask;
    if (!ask || typeof ask !== "string" || askedRef.current === ask) return;
    askedRef.current = ask;
    window.history.replaceState({}, ""); // drop nav state so back/refresh won't resend
    askNew(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const stop = () => {
    if (activeId) abortMap.current.get(activeId)?.abort();
  };

  const regenerate = () => {
    if (!active || activeStreaming) return;
    const msgs = active.messages;
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i]!.role !== "user") i--;
    if (i < 0) return;
    const history = msgs.slice(0, i + 1);
    upsert(active.id, history);
    runStream(active.id, history);
  };

  const retry = () => {
    if (!active || activeStreaming) return;
    runStream(active.id, active.messages);
  };

  // Compaction (like Claude /compact or GPT's rolling context): fold the OLDER turns
  // into a dense summary, keep the most recent turns verbatim, and continue from there.
  // The summary call lifts the server's context window so it sees the FULL history.
  const KEEP_RECENT = 4; // turns kept verbatim after a compaction
  const AUTO_AT = 26; // auto-compact once a chat grows past this many turns
  const [compacting, setCompacting] = useState(false);
  const autoRef = useRef(0); // guards auto-compact from re-firing on the same length
  const compact = async (auto = false) => {
    if (!active || activeStreaming || compacting || active.messages.length <= KEEP_RECENT + 2) return;
    setCompacting(true);
    const id = active.id;
    const msgs = active.messages;
    const head = msgs.slice(0, msgs.length - KEEP_RECENT); // older turns to summarize
    const tail = msgs.slice(msgs.length - KEEP_RECENT); // recent turns kept as-is
    const ask =
      "Summarize the conversation so far into a dense brief that preserves every key fact, number, decision, preference, and open thread, so we can continue seamlessly. Use tight bullet points. Output only the brief.";
    let acc = "";
    try {
      await streamAssistant([...head, { role: "user" as const, content: ask }], {
        signal: new AbortController().signal,
        provider: provider || undefined,
        tools: [], // no tool-calls while summarizing
        maxMessages: 200, // let the server see the whole history, not just the last 12
        onToken: (tok) => (acc += tok),
      });
      if (acc.trim()) {
        upsert(id, [{ role: "assistant", content: `📌 **Summary of earlier conversation**\n\n${acc.trim()}` }, ...tail]);
        push({ title: auto ? "Chat auto-compacted" : "Chat compacted", body: "Older turns folded into a summary — the AI keeps the thread without drifting.", kind: "info" });
      } else if (!auto) {
        push({ title: "Nothing to compact", body: "The model returned an empty summary.", kind: "info" });
      }
    } catch {
      if (!auto) push({ title: "Compact failed", body: "Couldn't summarize the chat — try again.", kind: "info" });
    } finally {
      setCompacting(false);
    }
  };

  // auto-compact long chats (debounced by length) so context stays sharp without nagging
  useEffect(() => {
    if (activeStreaming || compacting) return;
    if (messages.length >= AUTO_AT && autoRef.current !== messages.length) {
      autoRef.current = messages.length;
      void compact(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, activeStreaming, compacting]);

  // surface the manual-compact nudge once a chat gets long
  const longChat = messages.length >= 10;

  const pickTemplate = (t: (typeof TEMPLATES)[number]) => {
    setTmplOpen(false);
    setInput(t.prompt);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(t.prompt.length, t.prompt.length);
      }
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashMatches.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSel((s) => (s + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSel((s) => (s - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickTemplate(slashMatches[slashSel] ?? slashMatches[0]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const newChat = () => {
    // switch to a fresh chat; any background chats keep streaming
    setActiveId(null);
    setInput("");
  };
  const del = (id: string) => {
    abortMap.current.get(id)?.abort();
    setErroredIds((e) => e.filter((x) => x !== id));
    setConvos((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  };
  const beginRename = (id: string, title: string) => {
    setEditingId(id);
    setDraftTitle(title);
  };
  const commitRename = () => {
    if (!editingId) return;
    const t = draftTitle.trim();
    if (t) setConvos((prev) => prev.map((c) => (c.id === editingId ? { ...c, title: t, pinned: true } : c)));
    setEditingId(null);
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      push({ title: "Copied to clipboard", kind: "info" });
    } catch {
      /* ignore */
    }
  };
  const exportConvo = () => {
    if (!active) return;
    const md = active.messages.map((m) => `**${m.role === "user" ? "You" : "Assistant"}:**\n${m.content}`).join("\n\n---\n\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `marketbubble-assistant-${active.id}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doForward = (roomId: string) => {
    if (fwd == null) return;
    // forward the full answer as a formatted AI embed (text is just a fallback preview)
    d.post(roomId, fwd, undefined, { kind: "ai", title: "Assistant", markdown: fwd });
    setFwd(null);
    push({ title: "Sent to room", kind: "info" });
  };

  const empty = messages.length === 0 && !activeStreaming;
  const me = d.user;
  const initials = (me?.displayName || me?.handle || "?").trim().slice(0, 2).toUpperCase();
  const docTitle = active?.title || "New chat";

  return (
    <div className="aiview">
      <aside className="ai-side">
        <div className="ai-side-head">
          <span className="ai-side-mark">✦</span> Assistant
        </div>
        <button className="ai-new" onClick={newChat}>
          ＋ New chat
        </button>
        <div className="ai-side-label">Recents</div>
        <div className="ai-convos">
          {convos.length === 0 && <div className="cc-empty-sm">No past chats yet.</div>}
          {convos.map((c) => (
            <div key={c.id} className={`ai-convo ${c.id === activeId ? "on" : ""}`} onClick={() => setActiveId(c.id)}>
              {editingId === c.id ? (
                <input
                  className="ai-convo-edit"
                  value={draftTitle}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span className="ai-convo-title" onDoubleClick={(e) => { e.stopPropagation(); beginRename(c.id, c.title); }}>
                  {c.title}
                </span>
              )}
              <button className="ai-convo-rename" title="Rename" onClick={(e) => { e.stopPropagation(); beginRename(c.id, c.title); }}>
                ✎
              </button>
              <button className="ai-convo-x" title="Delete" onClick={(e) => { e.stopPropagation(); del(c.id); }}>
                ✕
              </button>
            </div>
          ))}
        </div>
        {me && (
          <div className="ai-userchip">
            <span className="ai-userchip-av" style={{ background: me.color || "var(--gold)" }}>{initials}</span>
            <span className="ai-userchip-meta">
              <span className="ai-userchip-name">{me.displayName || me.handle}</span>
              <span className="ai-userchip-sub">{me.role || "member"}</span>
            </span>
          </div>
        )}
      </aside>

      <div className="ai-main">
        <div className="ai-head">
          <div className="ai-head-title">
            <img className="ai-head-av" src={ASSISTANT_PFP} alt="" />
            <span className="ai-head-titles">
              <span className="ai-doc-title">{docTitle}</span>
              <span className="ai-head-sub">✦ grounded in live market data</span>
            </span>
          </div>
          <div className="ai-head-right">
            {providers.length > 0 && (
              <select
                className="ai-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                title="AI provider — pick which model answers"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.configured ? "" : p.needsKey ? " · no key" : " · offline"}
                  </option>
                ))}
              </select>
            )}
            <div className="ai-settings-wrap">
              <button
                className={`ai-gear ${settingsOpen ? "on" : ""}`}
                onClick={() => setSettingsOpen((o) => !o)}
                title="Assistant settings — what data it can access"
              >
                ⚙
              </button>
              {settingsOpen && (
                <>
                  <div className="ai-settings-backdrop" onClick={() => setSettingsOpen(false)} />
                  <div className="ai-settings-pop">
                    <div className="ai-settings-h">Data the assistant can access</div>
                    <div className="ai-settings-sub">It calls these to ground its answers in live Market Bubble data.</div>
                    {tools.length === 0 && (
                      <div className="cc-empty-sm">
                        {me && me.role !== "mod" && me.role !== "admin"
                          ? "Live-data tools (chat search, stream stats, sessions, transcripts) are available to moderators and admins."
                          : "No tools available."}
                      </div>
                    )}
                    {tools.map((t) => (
                      <label className={`ai-tool ${toolOn(t.name) ? "on" : ""}`} key={t.name}>
                        <input type="checkbox" checked={toolOn(t.name)} onChange={() => toggleTool(t.name)} />
                        <span className="ai-tool-body">
                          <span className="ai-tool-label">{t.label}</span>
                          <span className="ai-tool-desc">{t.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            {active && (
              <button className="ai-mini" onClick={exportConvo} title="Export this conversation as markdown">
                ⤓ Export
              </button>
            )}
          </div>
        </div>

        <div className="ai-thread">
          {empty ? (
            <div className="ai-hero">
              <img className="ai-hero-mark" src={ASSISTANT_PFP} alt="" />
              <div className="ai-hero-title">How can I help you read the market?</div>
              <div className="ai-hero-sub">Grounded in the live market mood, trends &amp; your streams.</div>
              <div className="ai-suggest">
                {SUGGESTIONS.map((t) => (
                  <button key={t.cmd} className="ai-chip" onClick={() => pickTemplate(t)} title={t.prompt}>
                    <span className="ai-chip-ico">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="ai-hint">
                Type <kbd>/</kbd> for prompt templates · <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="ai-turn ai-turn-user">
                    <div className="ai-userbubble">{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className="ai-turn ai-turn-assistant">
                    <img className="ai-ava" src={ASSISTANT_PFP} alt="AI" />
                    <div className="ai-answerwrap">
                      <div className="ai-answer" dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />
                      <div className="ai-actions">
                        <button onClick={() => copy(m.content)}>Copy</button>
                        <button onClick={() => setFwd(m.content)}>Forward →</button>
                        {i === messages.length - 1 && !activeStreaming && (
                          <button onClick={regenerate} title="Regenerate this reply">↻ Regenerate</button>
                        )}
                      </div>
                    </div>
                  </div>
                ),
              )}
              {activeStreaming && (
                <div className="ai-turn ai-turn-assistant">
                  <img className="ai-ava" src={ASSISTANT_PFP} alt="AI" />
                  <div className="ai-answerwrap">
                    {activeStreamText ? (
                      <div className="ai-answer ai-streaming">
                        {activeStreamText}
                        <span className="ai-caret" />
                      </div>
                    ) : (
                      <div className="ai-answer ai-typing">
                        <span className="ai-dot" />
                        <span className="ai-dot" />
                        <span className="ai-dot" />
                      </div>
                    )}
                  </div>
                </div>
              )}
              {activeErrored && !activeStreaming && (
                <div className="ai-turn ai-turn-assistant">
                  <div className="ai-ava ai-ava-err">!</div>
                  <div className="ai-answerwrap">
                    <div className="ai-answer ai-error">
                      Couldn’t reach the assistant.
                      <button className="ai-retry" onClick={retry}>↻ Retry</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={endRef} />
        </div>

        <div className="ai-composer" ref={composerRef}>
          {menuOpen && (
            <div className="ai-slash">
              <div className="ai-slash-head">Prompt templates{slashOpen && slashQuery ? ` · “${slashQuery}”` : ""}</div>
              {menuItems.length === 0 && <div className="ai-slash-empty">No template matches “{slashQuery}”.</div>}
              {menuItems.map((t, i) => (
                <button
                  key={t.cmd}
                  className={`ai-slash-item ${slashOpen && i === slashSel ? "on" : ""}`}
                  onMouseEnter={() => slashOpen && setSlashSel(i)}
                  onClick={() => pickTemplate(t)}
                >
                  <span className="ai-slash-ico">{t.icon}</span>
                  <span className="ai-slash-body">
                    <span className="ai-slash-label">
                      {t.label} <span className="ai-slash-cmd">/{t.cmd}</span>
                    </span>
                    <span className="ai-slash-desc">{t.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {longChat && !activeStreaming && (
            <div className="ai-rot-note">
              <span className="ai-rot-ic">⚠</span>
              <span className="ai-rot-txt">
                Long chats drift — models lose track of the middle and start to hallucinate. Compact folds the older turns into a
                summary so the AI keeps the thread. (Auto-compacts past {AUTO_AT} turns.)
              </span>
              <button className="ai-rot-btn" onClick={() => compact()} disabled={compacting}>
                {compacting ? "Compacting…" : "Compact chat"}
              </button>
            </div>
          )}
          <div className={`ai-inputbox ${activeStreaming ? "busy" : ""}`}>
            <textarea
              ref={taRef}
              rows={1}
              placeholder="Write a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
            />
            <div className="ai-inputrow">
              <button className={`ai-attach ${tmplOpen ? "on" : ""}`} onClick={() => setTmplOpen((o) => !o)} title="Prompt templates (/)">
                ＋
              </button>
              <div className="ai-inputrow-right">
                <span className="ai-ctx">✦ grounded in live data</span>
                {activeStreaming ? (
                  <button className="ai-send stop" onClick={stop} title="Stop generating">
                    <span className="ai-stop-sq" />
                  </button>
                ) : (
                  <button className="ai-send" onClick={() => send(input)} disabled={!input.trim()} title="Send (Enter)">
                    ↑
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="ai-composer-foot">
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · <kbd>/</kbd> for templates
          </div>
        </div>
      </div>

      {fwd != null && (
        <div className="fwd-overlay" onClick={() => setFwd(null)}>
          <div className="fwd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fwd-head">Forward to a room</div>
            <div className="fwd-quote">
              <div className="fwd-quote-text">{fwd.slice(0, 200)}</div>
            </div>
            <div className="fwd-rooms">
              {d.rooms.map((r) => (
                <button key={r.id} onClick={() => doForward(r.id)}>
                  {roomIcon(r)}
                  {r.label}
                </button>
              ))}
            </div>
            <button className="fwd-cancel" onClick={() => setFwd(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
