#!/usr/bin/env node
/**
 * bench/report.mjs — turn results/*.json into the leaderboard: SVG charts + the Pages site.
 *
 *   node bench/report.mjs
 *
 * Charts are hand-authored SVG with no dependencies, emitted twice (light and dark) so the
 * README can serve the right one with <picture>. Every number on every chart comes from a
 * committed result file; nothing here is illustrative.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPARTMENTS, CHAIRS } from './positions/index.mjs';
import { siteHtml } from './site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const RESULTS = path.join(ROOT, 'results');
const DOCS = path.join(ROOT, 'docs');
const ASSETS = path.join(DOCS, 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

/* ─────────────────────────── palettes ─────────────────────────── */

const LIGHT = {
  name: 'light',
  paper: '#FAF9F5', panel: '#FFFFFF', ink: '#16150F', muted: '#6B6759',
  rule: '#E4E0D5', accent: '#A8461F', danger: '#B3341C',
  ramp: ['#E7E1D4', '#CFD6C6', '#A9C0AE', '#6E9C84', '#376856'],
  rampInk: ['#5C564A', '#4A5344', '#25382D', '#FFFFFF', '#FFFFFF'],
};
const DARK = {
  name: 'dark',
  paper: '#100F0C', panel: '#17160F', ink: '#EDEAE0', muted: '#8E8A7C',
  rule: '#2B2922', accent: '#D9743F', danger: '#E0603F',
  ramp: ['#26241E', '#2F3A31', '#3F5F4D', '#5A9179', '#8ECCAC'],
  rampInk: ['#8E8A7C', '#A9BDAE', '#DCEDE3', '#0F1A14', '#0C1710'],
};

const step = pct => (pct >= 90 ? 4 : pct >= 75 ? 3 : pct >= 50 ? 2 : pct >= 25 ? 1 : 0);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FONT = "ui-sans-serif, -apple-system, 'Segoe UI', Inter, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

/* ─────────────────────────── data ─────────────────────────── */

function load() {
  if (!fs.existsSync(RESULTS)) return [];
  return fs.readdirSync(RESULTS)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')); } catch { return null; } })
    .filter(r => r && r.chairs && r.placement)
    // An incomplete run has no defensible reading. It stays in results/ and off the leaderboard.
    .filter(r => !r.placement.incomplete)
    .sort((a, b) => b.placement.overall - a.placement.overall);
}

const trapChecksOf = r => Object.entries(r.chairs).flatMap(([id, ch]) =>
  (ch.checks ?? []).filter(c => /^TRAP/.test(c.label)).map(c => ({ chair: id, label: c.label.replace(/^TRAP /, ''), pass: c.pass })));

/* ─────────────────────────── chart 1: the matrix ─────────────────────────── */

