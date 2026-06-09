import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Portfolio, PortfolioPerformance } from "@app/shared";
import { useAuth } from "../state/useAuth";
import { ReportModal } from "../analytics/ReportModal";
import {
  addCall,
  createPortfolio,
  deleteCall,
  deletePortfolio,
  fetchPerformance,
  fetchPortfolios,
  fetchPortfolioReport,
  updatePortfolio,
} from "../lib/portfolio";

const money = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const dayShort = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
const toInputDate = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Grouped-bar performance chart (mirrors the branded PDF, in-app dark theme). */
function PerfChart({ perf }: { perf: PortfolioPerformance }) {
  const { series, sampleTimes } = perf;
  const W = 760;
  const H = 300;
  const padL = 52;
  const padR = 12;
  const padT = 22;
  const padB = 26;
  const vals = series.flatMap((s) => s.points.map((p) => p.value));
  if (!vals.length || sampleTimes.length < 2) return <div className="cc-empty-sm">Not enough data to chart yet.</div>;
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const ymax = hi + (hi - lo) * 0.18 || hi * 1.1;
  const ymin = Math.max(0, lo - (hi - lo) * 0.12);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const groups = sampleTimes.length;
  const groupW = plotW / groups;
  const barW = Math.min(26, (groupW * 0.7) / series.length);
  const y = (v: number) => padT + plotH * (1 - (v - ymin) / (ymax - ymin || 1));
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => ymin + ((ymax - ymin) * i) / ticks);

  return (
    <svg className="pf-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {tickVals.map((tv, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} className="pf-grid" />
          <text x={padL - 8} y={y(tv) + 3} className="pf-ytick" textAnchor="end">
            ${Math.round(tv / 1000)}K
          </text>
        </g>
      ))}
      {sampleTimes.map((t, gi) => {
        const gx = padL + groupW * gi + groupW / 2;
        const totalW = barW * series.length + 3 * (series.length - 1);
        return (
          <g key={gi}>
            {series.map((s, si) => {
              const p = s.points[gi]!;
              const bx = gx - totalW / 2 + si * (barW + 3);
              const by = y(p.value);
              const h = Math.max(0, padT + plotH - by);
              const up = p.returnPct >= 0;
              return (
                <g key={s.portfolioId}>
                  <rect x={bx} y={by} width={barW} height={h} rx={2} fill={s.color} />
                  <text x={bx + barW / 2} y={by - 4} className={`pf-blabel ${up ? "up" : "dn"}`} textAnchor="middle">
                    {pct(p.returnPct)}
                  </text>
                </g>
              );
            })}
            <text x={gx} y={H - 8} className="pf-xtick" textAnchor="middle">
              {dayShort(t)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function NewPortfolio({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cap, setCap] = useState(100000);
  const [start, setStart] = useState(toInputDate(Date.now() - 30 * 86400000));
  const [tagline, setTagline] = useState("");
  const submit = async () => {
    if (!name.trim()) return;
    await createPortfolio({ name, startingCapital: cap, startedAt: new Date(start).getTime(), tagline: tagline || undefined });
    setOpen(false);
    setName("");
    setTagline("");
    onCreated();
  };
  const close = () => setOpen(false);
  return (
    <>
      <button className="cc-chip active" onClick={() => setOpen(true)}>
        + New portfolio
      </button>
      {open &&
        createPortal(
          <div className="pf-modal-overlay" onClick={close}>
            <div
              className="pf-modal"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === "Escape" && close()}
            >
              <div className="pf-modal-head">
                <div>
                  <div className="pf-modal-kicker">▰ Portfolio</div>
                  <div className="pf-modal-title">New portfolio</div>
                </div>
                <button className="pf-modal-x" onClick={close} title="Close (Esc)">
                  ✕
                </button>
              </div>
              <div className="pf-modal-body">
                <label className="pf-field">
                  <span>Name</span>
                  <input
                    className="pf-in"
                    placeholder="e.g. BTC + SOL swing"
                    value={name}
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                  />
                </label>
                <div className="pf-field-row">
                  <label className="pf-field">
                    <span>Starting capital</span>
                    <input className="pf-in" type="number" value={cap} onChange={(e) => setCap(Number(e.target.value) || 100000)} />
                  </label>
                  <label className="pf-field">
                    <span>Tracked from</span>
                    <input className="pf-in" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                  </label>
                </div>
                <label className="pf-field">
                  <span>
                    Tagline <em>(optional)</em>
                  </span>
                  <input
                    className="pf-in"
                    placeholder="A flourish for the report"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                  />
                </label>
              </div>
              <div className="pf-modal-foot">
                <button className="cc-chip active" onClick={submit} disabled={!name.trim()}>
                  Create portfolio
                </button>
                <button className="cc-chip" onClick={close}>
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function AddCall({ pid, onAdded }: { pid: string; onAdded: () => void }) {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"long" | "short">("long");
  const [weight, setWeight] = useState(1);
  const { user } = useAuth();
  const submit = async () => {
    if (!symbol.trim()) return;
    await addCall(pid, { symbol: symbol.toUpperCase().trim(), side, weight, calledBy: user?.displayName });
    setSymbol("");
    setWeight(1);
    onAdded();
  };
  return (
    <div className="pf-addcall">
      <input
        className="pf-in sm"
        placeholder="TICKER"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <div className="pf-side">
        <button className={side === "long" ? "on" : ""} onClick={() => setSide("long")}>
          Long
        </button>
        <button className={side === "short" ? "on short" : ""} onClick={() => setSide("short")}>
          Short
        </button>
      </div>
      <input
        className="pf-in xs"
        type="number"
        step="0.1"
        value={weight}
        onChange={(e) => setWeight(Number(e.target.value) || 1)}
        title="Allocation weight"
      />
      <button className="cc-chip sm" onClick={submit}>
        + Add call
      </button>
    </div>
  );
}

function PortfolioCard({
  p,
  series,
  onChange,
}: {
  p: Portfolio;
  series?: PortfolioPerformance["series"][number];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [tagline, setTagline] = useState(p.tagline ?? "");
  const [cap, setCap] = useState(p.startingCapital);
  const [start, setStart] = useState(toInputDate(p.startedAt));
  const saveMeta = async () => {
    await updatePortfolio(p.id, { name, tagline, startingCapital: cap, startedAt: new Date(start).getTime() });
    setEditing(false);
    onChange();
  };
  return (
    <div className="pf-card" style={{ ["--pf" as any]: p.color }}>
      <div className="pf-card-head">
        <span className="pf-dot" style={{ background: p.color }} />
        {editing ? (
          <input className="pf-in" value={name} onChange={(e) => setName(e.target.value)} />
        ) : (
          <h3>{p.name}</h3>
        )}
        {series && (
          <span className={`pf-ret ${series.finalReturnPct >= 0 ? "up" : "dn"}`}>
            {pct(series.finalReturnPct)} <span className="pf-val">{money(series.finalValue)}</span>
          </span>
        )}
        <div className="pf-card-acts">
          <button className="cc-icon-btn" onClick={() => setEditing((v) => !v)} title="Edit">
            ✎
          </button>
          <button
            className="cc-icon-btn"
            onClick={() => {
              if (confirm(`Delete portfolio "${p.name}"?`)) deletePortfolio(p.id).then(onChange);
            }}
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>

      {editing && (
        <div className="pf-edit">
          <label>
            <span>Tagline</span>
            <input className="pf-in" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Report flourish" />
          </label>
          <label>
            <span>Capital</span>
            <input className="pf-in sm" type="number" value={cap} onChange={(e) => setCap(Number(e.target.value) || 100000)} />
          </label>
          <label>
            <span>From</span>
            <input className="pf-in sm" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <button className="cc-chip active sm" onClick={saveMeta}>
            Save
          </button>
        </div>
      )}

      <div className="pf-meta">
        {money(p.startingCapital)} · from {dayShort(p.startedAt)} · {p.calls.length} call{p.calls.length === 1 ? "" : "s"}
      </div>

      <div className="pf-calls">
        {p.calls.length === 0 && <div className="cc-empty-sm">No calls yet — add the first one below.</div>}
        {p.calls.map((c) => (
          <div key={c.id} className="pf-call">
            <span className={`pf-call-side ${c.side}`}>{c.side === "short" ? "S" : "L"}</span>
            <b>{c.symbol}</b>
            <span className="pf-call-w">×{c.weight}</span>
            {c.calledBy && <span className="pf-call-by">{c.calledBy}</span>}
            <button className="pf-call-x" onClick={() => deleteCall(p.id, c.id).then(onChange)} title="Remove call">
              ✕
            </button>
          </div>
        ))}
      </div>
      <AddCall pid={p.id} onAdded={onChange} />
    </div>
  );
}

/** Portfolio Tracker — records the stream's trade calls into baskets and tracks
 * how each would have performed, with one-click branded report generation. */
export function PortfolioView() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [perf, setPerf] = useState<PortfolioPerformance | null>(null);
  const [loadingPerf, setLoadingPerf] = useState(true);
  const [showReport, setShowReport] = useState(false);

  const loadList = () => fetchPortfolios().then(setPortfolios);
  const loadPerf = () => {
    setLoadingPerf(true);
    fetchPerformance().then((p) => {
      setPerf(p);
      setLoadingPerf(false);
    });
  };
  const refresh = () => {
    loadList();
    loadPerf();
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seriesById = useMemo(() => {
    const m = new Map<string, PortfolioPerformance["series"][number]>();
    perf?.series.forEach((s) => m.set(s.portfolioId, s));
    return m;
  }, [perf]);

  return (
    <div className="pf-view">
      <div className="pf-top">
        <div>
          <h2>Portfolio Tracker</h2>
          <p className="cc-empty-sm">
            Stream trade calls → tracked baskets, priced from live market history. Generate the branded performance report any
            time.
          </p>
        </div>
        <div className="pf-top-acts">
          <button className="cc-chip" onClick={refresh} title="Recompute from latest prices">
            ↺ Refresh
          </button>
          <button className="cc-chip active" onClick={() => setShowReport(true)} disabled={portfolios.length === 0}>
            ⤓ Portfolio report
          </button>
        </div>
      </div>

      <div className="pf-chart-card">
        <div className="pf-chart-head">
          <div className="pf-legend">
            {(perf?.series ?? []).map((s) => (
              <span key={s.portfolioId} className="pf-leg">
                <span className="pf-dot" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
          {perf?.spread && (
            <div className="pf-spread">
              Spread <b>{money(perf.spread.usd)}</b> · {perf.spread.leaderName} over {perf.spread.laggardName}
            </div>
          )}
        </div>
        {loadingPerf ? (
          <div className="pf-chart-loading">
            <div className="report-spin" />
            <span>Pricing baskets from market history…</span>
          </div>
        ) : perf ? (
          <PerfChart perf={perf} />
        ) : (
          <div className="cc-empty-sm">Couldn’t load performance.</div>
        )}
        {perf?.missing?.length ? (
          <div className="pf-missing">Price history unavailable: {perf.missing.join(", ")} (held flat)</div>
        ) : null}
      </div>

      <div className="pf-list-head">
        <h3>Baskets</h3>
        <NewPortfolio onCreated={refresh} />
      </div>
      <div className="pf-grid">
        {portfolios.map((p) => (
          <PortfolioCard key={p.id} p={p} series={seriesById.get(p.id)} onChange={refresh} />
        ))}
      </div>

      {showReport && (
        <ReportModal
          fetcher={fetchPortfolioReport}
          filename="marketbubble-portfolio.pdf"
          title="Portfolio Performance"
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
