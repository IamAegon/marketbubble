import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { Platform, PortfolioPerformance, SessionSummary, StatsSnapshot } from "@app/shared";
import { logger } from "../observability/logger.js";

const ZERO = { streamers: 0, total: 0, chatters: 0, perMin: 0, peakPerMin: 0, net: 0 };

/** Adapt a recorded session into the snapshot shape so it reuses the same report. */
export function sessionSnapshot(s: SessionSummary): StatsSnapshot {
  const dominant = (Object.entries(s.byPlatform).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "twitch") as Platform;
  return {
    range: "session",
    scope: s.owned ? "owned" : "external",
    streamerName: s.streamerName,
    owned: s.owned,
    now: s.endedAt ?? Date.now(),
    startedAt: s.startedAt,
    total: s.messages,
    sessionTotal: s.messages,
    bucketMs: 60_000,
    perMin: s.avgPerMin,
    peakPerMin: s.peakPerMin,
    peakAt: s.peakAt,
    chatters: s.chatters,
    byPlatform: s.byPlatform,
    buckets: s.activity,
    channels: s.messages ? [{ channel: s.streamerId, label: s.streamerName, platform: dominant, count: s.messages }] : [],
    topChatters: s.topChatters,
    cashtags: s.topCashtags,
    emotes: s.topEmotes,
    sentiment: s.sentiment,
    streamers: [],
    comparison: { owned: { ...ZERO }, external: { ...ZERO } },
    durable: true,
  };
}

const RANGE_LABEL: Record<string, string> = {
  "5m": "last 5 minutes",
  "20m": "last 20 minutes",
  "1h": "last hour",
  "6h": "last 6 hours",
  session: "this session",
};

const TEX_SPECIALS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

/** Make arbitrary user text safe for pdflatex: drop non-ASCII (emoji/accents that
 * crash utf8 pdflatex), then escape LaTeX specials. */