function matrixSvg(rows, P) {
  const CELL = 23, GAP = 2, DGAP = 14, LEFT = 208, TOP = 62, ROWH = 26;
  const groups = DEPARTMENTS.map(d => ({ d, chairs: CHAIRS.filter(c => c.dept === d.id) }))
    .filter(g => g.chairs.length);

  // x position of every chair column
  const xs = {}; let x = LEFT;
  for (const g of groups) {
    g.x0 = x;
    for (const c of g.chairs) { xs[c.id] = x; x += CELL + GAP; }
    g.x1 = x - GAP; x += DGAP;
  }
  const gridW = x - DGAP - LEFT;
  const W = LEFT + gridW + 26;
  const labelH = 118;
  const H = TOP + rows.length * ROWH + labelH + 44;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  out.push(`<rect width="${W}" height="${H}" fill="${P.paper}"/>`);

  out.push(`<text x="20" y="26" font-size="13" font-weight="600" fill="${P.ink}" letter-spacing=".02em">Company Bench — every chair, every candidate</text>`);
  out.push(`<text x="20" y="43" font-size="10.5" fill="${P.muted}">Score per chair. A red corner means the candidate took a planted trap.</text>`);

  // department headers + bracket rules
  for (const g of groups) {
    const mid = (g.x0 + g.x1) / 2;
    out.push(`<text x="${mid}" y="${TOP - 12}" font-size="9" font-weight="600" text-anchor="middle" fill="${P.muted}" letter-spacing=".14em">${esc(g.d.label.toUpperCase())}</text>`);
    out.push(`<line x1="${g.x0}" y1="${TOP - 6}" x2="${g.x1}" y2="${TOP - 6}" stroke="${P.rule}" stroke-width="1"/>`);
  }

  // rows
  rows.forEach((r, i) => {
    const y = TOP + i * ROWH;
    const p = r.placement;
    out.push(`<text x="${LEFT - 12}" y="${y + 15}" font-size="11" text-anchor="end" fill="${P.ink}">${esc(r.candidate.name)}</text>`);
    out.push(`<text x="${LEFT - 12}" y="${y + 15}" font-size="11" text-anchor="end" fill="${P.ink}" opacity="0"/>`);
    // vendor + level as a quiet second line is too tall for one row; put the level as a chip on the left edge
    out.push(`<rect x="6" y="${y + 4}" width="26" height="15" rx="3" fill="${P.ramp[step(p.level === 'L3' ? 95 : p.level === 'L2' ? 80 : p.level === 'L1' ? 55 : 20)]}"/>`);
    out.push(`<text x="19" y="${y + 15}" font-size="9" font-weight="700" text-anchor="middle" font-family="${MONO}" fill="${P.rampInk[step(p.level === 'L3' ? 95 : p.level === 'L2' ? 80 : p.level === 'L1' ? 55 : 20)]}">${p.level}</text>`);

    for (const c of CHAIRS) {
      const cell = r.chairs[c.id];
      const cx = xs[c.id];
      if (!cell) {
        out.push(`<rect x="${cx}" y="${y + 2}" width="${CELL}" height="${CELL - 2}" rx="2.5" fill="none" stroke="${P.rule}" stroke-width="1" stroke-dasharray="2 2"/>`);
        continue;
      }
      const s = step(cell.pct);
      out.push(`<rect x="${cx}" y="${y + 2}" width="${CELL}" height="${CELL - 2}" rx="2.5" fill="${P.ramp[s]}"/>`);
      out.push(`<text x="${cx + CELL / 2}" y="${y + 15.5}" font-size="8.5" text-anchor="middle" font-family="${MONO}" fill="${P.rampInk[s]}">${cell.pct}</text>`);
      const trapped = (cell.checks ?? []).some(ch => !ch.pass && /^TRAP/.test(ch.label));
      if (trapped) out.push(`<path d="M${cx + CELL - 6.5} ${y + 2} L${cx + CELL} ${y + 2} L${cx + CELL} ${y + 8.5} Z" fill="${P.danger}"/>`);
    }
  });

  // chair labels, rotated
  const labelY = TOP + rows.length * ROWH + 8;
  for (const c of CHAIRS) {
    const cx = xs[c.id] + CELL / 2;
    out.push(`<text x="${cx}" y="${labelY}" font-size="9.5" fill="${P.muted}" font-family="${MONO}" transform="rotate(-52 ${cx} ${labelY})" text-anchor="end">${esc(c.id)}</text>`);
  }

  // legend
  const ly = H - 20;
  out.push(`<text x="20" y="${ly + 4}" font-size="9.5" fill="${P.muted}">score</text>`);
  const bands = ['0–24', '25–49', '50–74', '75–89', '90–100'];
  bands.forEach((b, i) => {
    const bx = 58 + i * 62;
    out.push(`<rect x="${bx}" y="${ly - 8}" width="16" height="13" rx="2.5" fill="${P.ramp[i]}"/>`);
    out.push(`<text x="${bx + 21}" y="${ly + 3}" font-size="9.5" fill="${P.muted}" font-family="${MONO}">${b}</text>`);
  });
  const tx = 58 + 5 * 62 + 8;
  out.push(`<path d="M${tx} ${ly - 8} L${tx + 10} ${ly - 8} L${tx + 10} ${ly + 2} Z" fill="${P.danger}"/>`);
  out.push(`<text x="${tx + 16}" y="${ly + 3}" font-size="9.5" fill="${P.muted}">trap taken</text>`);

  out.push('</svg>');
  return out.join('\n');
}

/* ─────────────────────── chart 2: which traps catch agents ─────────────────────── */

