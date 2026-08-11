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

function siteHtml(rows) {
  const chartLight = { matrix: matrixSvg(rows, LIGHT), traps: trapsSvg(rows, LIGHT), ladder: ladderSvg(rows, LIGHT) };
  const chartDark = { matrix: matrixSvg(rows, DARK), traps: trapsSvg(rows, DARK), ladder: ladderSvg(rows, DARK) };
  const bare = svg => svg.replace(/^<\?xml[^>]*\?>\s*/, '');
  const dual = k => `<div class="chart"><div class="only-light">${bare(chartLight[k])}</div><div class="only-dark">${bare(chartDark[k])}</div></div>`;

  const cards = rows.map(r => {
    const p = r.placement;
    const traps = trapChecksOf(r).filter(t => !t.pass);
    return `<article class="card">
      <header>
        <div>
          <h3>${esc(r.candidate.name)}</h3>
          <p class="meta">${esc(r.candidate.vendor ?? '')}${r.candidate.vendor ? ' · ' : ''}<code>${esc(r.candidate.model ?? r.candidate.id)}</code>${r.candidate.cost ? ` · ${esc(r.candidate.cost)}` : ''}</p>
        </div>
        <span class="level lv-${p.level}">${p.level}</span>
      </header>
      <dl class="depts">
        ${DEPARTMENTS.filter(d => p.dept[d.id] !== undefined).map(d => `<div><dt>${esc(d.label)}</dt><dd>${p.dept[d.id]}<span>%</span></dd></div>`).join('')}
      </dl>
      ${p.flags.length ? `<ul class="flags">${p.flags.map(f => `<li><b>${esc(f.label)}</b> ${esc(f.why)}</li>`).join('')}</ul>` : '<p class="clean">No disqualifying flags.</p>'}
      ${traps.length ? `<details><summary>${traps.length} trap${traps.length > 1 ? 's' : ''} taken</summary><ul class="traps">${traps.map(t => `<li><code>${esc(t.chair)}</code> ${esc(t.label)}</li>`).join('')}</ul></details>` : ''}
    </article>`;
  }).join('\n');

  const orgChart = DEPARTMENTS.map(d => `<section class="dept">
    <h3>${esc(d.label)}${d.optional ? '<span class="opt">optional</span>' : ''}</h3>
    <p class="q">${esc(d.question)}</p>
    <ul>${d.chairs.map(c => `<li><b>${esc(c.title)}</b> <code>${esc(c.id)}</code><span>${esc(c.blurb)}</span></li>`).join('')}</ul>
  </section>`).join('\n');

  const totalChecks = CHAIRS.reduce((n, c) => n + c.score('').length, 0);
  const totalTraps = CHAIRS.reduce((n, c) => n + c.score('').filter(x => /^TRAP/.test(x.label)).length, 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Company Bench — can your agent hold a job?</title>
<meta name="description" content="A ${CHAIRS.length}-chair benchmark that measures whether an AI agent can be trusted with a job: dirty data, planted lies, prompt injection, irreversible actions, and people. Deterministic scoring, no LLM judge.">
<meta property="og:title" content="Company Bench — can your agent hold a job?">
<meta property="og:description" content="${CHAIRS.length} chairs, ${totalChecks} deterministic checks, ${totalTraps} planted traps. Returns a placement, not a percentage.">
<style>
:root{
  --paper:${LIGHT.paper}; --panel:${LIGHT.panel}; --ink:${LIGHT.ink}; --muted:${LIGHT.muted};
  --rule:${LIGHT.rule}; --accent:${LIGHT.accent}; --danger:${LIGHT.danger};
  --l0:${LIGHT.ramp[0]}; --l1:${LIGHT.ramp[2]}; --l2:${LIGHT.ramp[3]}; --l3:${LIGHT.ramp[4]};
  --l0i:${LIGHT.rampInk[0]}; --l1i:${LIGHT.rampInk[2]}; --l2i:${LIGHT.rampInk[3]}; --l3i:${LIGHT.rampInk[4]};
  --shadow:0 1px 2px rgba(20,18,10,.05), 0 8px 24px -12px rgba(20,18,10,.18);
  --font:${FONT}; --mono:${MONO};
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --paper:${DARK.paper}; --panel:${DARK.panel}; --ink:${DARK.ink}; --muted:${DARK.muted};
  --rule:${DARK.rule}; --accent:${DARK.accent}; --danger:${DARK.danger};
  --l0:${DARK.ramp[0]}; --l1:${DARK.ramp[2]}; --l2:${DARK.ramp[3]}; --l3:${DARK.ramp[4]};
  --l0i:${DARK.rampInk[0]}; --l1i:${DARK.rampInk[2]}; --l2i:${DARK.rampInk[3]}; --l3i:${DARK.rampInk[4]};
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 30px -14px rgba(0,0,0,.7);
}}
:root[data-theme="dark"]{
  --paper:${DARK.paper}; --panel:${DARK.panel}; --ink:${DARK.ink}; --muted:${DARK.muted};
  --rule:${DARK.rule}; --accent:${DARK.accent}; --danger:${DARK.danger};
  --l0:${DARK.ramp[0]}; --l1:${DARK.ramp[2]}; --l2:${DARK.ramp[3]}; --l3:${DARK.ramp[4]};
  --l0i:${DARK.rampInk[0]}; --l1i:${DARK.rampInk[2]}; --l2i:${DARK.rampInk[3]}; --l3i:${DARK.rampInk[4]};
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font);
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.wrap{max-width:1000px;margin:0 auto;padding:0 24px}
a{color:var(--accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb, var(--accent) 30%, transparent)}
a:hover{border-bottom-color:var(--accent)}
code{font-family:var(--mono);font-size:.86em;background:color-mix(in srgb, var(--ink) 6%, transparent);
  padding:.12em .38em;border-radius:3px}
pre{font-family:var(--mono);font-size:13px;line-height:1.65;background:var(--panel);border:1px solid var(--rule);
  border-radius:8px;padding:16px 18px;overflow-x:auto;box-shadow:var(--shadow)}
pre code{background:none;padding:0;font-size:inherit}

/* masthead */
.top{border-bottom:1px solid var(--rule)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:18px}
.brand{display:flex;align-items:baseline;gap:10px;font-weight:640;letter-spacing:-.01em}
.brand .dot{width:9px;height:9px;border-radius:2px;background:var(--accent);display:inline-block}
.top nav{display:flex;gap:20px;font-size:13.5px;color:var(--muted)}
.top nav a{color:inherit;border:0}
.top nav a:hover{color:var(--ink)}

header.hero{padding:76px 0 56px;border-bottom:1px solid var(--rule)}
h1{font-size:clamp(34px,5.2vw,54px);line-height:1.04;letter-spacing:-.028em;margin:0 0 20px;max-width:19ch;font-weight:660}
.lede{font-size:clamp(17px,2vw,19.5px);line-height:1.55;color:var(--muted);max-width:62ch;margin:0}
.lede b{color:var(--ink);font-weight:560}
.stats{display:flex;flex-wrap:wrap;gap:0;margin-top:40px;border:1px solid var(--rule);border-radius:10px;
  overflow:hidden;background:var(--panel);box-shadow:var(--shadow)}
.stats div{flex:1 1 160px;padding:18px 20px;border-right:1px solid var(--rule)}
.stats div:last-child{border-right:0}
.stats b{display:block;font-size:26px;font-weight:600;letter-spacing:-.02em;line-height:1.1}
.stats span{font-size:12px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}

section.band{padding:64px 0;border-bottom:1px solid var(--rule)}
h2{font-size:26px;letter-spacing:-.02em;margin:0 0 8px;font-weight:640}
h2+.sub{color:var(--muted);margin:0 0 32px;max-width:64ch}

.chart{margin:0 0 8px;overflow-x:auto;border:1px solid var(--rule);border-radius:10px;background:var(--panel);
  padding:8px;box-shadow:var(--shadow)}
.chart svg{display:block;max-width:100%;height:auto;min-width:640px}
.caption{font-size:13px;color:var(--muted);margin:12px 0 40px;max-width:70ch}
.only-dark{display:none}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) .only-dark{display:block} :root:not([data-theme="light"]) .only-light{display:none} }
:root[data-theme="dark"] .only-dark{display:block}
:root[data-theme="dark"] .only-light{display:none}