function tex(s: unknown): string {
  return String(s ?? "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\&%$#_{}~^]/g, (c) => TEX_SPECIALS[c] ?? c)
    .trim();
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const stamp = (t: number) => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const n0 = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
/** safe fixed-decimal — never throws on undefined/NaN (live folds can omit fields). */
const f1 = (n: unknown) => (Number(n) || 0).toFixed(1);

/** A pgfplots coordinate string for one numeric series over bucket index.
 * Coerce every value to a finite number — pgfplots aborts the whole compile on
 * an `undefined`/`Infinity` coordinate (a live bucket can omit a platform field,
 * leaving it undefined), which surfaced as a bogus "no TeX distribution" error. */
function coords(values: Array<number | undefined>): string {
  return values.map((v, i) => `(${i + 1},${Number.isFinite(v as number) ? v : 0})`).join(" ");
}

/**
 * The shared "Market Bubble Intel" editorial theme — the look from the branded
 * portfolio report: warm cream paper, heavy serif display (TeX Gyre Bonum),
 * Palatino body, a Chancery script flourish, and a forest-green / crimson / gold
 * palette. `withPlots` pulls in pgfplots for the charted analytics report.
 */
function themePre(withPlots: boolean, landscape = false): string {
  return `\\documentclass[11pt]{article}
\\usepackage[a4paper,${landscape ? "landscape," : ""}margin=1.5cm]{geometry}
\\usepackage[utf8]{inputenc}
\\usepackage[table]{xcolor}
${withPlots ? "\\usepackage{pgfplots}\n\\pgfplotsset{compat=1.16}\n" : "\\usepackage{tikz}\n"}\\usepackage[most]{tcolorbox}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{parskip}
\\usepackage{microtype}
% --- palette (Market Bubble "Intel" report template) ---
\\definecolor{paper}{HTML}{F4EFE3}   % warm cream page
\\definecolor{card}{HTML}{FBF8F0}    % lighter card fill
\\definecolor{ink}{HTML}{20281F}     % green-charcoal body/title
\\definecolor{green}{HTML}{1F5A3D}   % positive (forest)
\\definecolor{red}{HTML}{A0241F}     % negative (crimson)
\\definecolor{gold}{HTML}{B0892F}    % highlight / spread
\\definecolor{mut}{HTML}{6A6357}     % muted brown-grey
\\definecolor{line}{HTML}{D8CFBC}    % hairline on cream
% legacy chart aliases, retoned for the cream canvas
\\definecolor{kicol}{HTML}{1F5A3D}
\\definecolor{dncol}{HTML}{A0241F}
\\definecolor{accent}{HTML}{B0892F}
\\definecolor{twcol}{HTML}{6B4FA0}
\\definecolor{xcol}{HTML}{3A352C}
\\definecolor{mbcol}{HTML}{B0892F}
\\pagecolor{paper}
\\color{ink}
% --- fonts: Pagella body, Bonum display, Chorus script ---
\\renewcommand{\\rmdefault}{qpl}
\\newcommand{\\dfont}{\\fontfamily{qbk}\\selectfont}
\\newcommand{\\sfont}{\\fontfamily{qzc}\\selectfont}
% --- type helpers ---
\\newcommand{\\eyebrow}[1]{{\\color{mut}\\footnotesize\\bfseries\\textls[150]{\\MakeUppercase{#1}}}}
\\newcommand{\\rtitle}[1]{{\\dfont\\bfseries\\fontsize{30}{33}\\selectfont #1}}
\\newcommand{\\flourish}[1]{{\\sfont\\color{red}\\fontsize{23}{24}\\selectfont #1}}
\\newtcolorbox{statcard}{colback=card,colframe=line,boxrule=0.7pt,arc=7pt,left=12pt,right=12pt,top=9pt,bottom=9pt,width=\\linewidth,enhanced,shadow={0.6mm}{-0.6mm}{0mm}{line!60}}
\\arrayrulecolor{line}
\\pagestyle{empty}
\\setlength{\\tabcolsep}{6pt}
\\renewcommand{\\arraystretch}{1.18}
\\begin{document}`;
}

/** Top masthead: small-caps eyebrow + big serif title (+ optional script flourish on the right). */
function masthead(eyebrow: string, title: string, sub: string, flourish?: string): string {
  const right = flourish ? `\\hfill\\raisebox{-6pt}{\\flourish{${flourish}}}` : "";
  return `\\noindent\\eyebrow{${eyebrow}}\\\\[3pt]
\\noindent\\rtitle{${title}}${right}\\\\[5pt]
{\\color{mut}\\small ${sub}}\\\\[2pt]
{\\color{line}\\rule{\\linewidth}{1pt}}
\\vspace{10pt}`;
}

/** Footer rule + "MARKET BUBBLE · <kicker>" left, "Presented by Polymarket" right. */
function mbFooter(kicker: string): string {
  return `\\vfill
{\\color{line}\\rule{\\linewidth}{0.7pt}}\\\\[3pt]
\\noindent\\begin{minipage}[b]{0.6\\linewidth}\\eyebrow{Market Bubble \\textperiodcentered\\ ${kicker}}\\end{minipage}%
\\hfill\\begin{minipage}[b]{0.38\\linewidth}\\raggedleft{\\color{mut}\\footnotesize Presented by }{\\dfont\\bfseries\\color{ink}\\large Polymarket}\\end{minipage}`;
}

/** Build the full LaTeX document for an analytics snapshot. */
export function renderReport(s: StatsSnapshot): string {
  const rangeLabel = RANGE_LABEL[s.range] ?? s.range;
  const scopeLabel = s.streamerName
    ? `${s.streamerName}${s.owned ? " (Market Bubble)" : " (external)"}`
    : s.scope === "owned"
      ? "Market Bubble streamers"
      : s.scope === "external"
        ? "External streamers"
        : "All streams";
  const sentLast = s.sentiment[s.sentiment.length - 1];
  const net = sentLast ? sentLast.net : 0;
  const sentWord = net > 0.15 ? "Bullish" : net < -0.15 ? "Bearish" : "Flat";

  // --- activity stacked bars (cap to ~48 bars for a clean chart) ---
  const bk = s.buckets.length > 48 ? s.buckets.slice(s.buckets.length - 48) : s.buckets;
  const tw = coords(bk.map((b) => b.twitch));
  const ki = coords(bk.map((b) => b.kick));
  const xx = coords(bk.map((b) => b.x));
  const mb = coords(bk.map((b) => b.mb));
  const nBars = bk.length;
  // a few x ticks with clock labels
  const tickIdx = nBars > 1 ? [0, Math.floor(nBars / 2), nBars - 1] : [0];
  const xtick = tickIdx.map((i) => i + 1).join(",");
  const xticklabels = tickIdx.map((i) => `{${clock(bk[i]!.t)}}`).join(",");

  const activityChart =
    nBars >= 2
      ? `\\begin{tikzpicture}
\\begin{axis}[
  ybar stacked, bar width=${Math.max(2, Math.floor(380 / nBars))}pt, width=\\linewidth, height=5.4cm,
  ymin=0, axis lines=left, ylabel={msgs}, tick align=outside, enlarge x limits=0.02,
  xtick={${xtick}}, xticklabels={${xticklabels}}, xticklabel style={font=\\scriptsize},
  yticklabel style={font=\\scriptsize}, ylabel style={font=\\scriptsize},
  legend style={font=\\scriptsize, at={(0.5,-0.22)}, anchor=north, legend columns=-1, draw=none, fill=none, /tikz/every even column/.append style={column sep=10pt}},
  every axis plot/.append style={draw=none}]
\\addplot[fill=twcol] coordinates {${tw}};
\\addplot[fill=kicol] coordinates {${ki}};
\\addplot[fill=xcol] coordinates {${xx}};
\\addplot[fill=mbcol] coordinates {${mb}};
\\legend{Twitch, Kick, X, MB}
\\end{axis}
\\end{tikzpicture}`
      : `\\textit{Not enough activity in this range to chart yet.}`;

  // --- sentiment line ---
  const sp = s.sentiment;
  const sentCoords = coords(sp.map((p) => Number(p.net)));
  const sentChart =
    sp.length >= 2
      ? `\\begin{tikzpicture}
\\begin{axis}[
  width=\\linewidth, height=4.6cm, ymin=-1.15, ymax=1.15, axis lines=left, clip=true,
  ytick={-1,0,1}, yticklabels={Bear,0,Bull}, yticklabel style={font=\\scriptsize},
  xtick=\\empty, ylabel={net}, ylabel style={font=\\scriptsize},
  enlarge x limits=0.02]
\\addplot[draw=gray!50, dashed] coordinates {(1,0) (${sp.length},0)};
\\addplot[draw=${net >= 0 ? "kicol" : "dncol"}, very thick] coordinates {${sentCoords}};
\\end{axis}
\\end{tikzpicture}`
      : `\\textit{Collecting sentiment\\dots needs a minute of live chat.}`;

  // --- tables ---
  const platRows = Object.entries(s.byPlatform)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([p, v]) => `${tex(p[0]!.toUpperCase() + p.slice(1))} & ${n0(v)} \\\\`)
    .join("\n");

  const streamRows = s.channels
    .slice(0, 10)
    .map((c) => `${tex(c.label)} & ${tex(c.platform)} & ${n0(c.count)} \\\\`)
    .join("\n");

  const chatterRows = s.topChatters
    .slice(0, 12)
    .map((c, i) => `${i + 1} & ${tex(c.name)} & ${tex(c.platform)} & ${n0(c.count)} & ${f1(c.perMin)} \\\\`)
    .join("\n");

  const cashRows = s.cashtags.length
    ? s.cashtags
        .slice(0, 10)
        .map((c) => `\\$${tex(c.symbol)} & ${n0(c.count)} \\\\`)
        .join("\n")
    : "\\multicolumn{2}{l}{\\textit{none mentioned}} \\\\";

  const emoteRows = s.emotes.length
    ? s.emotes
        .slice(0, 12)
        .map((e) => `${tex(e.name)} & ${n0(e.count)} \\\\`)
        .join("\n")
    : "\\multicolumn{2}{l}{\\textit{none seen}} \\\\";

  const sub = `${tex(scopeLabel)} \\quad\\textbullet\\quad Range ${tex(rangeLabel)} \\quad\\textbullet\\quad Generated ${tex(stamp(s.now))} \\quad\\textbullet\\quad Session start ${tex(clock(s.startedAt))}${s.durable ? " \\quad\\textbullet\\quad durable history" : ""}`;
  const flourish = s.streamerName ? tex(s.streamerName) : "Read the Tape";
  const sentCol = net >= 0.15 ? "green" : net <= -0.15 ? "red" : "mut";
  const subhead = (t: string) => `{\\dfont\\bfseries\\large ${t}}`;

  return `${themePre(true)}

${masthead("Market Bubble", "Stream Intel", sub, flourish)}

\\begin{statcard}
{\\setlength{\\tabcolsep}{0pt}\\noindent\\begin{tabular}{@{}*{5}{c}@{}}
\\makebox[0.2\\linewidth][c]{\\dfont\\bfseries\\fontsize{21}{23}\\selectfont\\color{gold}\\strut ${n0(s.sessionTotal)}} &
\\makebox[0.2\\linewidth][c]{\\dfont\\bfseries\\fontsize{21}{23}\\selectfont\\strut ${f1(s.perMin)}} &
\\makebox[0.2\\linewidth][c]{\\dfont\\bfseries\\fontsize{21}{23}\\selectfont\\strut ${n0(s.peakPerMin)}} &
\\makebox[0.2\\linewidth][c]{\\dfont\\bfseries\\fontsize{21}{23}\\selectfont\\strut ${n0(s.chatters)}} &
\\makebox[0.2\\linewidth][c]{\\dfont\\bfseries\\fontsize{21}{23}\\selectfont\\color{${sentCol}}\\strut ${sentWord}} \\\\[3pt]
\\makebox[0.2\\linewidth][c]{\\eyebrow{Messages}} & \\makebox[0.2\\linewidth][c]{\\eyebrow{Msgs/min}} & \\makebox[0.2\\linewidth][c]{\\eyebrow{Peak/min}} & \\makebox[0.2\\linewidth][c]{\\eyebrow{Chatters}} & \\makebox[0.2\\linewidth][c]{\\eyebrow{Sentiment}} \\\\
\\end{tabular}}
\\end{statcard}

\\vspace{12pt}
${subhead("Chat activity")}\\\\[-1pt]
{\\color{mut}\\small ${n0(s.total)} messages in range \\textbullet{} ${n0(Math.round(s.bucketMs / 1000))}s buckets}\\\\[4pt]
${activityChart}

\\vspace{18pt}
${subhead("Chat sentiment over time")}\\\\[6pt]
${sentChart}

\\vspace{12pt}
\\begin{minipage}[t]{0.48\\linewidth}
${subhead("By platform")}\\\\[3pt]
\\begin{tabular}{@{}lr@{}}\\toprule Platform & Msgs \\\\\\midrule
${platRows}
\\bottomrule\\end{tabular}

\\vspace{10pt}
${subhead("Trending cashtags")}\\\\[3pt]
\\begin{tabular}{@{}lr@{}}\\toprule Symbol & Mentions \\\\\\midrule
${cashRows}
\\bottomrule\\end{tabular}

\\vspace{10pt}
${subhead("Top emotes")}\\\\[3pt]
\\begin{tabular}{@{}lr@{}}\\toprule Emote & Uses \\\\\\midrule
${emoteRows}
\\bottomrule\\end{tabular}
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.48\\linewidth}
${subhead("Busiest streams")}\\\\[3pt]
\\begin{tabular}{@{}llr@{}}\\toprule Stream & Platform & Msgs \\\\\\midrule
${streamRows}
\\bottomrule\\end{tabular}

\\vspace{10pt}
${subhead("Top chatters")}\\\\[3pt]
\\begin{tabular}{@{}rllrr@{}}\\toprule \\# & Chatter & Plat. & Msgs & /min \\\\\\midrule
${chatterRows}
\\bottomrule\\end{tabular}
\\end{minipage}

${mbFooter("Stream Intel")}
\\end{document}
`;
}

/** Compile arbitrary LaTeX to a PDF buffer via pdflatex. Throws on failure. */
export async function compileLatex(tex: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "mb-report-"));
  const texPath = join(dir, "report.tex");
  const pdfPath = join(dir, "report.pdf");
  try {
    await writeFile(texPath, tex, "utf8");
    await runPdflatex(dir, texPath);
    return await readFile(pdfPath);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Render + compile an analytics snapshot to a PDF. */
export const compileReport = (s: StatsSnapshot): Promise<Buffer> => compileLatex(renderReport(s));

interface BriefAsset {
  symbol?: string;
  name?: string;
  kind?: string;
  price?: number;
  dailyOpen?: number;
  weekOpen?: number;
  monthOpen?: number;
  yearOpen?: number;
}
interface BriefMarket {
  question?: string;
  yes?: number;
  category?: string;
}

/** A "Market Brief" PDF of the current market state — for showing on stream. */
export function renderMarketBrief(payload: { assets?: BriefAsset[]; markets?: BriefMarket[] }): string {
  const assets = Array.isArray(payload?.assets) ? payload.assets : [];
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  // coerce every numeric field — a non-numeric body value must not emit "NaN" into LaTeX
  const pct = (open: number | undefined, price: number) => {
    const o = Number(open);
    return Number.isFinite(o) && o !== 0 ? ((price - o) / o) * 100 : 0;
  };
  const fmtPct = (raw: number) => {
    const v = Number.isFinite(raw) ? raw : 0;
    return `\\textcolor{${v >= 0 ? "green" : "red"}}{${v >= 0 ? "+" : ""}${v.toFixed(1)}\\%}`;
  };
  const fmtNum = (v: number) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const subhead = (t: string) => `{\\dfont\\bfseries\\large ${t}}`;
  const row = (a: BriefAsset) => {
    const price = Number(a.price) || 0;
    return `${tex(a.symbol)} & ${tex((a.name ?? "").slice(0, 22))} & ${fmtNum(price)} & ${fmtPct(pct(a.dailyOpen, price))} & ${fmtPct(pct(a.weekOpen, price))} & ${fmtPct(pct(a.monthOpen, price))} & ${fmtPct(pct(a.yearOpen, price))} \\\\`;
  };
  const table = (title: string, list: BriefAsset[]) =>
    list.length
      ? `${subhead(title)}\\\\[3pt]
\\begin{tabular}{@{}ll r r r r r@{}}\\toprule Sym & Name & Price & 1D & 1W & 1M & YTD \\\\\\midrule
${list.map(row).join("\n")}
\\bottomrule\\end{tabular}

\\vspace{12pt}
`
      : "";
  const mkts = markets
    .slice(0, 12)
    .map((m) => `${tex((m.question ?? "").slice(0, 80))} & ${tex(m.category ?? "")} & ${Math.round((Number(m.yes) || 0) * 100)}\\% \\\\`)
    .join("\n");

  return `${themePre(false)}

${masthead("Market Bubble", "Market Brief", `Snapshot ${tex(stamp(Date.now()))} \\quad\\textbullet\\quad performance is since each period's open (day / week / month / year)`, "Eyes on the Tape")}

${table("Crypto", assets.filter((a) => a.kind !== "macro"))}${table("Macro", assets.filter((a) => a.kind === "macro"))}${
    markets.length
      ? `${subhead("Prediction markets — Polymarket")}\\\\[3pt]
\\begin{tabular}{@{}p{0.66\\linewidth}l r@{}}\\toprule Market & Category & YES \\\\\\midrule
${mkts}
\\bottomrule\\end{tabular}`
      : ""
  }

${mbFooter("Market Brief")}
\\end{document}
`;
}

const money = (v: number) => "\\$" + Math.round(Number(v) || 0).toLocaleString("en-US");
const signPct = (v: number) => {
  const x = Number(v) || 0;
  return `${x >= 0 ? "+" : ""}${x.toFixed(1)}\\%`;
};
const dayLong = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric" });
const dayShort = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
const hexBody = (c: string) => {
  const h = (c || "").replace("#", "").trim();
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : "20281F";
};

/**
 * The branded "Portfolio Performance" report — grouped value bars per sample
 * date with %-return labels, plus a stat-card rail (TOTAL RETURN / per-basket
 * return / SPREAD). This is the exact template the stream shares.
 */
export function renderPortfolioReport(perf: PortfolioPerformance): string {
  const { series, sampleTimes, startedAt, now, spread, missing } = perf;
  const subhead = (t: string) => `{\\dfont\\bfseries\\large ${t}}`;
  const range = `${dayLong(startedAt)} \\textemdash\\ ${dayLong(now)}, ${new Date(now).getFullYear()}`;
  const flourish = series.find((s) => s.tagline)?.tagline ?? "Never Fade Ansem";

  if (series.length === 0 || sampleTimes.length < 2) {
    return `${themePre(false, true)}
${masthead("Market Bubble", "Portfolio Performance", range, flourish)}
{\\color{mut}\\large No portfolios to chart yet — add trade calls in the Portfolio tracker.}
${mbFooter("Portfolio Intel")}
\\end{document}
`;
  }

  // per-series color macros
  const colorDefs = series.map((s, i) => `\\definecolor{pcol${i}}{HTML}{${hexBody(s.color)}}`).join("\n");

  // y-axis in $K, zero-baselined (honest bar heights) with headroom for the % labels
  const allVals = series.flatMap((s) => s.points.map((p) => p.value / 1000));
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);
  const ymin = 0;
  const ymax = Math.ceil((hi + (hi - lo) * 0.16) / 5) * 5 || 5;
  // a "nice" tick step (~5-6 ticks) so labels never crowd/collide
  const rawStep = ymax / 6;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const ytickStep = [1, 2, 5, 10, 20, 50, 100].map((m) => m * mag).find((s) => s >= rawStep) ?? 100 * mag;
  const cols = sampleTimes.length;
  // bars sized to fill each group comfortably — thicker than the old 54/n which
  // collapsed to ~5pt for a 7-date × 2-series chart. Verified not to overlap up
  // to ~8 dates × 2 series at this chart width.
  const barW = Math.max(9, Math.min(30, Math.round(210 / (cols * Math.max(1, series.length)))));
  const xtick = sampleTimes.map((_, i) => i + 1).join(",");
  const xticklabels = sampleTimes.map((t) => `{${dayShort(t)}}`).join(",");

  const plots = series
    .map((s, i) => {
      const coords = s.points.map((p, j) => `(${j + 1},${(p.value / 1000).toFixed(2)})[${signPct(p.returnPct)}]`).join(" ");
      return `\\addplot[ybar, fill=pcol${i}, draw=pcol${i}!85,
  point meta=explicit symbolic, nodes near coords,
  nodes near coords style={font=\\tiny\\bfseries, color=pcol${i}, /pgf/number format/assume math mode=true, anchor=south, yshift=1pt}]
  coordinates {${coords}};`;
    })
    .join("\n");
  const legend = series.map((s) => `${tex(s.name)}`).join(", ");

  const chart = `\\begin{tikzpicture}
\\begin{axis}[
  ybar, bar width=${barW}pt, width=\\linewidth, height=10.4cm, clip=false,
  ymin=${ymin}, ymax=${ymax}, ytick distance=${ytickStep},
  enlarge x limits=false, xmin=${cols <= 3 ? 0.4 : 0.45}, xmax=${(cols + (cols <= 3 ? 0.6 : 0.55)).toFixed(2)},
  axis lines=left, ymajorgrids, major grid style={line, draw=line},
  ylabel={Value (\\$K)}, ylabel style={font=\\scriptsize\\color{mut}},
  scaled y ticks=false, yticklabel={\\$\\pgfmathprintnumber[fixed,precision=0]{\\tick}K},
  yticklabel style={font=\\scriptsize\\color{mut}}, tick align=outside, tick style={draw=line},
  xtick={${xtick}}, xticklabels={${xticklabels}}, xticklabel style={font=\\scriptsize\\bfseries\\color{ink}},
  legend style={font=\\scriptsize, draw=line, at={(0.5,1.04)}, anchor=south, legend columns=-1, /tikz/every even column/.append style={column sep=8pt}},
]
${plots}
\\legend{${legend}}
\\end{axis}
\\end{tikzpicture}`;

  // stat-card rail
  const cards = series
    .map((s, i) => {
      const col = s.finalReturnPct >= 0 ? "green" : "red";
      return `\\noindent\\textcolor{pcol${i}}{\\rule{9pt}{9pt}}\\hspace{4pt}{\\dfont\\bfseries\\small ${tex(s.name)}}\\\\[1pt]
{\\color{mut}\\scriptsize ${s.holdings.map(tex).join(" \\textbullet\\ ")}}\\\\[3pt]
{\\dfont\\bfseries\\fontsize{23}{25}\\selectfont\\color{${col}}${signPct(s.finalReturnPct)}}\\\\[1pt]
{\\color{mut}\\scriptsize ${money(s.finalValue)}}\\\\[10pt]`;
    })
    .join("\n");

  const spreadBlock = spread
    ? `{\\color{line}\\rule{\\linewidth}{0.6pt}}\\\\[6pt]
\\eyebrow{Spread}\\\\[3pt]
{\\dfont\\bfseries\\itshape\\fontsize{19}{21}\\selectfont\\color{gold}${spread.usd >= 0 ? "+" : "-"}${money(Math.abs(spread.usd))}}\\\\[1pt]
{\\color{mut}\\scriptsize ${tex(spread.leaderName)} over ${tex(spread.laggardName)} \\textbullet\\ ${signPct(spread.pct)}}`
    : "";

  const missingNote = missing.length
    ? `\\\\[6pt]{\\color{mut}\\scriptsize\\itshape Price history unavailable: ${tex(missing.join(", "))}}`
    : "";

  return `${themePre(true, true)}
${colorDefs}

${masthead("Market Bubble", "Portfolio Performance", range, flourish)}

\\noindent\\begin{minipage}[t]{0.6\\linewidth}
\\vspace{0pt}
${chart}
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.34\\linewidth}
\\vspace{4pt}
\\begin{statcard}
\\eyebrow{Total Return}\\\\[2pt]
{\\color{mut}\\scriptsize ${dayShort(startedAt)} \\textrightarrow\\ ${dayShort(now)}}\\\\[8pt]
${cards}
${spreadBlock}
\\end{statcard}
\\end{minipage}

\\vspace{6pt}
{\\color{mut}\\footnotesize Each basket starts at ${money(series[0]!.startingCapital)}, allocated across its calls; bars show basket value at each date, labels show total return.${""}}${missingNote}

${mbFooter("Portfolio Intel")}
\\end{document}
`;
}

/** Render + compile a portfolio performance report to a PDF. */
export const compilePortfolioReport = (perf: PortfolioPerformance): Promise<Buffer> =>
  compileLatex(renderPortfolioReport(perf));

/** Locate a pdflatex binary: explicit env → common TeX install paths → PATH.
 * MacTeX/TeX Live install to /Library/TeX/texbin (macOS), which is routinely
 * absent from a GUI/dev server's PATH — so probe known locations before we give
 * up and (wrongly) report TeX as "not installed" when it actually is. */
function resolvePdflatex(): string {
  if (process.env.PDFLATEX_BIN) return process.env.PDFLATEX_BIN;
  const candidates = [
    "/Library/TeX/texbin/pdflatex", // macOS MacTeX / BasicTeX
    "/opt/homebrew/bin/pdflatex", // Homebrew (Apple silicon)
    "/usr/local/bin/pdflatex", // Homebrew (Intel) / manual
    "/usr/bin/pdflatex", // Linux distro packages
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "pdflatex"; // last resort: rely on PATH
}

function runPdflatex(dir: string, texPath: string): Promise<void> {
  return new Promise((res, rej) => {
    const bin = resolvePdflatex();
    const args = ["-interaction=nonstopmode", "-halt-on-error", `-output-directory=${dir}`, texPath];
    // put pdflatex's own bin dir on PATH so it can find its sibling tools (kpsewhich, etc.)
    const env = bin.includes("/")
      ? { ...process.env, PATH: `${dirname(bin)}${delimiter}${process.env.PATH ?? ""}` }
      : process.env;
    const child = spawn(bin, args, { cwd: dir, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const killer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(killer);
      if (e.code === "ENOENT")
        rej(new Error("pdflatex not found — install a TeX distribution (MacTeX/TeX Live), or set PDFLATEX_BIN to its path"));
      else rej(e);
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) return res();
      logger.warn({ tail: out.slice(-1200) }, "pdflatex failed");
      rej(new Error("LaTeX compilation failed"));
    });
  });
}