function trapsSvg(rows, P) {
  const tally = new Map();
  for (const r of rows) {
    for (const t of trapChecksOf(r)) {
      const k = `${t.chair}||${t.label}`;
      const e = tally.get(k) ?? { chair: t.chair, label: t.label, took: 0, n: 0 };
      e.n++; if (!t.pass) e.took++;
      tally.set(k, e);
    }
  }
  const all = [...tally.values()].filter(e => e.n >= Math.max(2, rows.length - 1))
    .map(e => ({ ...e, rate: e.took / e.n }))
    .sort((a, b) => b.rate - a.rate);
  const list = all.slice(0, 14);

  const LEFT = 330, BARW = 300, ROWH = 25, TOP = 66;
  const W = LEFT + BARW + 66, H = TOP + list.length * ROWH + 34;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  out.push(`<rect width="${W}" height="${H}" fill="${P.paper}"/>`);
  out.push(`<text x="20" y="26" font-size="13" font-weight="600" fill="${P.ink}">The traps that catch the most agents</text>`);
  out.push(`<text x="20" y="43" font-size="10.5" fill="${P.muted}">Share of ${rows.length} tested candidates that took each planted wrong answer.</text>`);

  // axis
  for (let p = 0; p <= 100; p += 25) {
    const gx = LEFT + (p / 100) * BARW;
    out.push(`<line x1="${gx}" y1="${TOP - 10}" x2="${gx}" y2="${TOP + list.length * ROWH - 6}" stroke="${P.rule}" stroke-width="1"/>`);
    out.push(`<text x="${gx}" y="${TOP - 16}" font-size="9" text-anchor="middle" fill="${P.muted}" font-family="${MONO}">${p}%</text>`);
  }

  list.forEach((e, i) => {
    const y = TOP + i * ROWH;
    const w = Math.max(2, e.rate * BARW);
    out.push(`<text x="${LEFT - 10}" y="${y + 11}" font-size="10" text-anchor="end" fill="${P.ink}">${esc(e.label.length > 52 ? e.label.slice(0, 51) + '…' : e.label)}</text>`);
    out.push(`<text x="${LEFT - 10}" y="${y + 22}" font-size="8.5" text-anchor="end" fill="${P.muted}" font-family="${MONO}">${esc(e.chair)}</text>`);
    out.push(`<rect x="${LEFT}" y="${y + 2}" width="${w}" height="14" rx="2" fill="${e.rate >= 0.5 ? P.danger : P.accent}" opacity="${0.35 + 0.55 * e.rate}"/>`);
    out.push(`<text x="${LEFT + w + 8}" y="${y + 13}" font-size="9.5" fill="${P.muted}" font-family="${MONO}">${e.took}/${e.n}</text>`);
  });

  out.push('</svg>');
  return out.join('\n');
}

/* ─────────────────────── chart 3: the trust ladder ─────────────────────── */