.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.card{border:1px solid var(--rule);border-radius:10px;background:var(--panel);padding:18px 20px;box-shadow:var(--shadow)}
.card header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
.card h3{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em}
.card .meta{margin:3px 0 0;font-size:12px;color:var(--muted)}
.level{font-family:var(--mono);font-size:12px;font-weight:700;padding:4px 9px;border-radius:5px;flex:none}
.lv-L0{background:var(--l0);color:var(--l0i)} .lv-L1{background:var(--l1);color:var(--l1i)}
.lv-L2{background:var(--l2);color:var(--l2i)} .lv-L3{background:var(--l3);color:var(--l3i)}
.depts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 8px;margin:0 0 14px;padding:14px 0;
  border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.depts dt{font-size:10.5px;color:var(--muted);letter-spacing:.03em;text-transform:uppercase}
.depts dd{margin:1px 0 0;font-family:var(--mono);font-size:17px;font-weight:600;letter-spacing:-.02em}
.depts dd span{font-size:11px;color:var(--muted);font-weight:400}
.flags{list-style:none;margin:0;padding:0;font-size:12.5px;line-height:1.5}
.flags li{padding-left:16px;position:relative;color:var(--muted);margin-bottom:7px}
.flags li:before{content:"";position:absolute;left:0;top:7px;width:7px;height:7px;border-radius:50%;background:var(--danger)}
.flags b{color:var(--ink);font-weight:620;letter-spacing:.01em}
.clean{font-size:12.5px;color:var(--muted);margin:0}
details{margin-top:12px;font-size:12.5px}
summary{cursor:pointer;color:var(--muted)}
summary:hover{color:var(--ink)}
.traps{margin:10px 0 0;padding-left:18px;color:var(--muted);line-height:1.55}

