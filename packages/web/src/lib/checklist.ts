import type { Checklist, ChecklistItem } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;
const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};
const jsonH = (): Record<string, string> => ({ "content-type": "application/json", ...authH() });

export async function fetchChecklists(): Promise<Checklist[]> {
  try {
    const r = await fetch(`${API}/api/checklists`);
    if (!r.ok) return [];
    return (await r.json()).checklists as Checklist[];
  } catch {
    return [];
  }
}

export async function createChecklist(title: string): Promise<Checklist | null> {
  try {
    const r = await fetch(`${API}/api/checklists`, { method: "POST", headers: jsonH(), body: JSON.stringify({ title }) });
    return r.ok ? ((await r.json()) as Checklist) : null;
  } catch {
    return null;
  }
}

export async function deleteChecklist(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/checklists/${encodeURIComponent(id)}`, { method: "DELETE", headers: authH() });
    return r.ok;
  } catch {
    return false;
  }
}

export async function addItem(
  cid: string,
  text: string,
  assignee?: string,
  assigneeName?: string,
): Promise<ChecklistItem | null> {
  try {
    const r = await fetch(`${API}/api/checklists/${encodeURIComponent(cid)}/items`, {
      method: "POST",
      headers: jsonH(),
      body: JSON.stringify({ text, assignee, assigneeName }),
    });
    return r.ok ? ((await r.json()) as ChecklistItem) : null;
  } catch {
    return null;
  }
}

export async function updateItem(cid: string, iid: string, patch: Partial<ChecklistItem>): Promise<ChecklistItem | null> {
  try {
    const r = await fetch(`${API}/api/checklists/${encodeURIComponent(cid)}/items/${encodeURIComponent(iid)}`, {
      method: "POST",
      headers: jsonH(),
      body: JSON.stringify(patch),
    });
    return r.ok ? ((await r.json()) as ChecklistItem) : null;
  } catch {
    return null;
  }
}

export async function deleteItem(cid: string, iid: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/checklists/${encodeURIComponent(cid)}/items/${encodeURIComponent(iid)}`, {
      method: "DELETE",
      headers: authH(),
    });
    return r.ok;
  } catch {
    return false;
  }
}