function ladderSvg(rows, P) {
  const LEVELS = [
    { id: 'L3', name: 'Reviewer', rule: 'May gate other agents’ output and hold irreversible authority.' },
    { id: 'L2', name: 'Unattended operator', rule: 'Runs alone on reversible work. Stops dead at anything irreversible.' },
    { id: 'L1', name: 'Gated worker', rule: 'Runs a defined task. Every output passes a gate it does not control.' },
    { id: 'L0', name: 'Drafter', rule: 'Produces drafts. Everything it emits is read before it ships.' },
  ];
  const W = 900, BANDH = 92, TOP = 60;
  const H = TOP + LEVELS.length * BANDH + 26;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  out.push(`<rect width="${W}" height="${H}" fill="${P.paper}"/>`);
  out.push(`<text x="20" y="26" font-size="13" font-weight="600" fill="${P.ink}">Where each candidate landed</text>`);
  out.push(`<text x="20" y="43" font-size="10.5" fill="${P.muted}">A rung is earned only by clearing every rung below it. Two chairs are pass/fail at 100%.</text>`);

  LEVELS.forEach((L, i) => {
    const y = TOP + i * BANDH;
    const s = [4, 3, 2, 0][i];
    out.push(`<line x1="20" y1="${y}" x2="${W - 20}" y2="${y}" stroke="${P.rule}" stroke-width="1"/>`);
    out.push(`<rect x="20" y="${y + 14}" width="30" height="18" rx="3" fill="${P.ramp[s]}"/>`);
    out.push(`<text x="35" y="${y + 27}" font-size="10" font-weight="700" text-anchor="middle" font-family="${MONO}" fill="${P.rampInk[s]}">${L.id}</text>`);
    out.push(`<text x="60" y="${y + 27}" font-size="12" font-weight="600" fill="${P.ink}">${esc(L.name)}</text>`);
    out.push(`<text x="60" y="${y + 43}" font-size="10" fill="${P.muted}">${esc(L.rule)}</text>`);

    const here = rows.filter(r => r.placement.level === L.id);
    let cx = 60;
    let cy = y + 58;
    if (!here.length) {
      out.push(`<text x="60" y="${cy + 11}" font-size="10" fill="${P.muted}" font-style="italic" opacity=".75">no candidate reached this rung</text>`);
    }
    for (const r of here) {
      const label = r.candidate.name;
      const w = 16 + label.length * 6.1;
      if (cx + w > W - 30) { cx = 60; cy += 22; }
      out.push(`<rect x="${cx}" y="${cy}" width="${w}" height="19" rx="9.5" fill="none" stroke="${P.ink}" stroke-width="1" opacity=".38"/>`);
      out.push(`<text x="${cx + w / 2}" y="${cy + 13}" font-size="10" text-anchor="middle" fill="${P.ink}">${esc(label)}</text>`);
      cx += w + 8;
    }
  });
  out.push('</svg>');
  return out.join('\n');
}


/* ─────────────────── chart 4: department profile (lines + numbers) ─────────────────── */

function profileSvg(rows, P) {
  const depts = DEPARTMENTS.filter(d => rows.some(r => r.placement.dept[d.id] !== undefined));
  const LEFT = 64, RIGHT = 214, TOP = 74, H_PLOT = 300;
  const W = LEFT + (depts.length - 1) * 132 + RIGHT;
  const H = TOP + H_PLOT + 74;
  const x = i => LEFT + i * ((W - LEFT - RIGHT) / Math.max(1, depts.length - 1));
  const y = v => TOP + H_PLOT - (v / 100) * H_PLOT;
  const line = ['#E0873F', '#6FB295', '#7FA8D9', '#C98BC0', '#D9B65A', '#8C8878'];

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  out.push(`<rect width="${W}" height="${H}" fill="${P.paper}"/>`);
  out.push(`<text x="20" y="28" font-size="13.5" font-weight="600" fill="${P.ink}">Where each model is strong, and where it breaks</text>`);
  out.push(`<text x="20" y="46" font-size="10.5" fill="${P.muted}">Department score, 0-100. The SHAPE matters more than the height: a flat-but-lower line is a safer hire than a spiky one.</text>`);

  // gridlines + y labels
  for (let v = 0; v <= 100; v += 25) {
    out.push(`<line x1="${LEFT}" y1="${y(v)}" x2="${W - RIGHT + 8}" y2="${y(v)}" stroke="${P.rule}" stroke-width="1"${v === 0 ? '' : ' stroke-dasharray="3 4"'}/>`);
    out.push(`<text x="${LEFT - 12}" y="${y(v) + 3.5}" font-size="9.5" text-anchor="end" fill="${P.muted}" font-family="${MONO}">${v}</text>`);
  }
  // the L2 bar most models fail to clear
  out.push(`<line x1="${LEFT}" y1="${y(85)}" x2="${W - RIGHT + 8}" y2="${y(85)}" stroke="${P.accent}" stroke-width="1" stroke-dasharray="5 3" opacity=".65"/>`);
  out.push(`<text x="${W - RIGHT + 12}" y="${y(85) + 3.5}" font-size="9" fill="${P.accent}" font-family="${MONO}">L2 bar</text>`);

  // x labels
  depts.forEach((d, i) => {
    out.push(`<text x="${x(i)}" y="${TOP + H_PLOT + 22}" font-size="10" text-anchor="middle" fill="${P.muted}" letter-spacing=".05em">${esc(d.label)}</text>`);
    out.push(`<line x1="${x(i)}" y1="${TOP}" x2="${x(i)}" y2="${TOP + H_PLOT}" stroke="${P.rule}" stroke-width="1" opacity=".55"/>`);
  });

  rows.forEach((r, ri) => {
    const col = line[ri % line.length];
    const pts = depts.map((d, i) => ({ i, v: r.placement.dept[d.id], x: x(i), y: y(r.placement.dept[d.id] ?? 0) }))
      .filter(p => p.v !== undefined);
    if (pts.length < 2) return;
    out.push(`<polyline fill="none" stroke="${col}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" opacity=".92" points="${pts.map(p => `${p.x},${p.y}`).join(' ')}"/>`);
    for (const p of pts) {
      out.push(`<circle cx="${p.x}" cy="${p.y}" r="3.6" fill="${P.paper}" stroke="${col}" stroke-width="2"/>`);
      out.push(`<text x="${p.x}" y="${p.y - 9}" font-size="8.5" text-anchor="middle" fill="${col}" font-family="${MONO}" font-weight="600">${p.v}</text>`);
    }
    const last = pts[pts.length - 1];
    out.push(`<line x1="${last.x + 6}" y1="${last.y}" x2="${W - RIGHT + 20}" y2="${TOP + 14 + ri * 21}" stroke="${col}" stroke-width="1" opacity=".4"/>`);
    out.push(`<circle cx="${W - RIGHT + 24}" cy="${TOP + 14 + ri * 21}" r="3.4" fill="${col}"/>`);
    out.push(`<text x="${W - RIGHT + 33}" y="${TOP + 17.5 + ri * 21}" font-size="10.5" fill="${P.ink}">${esc(r.candidate.name)}</text>`);
    out.push(`<text x="${W - RIGHT + 33}" y="${TOP + 29 + ri * 21}" font-size="8.5" fill="${P.muted}" font-family="${MONO}">${r.placement.level} · ${r.placement.overall}%${r.tokensPerSecond ? ` · ${r.tokensPerSecond} tok/s` : ''}</text>`);
  });

  out.push('</svg>');
  return out.join('\n');
}

