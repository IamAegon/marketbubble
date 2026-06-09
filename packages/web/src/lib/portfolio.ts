import type { Portfolio, PortfolioCall, PortfolioDraft, PortfolioPerformance } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;
const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};
const jsonH = (): Record<string, string> => ({ "content-type": "application/json", ...authH() });

export async function fetchPortfolios(): Promise<Portfolio[]> {
  try {
    const r = await fetch(`${API}/api/portfolios`);
    if (!r.ok) return [];
    return (await r.json()).portfolios as Portfolio[];
  } catch {
    return [];
  }
}

export async function fetchPerformance(): Promise<PortfolioPerformance | null> {
  try {
    const r = await fetch(`${API}/api/portfolios/performance`);
    if (!r.ok) return null;
    return (await r.json()) as PortfolioPerformance;
  } catch {
    return null;
  }
}

export async function createPortfolio(draft: PortfolioDraft): Promise<Portfolio | null> {
  try {
    const r = await fetch(`${API}/api/portfolios`, { method: "POST", headers: jsonH(), body: JSON.stringify(draft) });
    return r.ok ? ((await r.json()) as Portfolio) : null;
  } catch {
    return null;
  }
}

export async function updatePortfolio(id: string, patch: Partial<PortfolioDraft>): Promise<Portfolio | null> {
  try {
    const r = await fetch(`${API}/api/portfolios/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: jsonH(),
      body: JSON.stringify(patch),
    });
    return r.ok ? ((await r.json()) as Portfolio) : null;
  } catch {
    return null;
  }
}

export async function deletePortfolio(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/portfolios/${encodeURIComponent(id)}`, { method: "DELETE", headers: authH() });
    return r.ok;
  } catch {
    return false;
  }
}

export async function addCall(pid: string, draft: Partial<PortfolioCall>): Promise<PortfolioCall | null> {
  try {
    const r = await fetch(`${API}/api/portfolios/${encodeURIComponent(pid)}/calls`, {
      method: "POST",
      headers: jsonH(),
      body: JSON.stringify(draft),
    });
    return r.ok ? ((await r.json()) as PortfolioCall) : null;
  } catch {
    return null;
  }
}

export async function deleteCall(pid: string, cid: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/portfolios/${encodeURIComponent(pid)}/calls/${encodeURIComponent(cid)}`, {
      method: "DELETE",
      headers: authH(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** The branded "Portfolio Performance" PDF as a Blob (for the preview modal). */
export async function fetchPortfolioReport(): Promise<Blob> {
  const r = await fetch(`${API}/api/portfolios/report`, { headers: authH() });
  if (!r.ok) throw new Error(`portfolio report ${r.status}`);
  return await r.blob();
}