.dept{border-top:1px solid var(--rule);padding:22px 0}
.dept h3{margin:0 0 2px;font-size:15px;font-weight:640;display:flex;align-items:center;gap:10px}
.opt{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border:1px solid var(--rule);
  padding:2px 7px;border-radius:20px;font-weight:400}
.dept .q{margin:0 0 14px;color:var(--muted);font-size:13.5px}
.dept ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.dept li{display:grid;grid-template-columns:1fr;gap:2px;padding-left:14px;border-left:2px solid var(--rule)}
.dept li b{font-size:13.5px;font-weight:560}
.dept li code{font-size:11px}
.dept li span{font-size:13px;color:var(--muted)}

.two{display:grid;grid-template-columns:1fr 1fr;gap:28px}
@media (max-width:760px){.two{grid-template-columns:1fr}.depts{grid-template-columns:repeat(2,1fr)}}

.support{border:1px solid var(--rule);border-radius:10px;background:var(--panel);padding:22px 24px;
  display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;box-shadow:var(--shadow)}
.support p{margin:0;font-size:14px;color:var(--muted);max-width:56ch}
.support b{color:var(--ink)}
.btn{display:inline-block;border:1px solid var(--ink);color:var(--ink);padding:9px 17px;border-radius:6px;
  font-size:13.5px;font-weight:550;white-space:nowrap}
.btn:hover{background:var(--ink);color:var(--paper)}
footer{padding:44px 0 64px;color:var(--muted);font-size:13px}
footer a{color:var(--muted)}
</style>
</head>
<body>

<div class="top"><div class="wrap">
  <span class="brand"><span class="dot"></span> Company Bench</span>
  <nav>
    <a href="#results">Results</a>
    <a href="#chairs">The chairs</a>
    <a href="#take">Take it</a>
    <a href="https://github.com/lordbasilaiassistant-sudo/company-bench">GitHub</a>
  </nav>
</div></div>

<header class="hero"><div class="wrap">
  <h1>Can your agent hold a job?</h1>
  <p class="lede">Most agent benchmarks ask whether a model can <b>solve</b> something. This one asks whether it can be
  <b>left alone with the work</b> — dirty ledgers, a colleague who is confidently wrong, an instruction hidden inside
  an email, an irreversible action that would be convenient to take, and a person who needs a person rather than a
  fix-list. Scoring is code. No model judges anything, so there is nothing to charm.</p>
  <div class="stats">
    <div><b>${CHAIRS.length}</b><span>chairs</span></div>
    <div><b>${totalChecks}</b><span>deterministic checks</span></div>
    <div><b>${totalTraps}</b><span>planted traps</span></div>
    <div><b>${rows.length}</b><span>candidates measured</span></div>
  </div>
</div></header>

<section class="band" id="results"><div class="wrap">
  <h2>Where each candidate landed</h2>
  <p class="sub">A rung is earned only by clearing every rung below it. Two chairs are pass/fail at 100%: an agent that
  ratifies a planted lie never reviews another agent's work, and an agent that can be argued across a spending gate
  never holds a key.</p>
  ${dual('ladder')}
  <p class="caption">Every number below comes from a committed run in <code>results/</code>. Runs where a provider
  errored are kept on disk and excluded here — a rate limit is not a candidate failure.</p>
  <div class="cards">${cards}</div>
</div></section>

<section class="band"><div class="wrap">
  <h2>Every chair, every candidate</h2>
  <p class="sub">Read it as an org chart. Columns are chairs grouped by department; a red corner marks a chair where the
  candidate took a planted trap rather than merely losing points.</p>
  ${dual('matrix')}
  <p class="caption">A dashed cell means that chair was not attempted.</p>

  <h2 style="margin-top:52px">The traps that catch the most agents</h2>
  <p class="sub">The most useful output of a benchmark is not the ranking. It is knowing which specific failure your
  agent is most likely to commit in production, and this is that list.</p>
  ${dual('traps')}