/* ─────────────────────────── markdown leaderboard ─────────────────────────── */

function leaderboardMd(rows) {
  const head = ['| Candidate | Level | Ops | Integrity | Security | Autonomy | People | Treasury | Traps taken |', '|---|---|---|---|---|---|---|---|---|'];
  const body = rows.map(r => {
    const d = r.placement.dept;
    const traps = trapChecksOf(r);
    const took = traps.filter(t => !t.pass).length;
    const cell = v => (v === undefined ? '—' : `${v}%`);
    return `| **${r.candidate.name}**<br><sub>${r.candidate.vendor ?? r.mode}</sub> | \`${r.placement.level}\` | ${cell(d.operations)} | ${cell(d.integrity)} | ${cell(d.security)} | ${cell(d.autonomy)} | ${cell(d.people)} | ${cell(d.treasury)} | ${took}/${traps.length} |`;
  });
  return [...head, ...body].join('\n');
}

/* ─────────────────────────── the Pages site ─────────────────────────── */

/* ─────────────────────────── main ─────────────────────────── */

const rows = load();
if (!rows.length) {
  console.error('\n  No complete results yet. Run: node bench/run.mjs --models <id>\n');
  process.exit(1);
}

const ranked = rows.filter(r => !r.reference);
for (const [k, fn] of [['matrix', matrixSvg], ['traps', trapsSvg], ['ladder', ladderSvg], ['profile', profileSvg]]) {
  fs.writeFileSync(path.join(ASSETS, `${k}-light.svg`), fn(ranked, LIGHT));
  fs.writeFileSync(path.join(ASSETS, `${k}-dark.svg`), fn(ranked, DARK));
}
const totals = {
  checks: CHAIRS.reduce((n, c) => n + c.score('').length, 0),
  traps: CHAIRS.reduce((n, c) => n + c.score('').filter(x => /^TRAP/.test(x.label)).length, 0),
  hard: CHAIRS.reduce((n, c) => n + c.score('').filter(x => /^HARD/.test(x.label)).length, 0),
};
const bare = svg => svg.replace(/^<\?xml[^>]*\?>\s*/, '');
fs.writeFileSync(path.join(DOCS, 'index.html'), siteHtml(rows, {
  totals,
  charts: { trapsLight: bare(trapsSvg(ranked, LIGHT)), trapsDark: bare(trapsSvg(ranked, DARK)),
    profileLight: bare(profileSvg(ranked, LIGHT)), profileDark: bare(profileSvg(ranked, DARK)) },
}));
// Machine-readable endpoints. An agent pointed at the page should not have to parse HTML, and a
// crawler cannot read a chart — so every number in the SVGs also exists here as data.
fs.writeFileSync(path.join(DOCS, 'results.json'), JSON.stringify({
  benchmark: 'Company Bench',
  url: 'https://lordbasilaiassistant-sudo.github.io/company-bench/',
  repository: 'https://github.com/lordbasilaiassistant-sudo/company-bench',
  generated: new Date().toISOString(),
  chairs: CHAIRS.length,
  departments: DEPARTMENTS.map(d => d.id),
  checks: CHAIRS.reduce((n, c) => n + c.score('').length, 0),
  traps: CHAIRS.reduce((n, c) => n + c.score('').filter(x => /^TRAP/.test(x.label)).length, 0),
  scoring: 'deterministic; no LLM judge',
  trustLevels: { L0: 'drafter', L1: 'gated worker', L2: 'unattended operator', L3: 'reviewer' },
  results: ranked.map(r => ({
    model: r.candidate.name, provider: r.candidate.vendor ?? null, modelId: r.candidate.model ?? r.candidate.id,
    trustLevel: r.placement.level, overall: r.placement.overall,
    departments: r.placement.dept, flags: r.placement.flags.map(f => f.label),
    trapsTaken: trapChecksOf(r).filter(t => !t.pass).length, trapsTotal: trapChecksOf(r).length,
    tokensPerSecond: r.tokensPerSecond ?? null, mode: r.mode, measured: r.when.slice(0, 10),
  })),
}, null, 2));

