import type { ChatMessage } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

export interface SearchResult {
  results: ChatMessage[];
  durable: boolean;
}

export async function searchMessages(q: string): Promise<SearchResult> {
  const token = getToken();
  try {
    const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) return { results: [], durable: false };
    return await r.json();
  } catch {
    return { results: [], durable: false };
  }
}

/** The conversation surrounding a message id (for jump-to-context). */
export async function fetchAround(id: string): Promise<ChatMessage[]> {
  const token = getToken();
  try {
    const r = await fetch(`${API}/api/messages/around?id=${encodeURIComponent(id)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) return [];
    return (await r.json()).messages as ChatMessage[];
  } catch {
    return [];
  }
}