</div></section>

<section class="band" id="chairs"><div class="wrap">
  <h2>The org chart</h2>
  <p class="sub">Six departments. Each chair carries at least one trap — a wrong answer that a fluent model actually
  reaches for. A chair without a trap measures nothing, because models pass checklists.</p>
  ${orgChart}
</div></section>

<section class="band" id="take"><div class="wrap">
  <h2>Take it</h2>
  <p class="sub">Two ways in. Both produce the same scorecard, so a self-administered result and a key-driven result
  sit on the same leaderboard.</p>
  <div class="two">
    <div>
      <h3 style="font-size:15px;margin:0 0 10px">Your agent tests itself</h3>
      <pre><code>git clone https://github.com/lordbasilaiassistant-sudo/company-bench.git
cd company-bench
node bench/take.mjs

<span style="color:var(--muted)"># answer bench-pack/TAKE-THE-BENCH.md
# into bench-pack/answers.json, then:</span>

node bench/grade.mjs bench-pack/answers.json \\
  --label "Your Agent"</code></pre>
      <p class="caption">Claude Code users: copy <code>skills/company-bench</code> into <code>~/.claude/skills/</code>
      and say <code>/company-bench</code>. For any other agent there is a one-paste prompt in
      <a href="https://github.com/lordbasilaiassistant-sudo/company-bench/blob/main/PROMPT.md">PROMPT.md</a>.</p>
    </div>
    <div>
      <h3 style="font-size:15px;margin:0 0 10px">Or point it at your API keys</h3>
      <pre><code><span style="color:var(--muted)"># free tier at console.groq.com</span>
export GROQ_API_KEY=...

node bench/run.mjs --models groq-llama70b
node bench/run.mjs --models ollama:qwen3:8b
node bench/run.mjs --models anthropic:claude-opus-5
node bench/run.mjs --list</code></pre>
      <p class="caption">Any OpenAI-compatible endpoint works — Groq, Z.ai, Mistral, NVIDIA NIM, Cerebras, OpenRouter,
      vLLM, LM Studio, Ollama, OpenAI itself. Keys are read from your environment and never leave your machine.</p>
    </div>
  </div>
</div></section>

<section class="band"><div class="wrap">
  <h2>How it avoids being decor</h2>
  <p class="sub">Benchmarks rot in two directions: they punish correct answers, or they pass everything. Every chair is
  therefore shipped with a reference answer that must score 100% and an attractive wrong answer that must not.
  <code>node bench/selftest.mjs</code> enforces both directions and fails CI if either breaks — it caught thirteen
  scorer bugs on the day this repo was written, before any model was measured.</p>
  <div class="support">
    <p><b>Add a chair, or send us a result.</b> New chairs need a deterministic scorer, a gold answer, a decoy, and a
    trap that a real model actually falls for. See CONTRIBUTING.md — and if this saved you from seating the wrong model,
    you can throw a coffee at it.</p>
    <span style="display:flex;gap:10px">
      <a class="btn" href="https://github.com/lordbasilaiassistant-sudo/company-bench/blob/main/CONTRIBUTING.md">Contribute</a>
      <a class="btn" href="https://ko-fi.com/broketobuilt">Support</a>
    </span>
  </div>
</div></section>

<footer><div class="wrap">
  Company Bench · MIT · built by <a href="https://broke2builtai.com">Broke to Built</a> ·
  <a href="https://github.com/lordbasilaiassistant-sudo/company-bench">source</a><br>
  Last generated ${new Date().toISOString().slice(0, 10)} from ${rows.length} committed result${rows.length === 1 ? '' : 's'}.
</div></footer>

</body>
</html>`;
}

/* ─────────────────────────── main ─────────────────────────── */

const rows = load();
if (!rows.length) {
  console.error('\n  No complete results yet. Run: node bench/run.mjs --models <id>\n');
  process.exit(1);
}

for (const [k, fn] of [['matrix', matrixSvg], ['traps', trapsSvg], ['ladder', ladderSvg]]) {
  fs.writeFileSync(path.join(ASSETS, `${k}-light.svg`), fn(rows, LIGHT));
  fs.writeFileSync(path.join(ASSETS, `${k}-dark.svg`), fn(rows, DARK));
}
fs.writeFileSync(path.join(DOCS, 'index.html'), siteHtml(rows));
const table = leaderboardMd(rows);
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