const csvHead = ['model', 'provider', 'trust_level', 'overall', ...DEPARTMENTS.map(d => d.id), 'traps_taken', 'traps_total', 'tokens_per_second', 'measured'];
fs.writeFileSync(path.join(DOCS, 'leaderboard.csv'), [csvHead.join(','), ...ranked.map(r => [
  `"${r.candidate.name}"`, `"${r.candidate.vendor ?? ''}"`, r.placement.level, r.placement.overall,
  ...DEPARTMENTS.map(d => r.placement.dept[d.id] ?? ''),
  trapChecksOf(r).filter(t => !t.pass).length, trapChecksOf(r).length,
  r.tokensPerSecond ?? '', r.when.slice(0, 10),
].join(','))].join('\n') + '\n');

// llms.txt is only useful if it is actually served
try { fs.copyFileSync(path.join(ROOT, 'llms.txt'), path.join(DOCS, 'llms.txt')); } catch {}

const table = leaderboardMd(ranked);
fs.writeFileSync(path.join(RESULTS, 'LEADERBOARD.md'), table + '\n');

// keep the README table in sync with the committed results
const readmePath = path.join(ROOT, 'README.md');
if (fs.existsSync(readmePath)) {
  const md = fs.readFileSync(readmePath, 'utf8');
  const note = `\n_${rows.length} candidate${rows.length === 1 ? '' : 's'}, measured ${new Date().toISOString().slice(0, 10)} at temperature 0. `
    + `Full cards in [\`results/cards/\`](results/cards/); raw model output is inside each \`results/*.json\`._\n`;
  const next = md.replace(
    /<!-- LEADERBOARD:START -->[\s\S]*?<!-- LEADERBOARD:END -->/,
    `<!-- LEADERBOARD:START -->\n${table}\n${note}<!-- LEADERBOARD:END -->`);
  if (next !== md) fs.writeFileSync(readmePath, next);
}

console.log(`\n  Report built from ${rows.length} result(s)\n`);
for (const r of rows) console.log(`    ${r.placement.level}  ${String(r.placement.overall).padStart(3)}%  ${r.candidate.name}${r.candidate.vendor ? ` · ${r.candidate.vendor}` : ''}`);
console.log(`\n    docs/index.html · docs/assets/*.svg · results/LEADERBOARD.md\n`);
