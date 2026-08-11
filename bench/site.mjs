/**
 * site.mjs — the GitHub Pages surface.
 *
 * Art direction: a hiring board. The subject is an assessment floor, so the page borrows from
 * the material world of one — seating charts, tabular records, a results board that fills in as
 * candidates are measured. Monospace numerals, ruled columns, ink and amber, and motion that
 * reads as results arriving rather than as decoration.
 *
 * No dependencies, no external requests, no web fonts. Everything is inline and self-contained.
 */
import { DEPARTMENTS, CHAIRS } from './positions/index.mjs';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const step = pct => (pct >= 90 ? 4 : pct >= 75 ? 3 : pct >= 50 ? 2 : pct >= 25 ? 1 : 0);
const trapsOf = r => Object.entries(r.chairs).flatMap(([id, ch]) =>
  (ch.checks ?? []).filter(c => /^TRAP/.test(c.label)).map(c => ({ chair: id, label: c.label.replace(/^TRAP /, ''), pass: c.pass })));

/** Answer-first, self-contained, and quotable in isolation — the shape answer engines cite. */
const FAQ = [
  { q: 'What is Company Bench?',
    a: 'Company Bench is an open-source benchmark that measures whether an AI agent can be trusted with a job, rather than whether it can solve a puzzle. It seats a model in 29 chairs across 7 departments — operations, integrity, security, autonomy, people, management, and an optional treasury — and applies 241 deterministic checks, 78 of which are planted traps. The output is a trust level from L0 (drafter) to L3 (reviewer) plus disqualifying flags, not a percentage. It is MIT-licensed, written in Node with zero dependencies.' },
  { q: 'How is it scored — does an LLM judge the answers?',
    a: 'No LLM judges anything in Company Bench, ever. Every check is a pure function in committed code that returns pass or fail, so the same answer always produces the same score and anyone who clones the repository can re-derive it. A gate has to be stronger than the thing it gates, and a language model grading another language model is not stronger than what it grades. Deterministic scoring also means a result can be audited line by line instead of trusted.' },
  { q: 'What does it measure that coding benchmarks do not?',
    a: 'Coding benchmarks measure capability: whether a model can produce a correct solution to a clean, well-posed problem. Company Bench measures trustworthiness under dirty conditions — a ledger with a duplicated row, a colleague who is confident and wrong, an instruction hidden inside forwarded data, an irreversible action that would be convenient to take. 78 of its 241 checks are traps: an attractive wrong answer that a fluent, capable model actually reaches for. A model can be excellent at code and still walk into most of them.' },
  { q: 'What are the L0 to L3 trust levels?',
    a: 'Company Bench returns a placement rather than a score. L0 drafter: output is read before it leaves the building. L1 gated worker: runs a defined task alone, but output passes a gate it does not control. L2 unattended operator: runs unsupervised on reversible work and stops dead at anything irreversible. L3 reviewer: may gate other agents\' work and hold authority over irreversible actions. Each rung requires every rung below it, and two chairs are pass/fail at 100% regardless of every other score.' },
  { q: 'Which model is best for autonomous agents?',
    a: 'The results table on this page is the honest current answer, and it is partial. Only free-tier, local and one blind frontier model have been measured so far, so the table is a reading of those candidates and not a ranking of the frontier. Every number is reproducible from the committed raw output in the repository. Contributions of results for models not yet measured are explicitly wanted, and the biggest gap is more blind frontier runs.' },
  { q: 'Can I run it on a local Ollama model or my own endpoint?',
    a: 'Yes. Company Bench works with any OpenAI-compatible endpoint, with Anthropic\'s API, and with local models through Ollama — Groq, Z.ai, Mistral, NVIDIA NIM, Cerebras, OpenRouter, vLLM and LM Studio all work by adding an entry to models.json. Run it with node bench/run.mjs --models ollama:your-model. It also records tokens per second, because a model too slow to hold a seat cannot hold it however well it scores.' },
  { q: 'Can my agent take the benchmark itself, without an API key?',
    a: 'Yes. Running node bench/take.mjs writes an exam pack: one markdown file containing every task and an empty answers file. The agent answers each task in its own words, then node bench/grade.mjs scores those answers with exactly the same code used for API-driven runs, so a self-administered result and a key-driven result land on the same leaderboard. Agents are asked not to read the scorers first, and to disclose it in their label if they did.' },
  { q: 'What does Company Bench not measure?',
    a: 'It does not measure multi-turn behaviour: every chair is a single prompt, so drift over a long conversation is out of scope. It does not measure tool use in a live environment, latency under real load, or cost at scale beyond recording throughput. It does not claim to predict real-world performance — it measures behaviour on constructed situations chosen because they resemble the ways agent placements actually fail. Its ceiling is also still generous: 100% is meant to represent a model employee working at the level of a competent human.' },
];

export function siteHtml(rows, { charts, totals, reference }) {
  const ranked = rows.filter(r => !r.reference);
  const LEVELS = [
    { id: 'L3', name: 'Reviewer', rule: 'Gates other agents’ output. Holds authority over irreversible actions.' },
    { id: 'L2', name: 'Unattended operator', rule: 'Runs alone on reversible work. Stops dead at anything irreversible.' },
    { id: 'L1', name: 'Gated worker', rule: 'Runs a defined task. Every output passes a gate it does not control.' },
    { id: 'L0', name: 'Drafter', rule: 'Produces drafts. Everything it emits is read before it ships.' },
  ];

  /* ── the board: candidates × chairs, the hero visual ── */
  const boardRows = ranked.map((r, ri) => {
    const cells = CHAIRS.map((c, ci) => {
      const cell = r.chairs[c.id];
      if (!cell) return `<i class="c none" style="--d:${ri * 40 + ci * 9}ms"></i>`;
      const trapped = (cell.checks ?? []).some(ch => !ch.pass && /^TRAP/.test(ch.label));
      return `<i class="c s${step(cell.pct)}${trapped ? ' trapped' : ''}" style="--d:${ri * 40 + ci * 9}ms"
        data-chair="${esc(c.id)}" data-model="${esc(r.candidate.name)}" data-pct="${cell.pct}"><b>${cell.pct}</b></i>`;
    }).join('');
    const tps = r.tokensPerSecond ? `${r.tokensPerSecond} tok/s` : '';
    return `<tr>
      <th scope="row"><span class="lv lv-${r.placement.level}">${r.placement.level}</span>
        <span class="nm">${esc(r.candidate.name)}</span>
        <span class="vd">${esc(r.candidate.vendor ?? '')}${tps ? ` · ${tps}` : ''}</span></th>
      <td class="cells">${cells}</td>
    </tr>`;
  }).join('');

  const deptHead = DEPARTMENTS.map(d => {
    const n = CHAIRS.filter(c => c.dept === d.id).length;
    return `<span class="dh" style="--n:${n}">${esc(d.label)}</span>`;
  }).join('');

  /* ── the floor: every chair, clickable ── */
  const floor = DEPARTMENTS.map(d => `
    <div class="col" data-dept="${d.id}">
      <h3>${esc(d.label)}${d.optional ? '<em>optional</em>' : ''}</h3>
      <p class="q">${esc(d.question)}</p>
      ${d.chairs.map(c => {
        const traps = c.score('').filter(x => /^TRAP/.test(x.label)).length;
        const hard = c.score('').filter(x => /^HARD/.test(x.label)).length;
        return `<button class="chair" data-id="${esc(c.id)}"
          data-title="${esc(c.title)}" data-blurb="${esc(c.blurb)}"
          data-dept="${esc(d.label)}" data-checks="${c.score('').length}" data-traps="${traps}" data-hard="${hard}">
          <span class="ct">${esc(c.title)}</span><code>${esc(c.id)}</code>
          <span class="cm">${c.score('').length} checks · ${traps} trap${traps === 1 ? '' : 's'}${hard ? ` · ${hard} hard` : ''}</span>
        </button>`;
      }).join('')}
    </div>`).join('');

  /* ── candidate cards ── */
  const cards = ranked.map(r => {
    const p = r.placement;
    const took = trapsOf(r).filter(t => !t.pass);
    return `<article class="card">
      <header>
        <div><h4>${esc(r.candidate.name)}</h4>
          <p class="meta">${esc(r.candidate.vendor ?? '')}${r.candidate.vendor ? ' · ' : ''}<code>${esc(r.candidate.model ?? r.candidate.id)}</code></p></div>
        <span class="lv lv-${p.level}">${p.level}</span>
      </header>
      <div class="spark">${DEPARTMENTS.filter(d => p.dept[d.id] !== undefined).map(d =>
        `<div class="sp" title="${esc(d.label)} ${p.dept[d.id]}%"><i style="--h:${p.dept[d.id]}%" class="s${step(p.dept[d.id])}"></i><span>${esc(d.label.slice(0, 3))}</span></div>`).join('')}</div>
      <dl class="kv">
        <div><dt>traps taken</dt><dd>${took.length}<span>/${trapsOf(r).length}</span></dd></div>
        <div><dt>throughput</dt><dd>${r.tokensPerSecond ?? '—'}<span>tok/s</span></dd></div>
      </dl>
      ${p.flags.length ? `<ul class="flags">${p.flags.map(f => `<li><b>${esc(f.label)}</b>${esc(f.why)}</li>`).join('')}</ul>`
        : '<p class="clean">No disqualifying flags.</p>'}
    </article>`;
  }).join('');

  // The hero visual is a real placement card from a real run, not a mockup.
  const hv = ranked[0];
  const hero = hv ? {
    name: hv.candidate.name,
    level: hv.placement.level,
    levelName: (LEVELS.find(l => l.id === hv.placement.level) || {}).name || '',
    depts: DEPARTMENTS.filter(d => hv.placement.dept[d.id] !== undefined)
      .map(d => ({ label: d.label, pct: hv.placement.dept[d.id] })),
    flag: hv.placement.flags[0],
    trapsTaken: trapsOf(hv).filter(t => !t.pass).length,
    tps: hv.tokensPerSecond,
  } : { name: 'no run yet', level: 'L0', levelName: 'Drafter', depts: [], flag: null, trapsTaken: 0, tps: null };

  const ladder = LEVELS.map((L, i) => {
    const here = ranked.filter(r => r.placement.level === L.id);
    return `<div class="rung r${3 - i}">
      <span class="lv lv-${L.id}">${L.id}</span>
      <div class="rl"><b>${esc(L.name)}</b><span>${esc(L.rule)}</span></div>
      <div class="occ">${here.length
        ? here.map(r => `<span class="chip">${esc(r.candidate.name)}</span>`).join('')
        : '<span class="empty">nobody reached this rung</span>'}</div>
    </div>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Company Bench — AI Agent Trust Benchmark (L0–L3)</title>
<link rel="canonical" href="https://lordbasilaiassistant-sudo.github.io/company-bench/">
<meta name="description" content="Open-source benchmark measuring whether an AI agent can be trusted with a job: ${totals.checks} deterministic checks, ${totals.traps} planted traps, scored by code. Trust level L0–L3.">
<meta property="og:title" content="Company Bench — can your agent hold a job?">
<meta property="og:description" content="${CHAIRS.length} chairs · ${totals.checks} deterministic checks · ${totals.traps} planted traps. Returns a placement, not a percentage.">
<meta property="og:image" content="https://lordbasilaiassistant-sudo.github.io/company-bench/assets/og.svg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/mark.svg" type="image/svg+xml">
<style>
:root{
  --paper:#0E0D0A; --panel:#15140F; --panel2:#1B1914; --ink:#F0ECE1; --mid:#B3AD9C; --muted:#7E7A6C;
  --rule:#26241D; --rule2:#333026; --amber:#E0873F; --amberdim:#8A5527; --danger:#E0603F;
  --s0:#24221C; --s1:#2E3A31; --s2:#3F5F4D; --s3:#5C9179; --s4:#8FD0AC;
  --s0i:#6E6A5D; --s1i:#9FB4A6; --s2i:#CFE6D8; --s3i:#0E1A13; --s4i:#0B1710;
  --f:ui-sans-serif,-apple-system,'Segoe UI',Inter,Helvetica,Arial,sans-serif;
  --m:ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace;
  --lift:0 1px 0 rgba(255,255,255,.045) inset, 0 24px 48px -30px rgba(0,0,0,.9);
}
@media (prefers-color-scheme: light){ :root:not([data-theme="dark"]){
  --paper:#F7F5EF; --panel:#FFFFFF; --panel2:#FBF9F3; --ink:#131209; --mid:#4E4A3E; --muted:#78735F;
  --rule:#E2DED1; --rule2:#D3CEBD; --amber:#A8511F; --amberdim:#D8B394; --danger:#B3341C;
  --s0:#E9E3D5; --s1:#D2DAC9; --s2:#A8C2AE; --s3:#5F9077; --s4:#2E6350;
  --s0i:#6B6555; --s1i:#4C5747; --s2i:#22362B; --s3i:#FFFFFF; --s4i:#FFFFFF;
  --lift:0 1px 0 rgba(255,255,255,.9) inset, 0 18px 34px -26px rgba(30,26,12,.45);
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--f);font-size:16px;line-height:1.55;
  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(900px 520px at 12% -8%, color-mix(in srgb,var(--amber) 16%, transparent), transparent 62%),
    radial-gradient(700px 460px at 96% 4%, color-mix(in srgb,var(--s3) 12%, transparent), transparent 60%);}
body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:1;opacity:.5;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E");}
.wrap{max-width:1120px;margin:0 auto;padding:0 28px;position:relative;z-index:2}
a{color:var(--amber);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
code{font-family:var(--m);font-size:.85em}
h2{font-size:clamp(24px,3vw,32px);letter-spacing:-.025em;margin:0 0 10px;font-weight:640;line-height:1.12}
.sub{color:var(--mid);margin:0 0 30px;max-width:60ch;font-size:15.5px}

/* ── masthead ── */
.top{position:sticky;top:0;z-index:30;backdrop-filter:blur(14px);
  background:color-mix(in srgb,var(--paper) 86%, transparent);border-bottom:1px solid var(--rule)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;height:58px}
.brand{display:flex;align-items:center;gap:9px;font-weight:660;letter-spacing:-.015em;font-size:15px}
.mark{width:16px;height:16px;flex:none;display:grid;grid-template:repeat(2,1fr)/repeat(2,1fr);gap:2px}
.mark i{border-radius:1.5px;background:var(--s1)}
.mark i:nth-child(2){background:var(--s3)} .mark i:nth-child(3){background:var(--amber)}
.mark i:nth-child(4){background:var(--s4)}
.top nav{display:flex;gap:22px;font-size:13.5px;color:var(--mid)}
.top nav a{color:inherit;text-decoration:none}
.top nav a:hover{color:var(--ink)}
@media(max-width:720px){.top nav a:not(.gh){display:none}}

/* ── hero ── */
.hero{padding-top:70px;padding-bottom:12px}
.herogrid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:52px;align-items:center;margin-bottom:44px}
@media(max-width:940px){.herogrid{grid-template-columns:1fr;gap:36px}}
.kicker{font-family:var(--m);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);
  margin:0 0 20px;display:flex;align-items:center;gap:11px}
.kicker i{width:3px;height:15px;background:var(--amber);transform:skewX(-16deg);flex:none;border-radius:1px}
/* A serif display over a sans body is the single strongest anti-median move available: the
   median generated page is sans-only, so this reads as art-directed before a word is read. */
h1{font-family:ui-serif,Georgia,'Iowan Old Style','Times New Roman',serif;
  font-size:clamp(42px,5.6vw,68px);line-height:1.0;letter-spacing:-.028em;margin:0 0 22px;font-weight:600;max-width:13ch}
h1 em{font-style:italic;color:var(--amber)}
.lede{font-size:clamp(16.5px,1.7vw,19px);line-height:1.5;color:var(--mid);max-width:56ch;margin:0 0 30px}
.lede b{color:var(--ink);font-weight:560}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:0}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:8px;font-size:14.5px;
  font-weight:560;border:1px solid var(--rule2);color:var(--ink);background:var(--panel2);box-shadow:var(--lift);
  transition:transform .18s cubic-bezier(.2,.7,.3,1), border-color .18s}
.btn:hover{transform:translateY(-2px);border-color:var(--amber);text-decoration:none}
.btn.pri{background:var(--amber);border-color:var(--amber);color:#140D06}
.btn.pri:hover{filter:brightness(1.08)}
.btn span{transition:transform .18s cubic-bezier(.2,.7,.3,1);display:inline-block}
.btn:hover span{transform:translateX(3px)}
.btn.ghost{background:none;box-shadow:none;border-color:var(--rule2)}

/* ── hero product surface: the placement card, with window chrome ── */
.surface{border:1px solid var(--rule2);border-radius:13px;overflow:hidden;background:var(--panel);
  box-shadow:0 1px 0 rgba(255,255,255,.05) inset, 0 40px 70px -34px rgba(0,0,0,.85);
  transform:perspective(1400px) rotateY(-3.5deg) rotateX(1.5deg);transform-origin:left center}
@media(max-width:940px){.surface{transform:none}}
.chrome{display:flex;align-items:center;gap:7px;padding:11px 14px;border-bottom:1px solid var(--rule);
  background:var(--panel2)}
.chrome i{width:9px;height:9px;border-radius:50%;background:var(--rule2)}
.chrome span{margin-left:8px;font-family:var(--m);font-size:10.5px;color:var(--muted);letter-spacing:.06em}
.sbody{padding:16px 18px 14px}
.srow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0;
  border-bottom:1px solid var(--rule);font-size:12.5px}
.skey{color:var(--muted);font-family:var(--m);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase}
.sval{font-weight:560;display:flex;align-items:center;gap:8px}
.sbars{padding:12px 0 4px;display:grid;gap:7px}
.sbar{display:grid;grid-template-columns:78px 1fr 30px;align-items:center;gap:10px;font-size:11px}
.sbar>span{color:var(--muted)}
.sbar i{height:7px;border-radius:4px;background:var(--s0);display:block;overflow:hidden}
.sbar i b{display:block;height:100%;width:var(--w);border-radius:4px;
  animation:grow .9s cubic-bezier(.2,.8,.25,1) both}
.sbar i b.s0{background:var(--s0)} .sbar i b.s1{background:var(--s1)} .sbar i b.s2{background:var(--s2)}
.sbar i b.s3{background:var(--s3)} .sbar i b.s4{background:var(--s4)}
.sbar em{font-style:normal;font-family:var(--m);color:var(--mid);text-align:right;font-size:10.5px}
@keyframes grow{from{width:0}to{width:var(--w)}}
.sflag{margin-top:12px;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--danger) 10%, transparent);
  border:1px solid color-mix(in srgb,var(--danger) 26%, transparent);font-size:11px;color:var(--mid);line-height:1.45}
.sflag b{display:block;color:var(--ink);font-size:10.5px;letter-spacing:.05em;margin-bottom:2px}
.sfoot{margin-top:12px;padding-top:10px;border-top:1px solid var(--rule);font-family:var(--m);
  font-size:10.5px;color:var(--muted)}

/* ── stat strip ── */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));border:1px solid var(--rule);
  border-radius:12px;background:var(--panel);box-shadow:var(--lift);overflow:hidden;margin-bottom:14px}
.stats div{padding:16px 20px;border-right:1px solid var(--rule)}
.stats div:last-child{border-right:0}
.stats b{display:block;font-size:27px;font-weight:600;letter-spacing:-.03em;line-height:1.15;font-family:var(--m)}
.stats span{font-size:11px;color:var(--muted);letter-spacing:.09em;text-transform:uppercase}

/* ── the board ── */
.board{border:1px solid var(--rule);border-radius:12px;background:linear-gradient(180deg,var(--panel2),var(--panel));
  box-shadow:var(--lift);padding:18px 20px 20px;overflow-x:auto}
.board table{border-collapse:collapse;width:100%;min-width:760px}
.board th{text-align:left;font-weight:400;padding:0 16px 0 0;white-space:nowrap;vertical-align:middle}
.board .nm{display:block;font-size:13px;font-weight:560;letter-spacing:-.01em}
.board .vd{display:block;font-size:10.5px;color:var(--muted);font-family:var(--m)}
.board tr th .lv{float:left;margin:4px 10px 0 0}
.board .cells{display:flex;gap:2px;padding:3px 0}
.c{width:100%;min-width:14px;height:26px;border-radius:3px;background:var(--s0);position:relative;flex:1;
  display:grid;place-items:center;opacity:0;animation:flip .5s cubic-bezier(.2,.8,.25,1) forwards;animation-delay:var(--d)}
.c b{font-family:var(--m);font-size:9px;font-weight:600;opacity:0;transition:opacity .2s}
.board:hover .c b, .c:hover b{opacity:1}
.c.s0{background:var(--s0);color:var(--s0i)} .c.s1{background:var(--s1);color:var(--s1i)}
.c.s2{background:var(--s2);color:var(--s2i)} .c.s3{background:var(--s3);color:var(--s3i)}
.c.s4{background:var(--s4);color:var(--s4i)}
.c.none{background:none;border:1px dashed var(--rule2)}
.c.trapped:after{content:"";position:absolute;top:0;right:0;border-top:7px solid var(--danger);
  border-left:7px solid transparent;border-top-right-radius:3px}
.c:hover{outline:1.5px solid var(--amber);outline-offset:1px;z-index:2}
@keyframes flip{from{opacity:0;transform:scaleY(.15) translateY(-3px)}to{opacity:1;transform:none}}
.depts{display:flex;gap:2px;padding-left:0;margin:0 0 6px}
.dh{flex:var(--n);font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);
  border-bottom:1px solid var(--rule2);padding-bottom:5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.boardhead{display:grid;grid-template-columns:var(--lw,208px) 1fr;gap:0}
.legend{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:14px;font-size:11.5px;color:var(--muted)}
.legend i{display:inline-block;width:14px;height:11px;border-radius:2px;vertical-align:-1px;margin-right:5px}
.legend .tr{width:0;height:0;border-top:8px solid var(--danger);border-left:8px solid transparent}

/* ── sections ── */
section{padding-block:78px;position:relative;z-index:2}
section+section{border-top:1px solid var(--rule)}

/* ── ladder ── */
.ladder{display:grid;gap:10px}
.rung{display:grid;grid-template-columns:44px minmax(190px,1fr) 2fr;gap:18px;align-items:center;
  padding:18px 20px;border:1px solid var(--rule);border-radius:11px;background:var(--panel);box-shadow:var(--lift);
  position:relative;overflow:hidden}
.rung:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px}
.rung.r3:before{background:var(--s4)} .rung.r2:before{background:var(--s3)}
.rung.r1:before{background:var(--s2)} .rung.r0:before{background:var(--s0)}
.rl b{display:block;font-size:15px;font-weight:600;letter-spacing:-.015em}
.rl span{font-size:12.5px;color:var(--muted);line-height:1.4}
.occ{display:flex;gap:7px;flex-wrap:wrap}
.chip{font-size:12.5px;padding:5px 12px;border-radius:20px;border:1px solid var(--rule2);background:var(--panel2)}
.empty{font-size:12.5px;color:var(--muted);font-style:italic;opacity:.7}
.lv{font-family:var(--m);font-size:11px;font-weight:700;padding:4px 8px;border-radius:5px;display:inline-block;line-height:1}
.lv-L0{background:var(--s0);color:var(--s0i)} .lv-L1{background:var(--s2);color:var(--s2i)}
.lv-L2{background:var(--s3);color:var(--s3i)} .lv-L3{background:var(--s4);color:var(--s4i)}
@media(max-width:760px){.rung{grid-template-columns:44px 1fr}.rung .occ{grid-column:1/-1}}

/* ── cards ── */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.card{border:1px solid var(--rule);border-radius:11px;background:var(--panel);padding:17px 18px;box-shadow:var(--lift);
  transition:transform .2s cubic-bezier(.2,.7,.3,1),border-color .2s}
.card:hover{transform:translateY(-3px);border-color:var(--rule2)}
.card header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
.card h4{margin:0;font-size:15px;font-weight:600;letter-spacing:-.015em}
.card .meta{margin:2px 0 0;font-size:11.5px;color:var(--muted)}
.spark{display:flex;gap:5px;align-items:flex-end;height:56px;padding:0 0 4px;border-bottom:1px solid var(--rule)}
.sp{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;gap:4px}
.sp i{width:100%;height:var(--h);border-radius:2px 2px 0 0;min-height:2px}
.sp i.s0{background:var(--s0)} .sp i.s1{background:var(--s1)} .sp i.s2{background:var(--s2)}
.sp i.s3{background:var(--s3)} .sp i.s4{background:var(--s4)}
.sp span{font-size:8.5px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 12px;padding-bottom:12px;border-bottom:1px solid var(--rule)}
.kv dt{font-size:10px;color:var(--muted);letter-spacing:.07em;text-transform:uppercase}
.kv dd{margin:2px 0 0;font-family:var(--m);font-size:17px;font-weight:600;letter-spacing:-.02em}
.kv dd span{font-size:10.5px;color:var(--muted);font-weight:400;margin-left:3px}
.flags{list-style:none;margin:0;padding:0;font-size:12px;line-height:1.45}
.flags li{padding-left:15px;position:relative;color:var(--muted);margin-bottom:7px}
.flags li:before{content:"";position:absolute;left:0;top:6px;width:6px;height:6px;border-radius:50%;background:var(--danger)}
.flags b{color:var(--ink);font-weight:620;display:block;letter-spacing:.02em;font-size:11px}
.clean{font-size:12px;color:var(--muted);margin:0}

/* ── the floor ── */
.floorwrap{display:grid;grid-template-columns:1fr 320px;gap:24px;align-items:start}
@media(max-width:900px){.floorwrap{grid-template-columns:1fr}}
.floor{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:16px}
.col h3{margin:0 0 2px;font-size:12px;font-weight:660;letter-spacing:.06em;text-transform:uppercase}
.col h3 em{font-style:normal;font-size:9px;color:var(--muted);margin-left:7px;letter-spacing:.05em;
  border:1px solid var(--rule2);padding:2px 6px;border-radius:10px}
.col .q{margin:0 0 11px;font-size:11.5px;color:var(--muted);line-height:1.4;min-height:32px}
.chair{display:block;width:100%;text-align:left;border:1px solid var(--rule);background:var(--panel);
  border-radius:9px;padding:10px 12px;margin-bottom:7px;cursor:pointer;font:inherit;color:inherit;
  transition:border-color .16s,transform .16s,background .16s}
.chair:hover,.chair:focus-visible{border-color:var(--amber);transform:translateX(3px);outline:none;background:var(--panel2)}
.chair[aria-current="true"]{border-color:var(--amber);background:var(--panel2)}
.ct{display:block;font-size:13px;font-weight:560;letter-spacing:-.01em}
.chair code{display:block;font-size:10.5px;color:var(--amber);margin:1px 0 3px}
.cm{display:block;font-size:10px;color:var(--muted);font-family:var(--m)}
.detail{position:sticky;top:76px;border:1px solid var(--rule);border-radius:11px;background:var(--panel);
  padding:20px;box-shadow:var(--lift)}
.detail .dl{font-family:var(--m);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--amber);margin:0 0 8px}
.detail h4{margin:0 0 3px;font-size:17px;letter-spacing:-.02em;font-weight:620}
.detail .did{font-family:var(--m);font-size:11.5px;color:var(--muted);margin:0 0 14px}
.detail p.db{font-size:13.5px;color:var(--mid);line-height:1.5;margin:0 0 16px}
.detail .nums{display:flex;gap:8px;flex-wrap:wrap}
.detail .nums span{font-family:var(--m);font-size:11px;padding:5px 10px;border-radius:6px;
  background:var(--panel2);border:1px solid var(--rule);color:var(--muted)}
.detail .nums span b{color:var(--ink)}

/* ── code panes ── */
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.two>*{min-width:0}
@media(max-width:860px){.two{grid-template-columns:1fr}}
.pane{border:1px solid var(--rule);border-radius:11px;background:var(--panel);box-shadow:var(--lift);overflow:hidden}
.pane h3{margin:0;padding:14px 18px;font-size:13px;font-weight:600;border-bottom:1px solid var(--rule);
  letter-spacing:-.01em;display:flex;align-items:center;gap:9px}
.pane h3 i{width:7px;height:7px;border-radius:50%;background:var(--amber);flex:none}
.pane pre{margin:0;padding:16px 18px;font-family:var(--m);font-size:12.5px;line-height:1.7;overflow-x:auto;
  background:var(--panel2)}
.pane pre .cmt{color:var(--muted)}
.pane p{margin:0;padding:13px 18px;font-size:12.5px;color:var(--muted);border-top:1px solid var(--rule);line-height:1.5}

/* ── charts ── */
.chart{border:1px solid var(--rule);border-radius:11px;background:var(--panel);padding:10px;overflow-x:auto;
  box-shadow:var(--lift)}
.chart svg{display:block;max-width:100%;height:auto;min-width:600px}
.only-dark{display:none}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) .only-dark{display:block}
  :root:not([data-theme="light"]) .only-light{display:none}}
:root[data-theme="dark"] .only-dark{display:block}
:root[data-theme="dark"] .only-light{display:none}

/* ── data table (crawlable; the charts are decoration over this) ── */
.datatable{width:100%;border-collapse:collapse;margin:18px 0 8px;font-size:12.5px;display:block;overflow-x:auto;
  white-space:nowrap}
.datatable caption{text-align:left;color:var(--muted);font-size:12px;padding:0 0 10px;white-space:normal}
.datatable th,.datatable td{padding:9px 12px;border-bottom:1px solid var(--rule);text-align:right}
.datatable thead th{color:var(--muted);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;font-weight:600;
  border-bottom:1px solid var(--rule2)}
.datatable th[scope="row"],.datatable thead th:first-child,.datatable td:first-of-type{text-align:left}
.datatable tbody th{font-weight:560}
.datatable tbody tr:hover{background:var(--panel2)}

/* ── faq ── */
.faq{display:grid;gap:0;border:1px solid var(--rule);border-radius:11px;background:var(--panel);
  box-shadow:var(--lift);overflow:hidden}
.faq details{border-bottom:1px solid var(--rule)}
.faq details:last-child{border-bottom:0}
.faq summary{cursor:pointer;padding:15px 20px;font-size:14.5px;font-weight:560;list-style:none;
  display:flex;justify-content:space-between;align-items:center;gap:14px;transition:background .15s}
.faq summary::-webkit-details-marker{display:none}
.faq summary:after{content:"+";font-family:var(--m);color:var(--amber);font-size:17px;flex:none}
.faq details[open] summary:after{content:"–"}
.faq summary:hover{background:var(--panel2)}
.faq p{margin:0;padding:0 20px 18px;font-size:13.5px;color:var(--mid);line-height:1.6;max-width:80ch}

/* ── notes / footer ── */
.note{border:1px solid var(--rule2);border-left:3px solid var(--amber);border-radius:0 10px 10px 0;
  background:var(--panel);padding:20px 24px;margin-top:26px}
.note h3{margin:0 0 8px;font-size:14px;font-weight:640;letter-spacing:-.01em}
.note p{margin:0 0 10px;font-size:13.5px;color:var(--mid);line-height:1.55}
.note p:last-child{margin-bottom:0}
.support{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;
  border:1px solid var(--rule);border-radius:11px;background:var(--panel);padding:22px 24px;box-shadow:var(--lift)}
.support p{margin:0;font-size:13.5px;color:var(--mid);max-width:58ch}
.support b{color:var(--ink)}
footer{padding-block:40px 60px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--rule);position:relative;z-index:2}
footer a{color:var(--mid)}
.reveal{opacity:0;transform:translateY(14px)}
.reveal.in{opacity:1;transform:none;transition:opacity .6s ease,transform .6s cubic-bezier(.2,.7,.3,1)}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}
  .reveal{opacity:1;transform:none}.c{opacity:1}}
</style>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"SoftwareSourceCode","name":"Company Bench",
  "description":"Open-source benchmark measuring whether an AI agent can be trusted with a job. 29 chairs across 7 departments, 241 deterministic checks, 78 planted traps. Scored by code with no LLM judge. Output is a trust level L0-L3.",
  "codeRepository":"https://github.com/lordbasilaiassistant-sudo/company-bench",
  "programmingLanguage":"JavaScript","runtimePlatform":"Node.js",
  "license":"https://opensource.org/licenses/MIT",
  "url":"https://lordbasilaiassistant-sudo.github.io/company-bench/",
  "keywords":"AI agent benchmark, agent evaluation, LLM evaluation, prompt injection, agent safety, autonomous agents, agent trustworthiness"},
 {"@type":"FAQPage","mainEntity":[${FAQ.map(f => JSON.stringify({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })).join(',')}]}
]}
</script>
</head>
<body>

<div class="top"><div class="wrap">
  <span class="brand"><span class="mark"><i></i><i></i><i></i><i></i></span> Company Bench</span>
  <nav>
    <a href="#board">Results</a><a href="#floor">The chairs</a><a href="#take">Take it</a>
    <a class="gh" href="https://github.com/lordbasilaiassistant-sudo/company-bench">GitHub ↗</a>
  </nav>
</div></div>

<div class="wrap hero">
  <div class="herogrid">
    <div class="heroL">
      <p class="kicker"><i></i>Open-source agent employability benchmark</p>
      <h1>Can your agent <em>hold a job?</em></h1>
      <p class="lede">Other benchmarks ask whether a model can <b>solve</b> something. This one asks whether it can
      be <b>left alone with the work</b> — a ledger with a duplicated row, a colleague who is confident and wrong,
      an instruction hidden inside an email, and an irreversible action that would be very convenient to take.</p>
      <div class="cta">
        <a class="btn pri" href="#take">Test your agent <span>&rarr;</span></a>
        <a class="btn ghost" href="#board">See the results <span>&rarr;</span></a>
      </div>
    </div>
    <div class="heroR">
      <div class="surface">
        <div class="chrome"><i></i><i></i><i></i><span>placement card</span></div>
        <div class="sbody">
          <div class="srow"><span class="skey">candidate</span><span class="sval">${esc(hero.name)}</span></div>
          <div class="srow"><span class="skey">trust level</span><span class="sval"><b class="lv lv-${hero.level}">${hero.level}</b> ${esc(hero.levelName)}</span></div>
          <div class="sbars">
            ${hero.depts.map(d => `<div class="sbar"><span>${esc(d.label)}</span>
              <i><b class="s${step(d.pct)}" style="--w:${d.pct}%"></b></i><em>${d.pct}</em></div>`).join('')}
          </div>
          ${hero.flag ? `<div class="sflag"><b>&#9940; ${esc(hero.flag.label)}</b>${esc(hero.flag.why)}</div>` : ''}
          <div class="sfoot">${hero.trapsTaken} of ${totals.traps} planted traps taken${hero.tps ? ` &middot; ${hero.tps} tok/s` : ''}</div>
        </div>
      </div>
    </div>
  </div>
  <div class="stats">
    <div><b>${CHAIRS.length}</b><span>chairs</span></div>
    <div><b>${totals.checks}</b><span>deterministic checks</span></div>
    <div><b>${totals.traps}</b><span>planted traps</span></div>
    <div><b>${ranked.length}</b><span>models measured</span></div>
    <div><b>0</b><span>LLM judges</span></div>
  </div>
</div>

<section id="board"><div class="wrap">
  <h2>The board</h2>
  <p class="sub">Every candidate against every chair. A red corner marks a chair where the model took a planted
  trap rather than merely losing points. Hover for scores.</p>
  <div class="board reveal">
    <div class="depts">${deptHead}</div>
    <table><tbody>${boardRows}</tbody></table>
    <div class="legend">
      <span><i style="background:var(--s0)"></i>0–24</span>
      <span><i style="background:var(--s1)"></i>25–49</span>
      <span><i style="background:var(--s2)"></i>50–74</span>
      <span><i style="background:var(--s3)"></i>75–89</span>
      <span><i style="background:var(--s4)"></i>90–100</span>
      <span><i class="tr"></i>trap taken</span>
    </div>
  </div>
  <table class="datatable">
    <caption>Company Bench results by department, measured at temperature 0. Percentages are the mean of that department's chairs.</caption>
    <thead><tr><th scope="col">Model</th><th scope="col">Provider</th><th scope="col">Trust level</th>
      ${DEPARTMENTS.map(d => `<th scope="col">${esc(d.label)}</th>`).join('')}
      <th scope="col">Traps taken</th><th scope="col">Tokens/sec</th></tr></thead>
    <tbody>${ranked.map(r => `<tr><th scope="row">${esc(r.candidate.name)}</th>
      <td>${esc(r.candidate.vendor ?? '')}</td><td>${r.placement.level}</td>
      ${DEPARTMENTS.map(d => `<td>${r.placement.dept[d.id] === undefined ? '—' : r.placement.dept[d.id] + '%'}</td>`).join('')}
      <td>${trapsOf(r).filter(t => !t.pass).length} of ${trapsOf(r).length}</td>
      <td>${r.tokensPerSecond ?? '—'}</td></tr>`).join('')}</tbody>
  </table>
  <div class="note reveal">
    <h3>What 100% is supposed to mean</h3>
    <p>100% is a <b>model employee</b>: someone doing the job at the level of a competent human who would be
    earning raises for it. By that standard this scale is still too generous at the top, and we would rather say
    so than quietly grade on a curve.</p>
    <p>The author's own reference answers score 100% — but the author wrote both the chairs and the answers, so
    that row is a calibration marker proving the reference answers pass their own scorers, not a measurement.
    It is excluded from the board. <b>A blind frontier result is the contribution this project most wants.</b></p>
  </div>
</div></section>

<section><div class="wrap">
  <h2>Where each one landed</h2>
  <p class="sub">Each rung requires every rung below it. Two chairs are pass/fail at 100%: an agent that ratifies
  a planted lie never reviews another agent's work, and an agent that can be argued across a spending gate never
  holds a key.</p>
  <div class="ladder reveal">${ladder}</div>
  <div class="cards reveal" style="margin-top:26px">${cards}</div>
</div></section>

<section id="floor"><div class="wrap">
  <h2>The floor</h2>
  <p class="sub">Six departments. Pick any chair to see what it measures — and how many attractive wrong answers
  are waiting in it.</p>
  <div class="floorwrap">
    <div class="floor reveal">${floor}</div>
    <aside class="detail" id="detail">
      <p class="dl" id="d-dept">Select a chair</p>
      <h4 id="d-title">The floor</h4>
      <p class="did" id="d-id">25 chairs across six departments</p>
      <p class="db" id="d-blurb">Every chair carries at least one trap: a wrong answer that a fluent, capable model
      actually reaches for. A chair without one measures nothing, because models pass checklists.</p>
      <div class="nums" id="d-nums">
        <span><b>${totals.checks}</b> checks</span><span><b>${totals.traps}</b> traps</span><span><b>${totals.hard}</b> hard</span>
      </div>
    </aside>
  </div>
</div></section>

<section><div class="wrap">
  <h2>The traps that catch the most agents</h2>
  <p class="sub">The most useful output of a benchmark is not the ranking. It is knowing which specific failure
  your agent is most likely to commit in production.</p>
  <div class="chart reveal"><div class="only-light">${charts.trapsLight}</div><div class="only-dark">${charts.trapsDark}</div></div>
</div></section>

<section id="take"><div class="wrap">
  <h2>Take it</h2>
  <p class="sub">Two ways in, one scorecard. A self-administered result and a key-driven result are directly
  comparable, or the self-administered path would be a participation trophy.</p>
  <div class="two">
    <div class="pane reveal">
      <h3><i></i>Your agent tests itself</h3>
<pre><code>git clone https://github.com/lordbasilaiassistant-sudo/company-bench.git
cd company-bench
node bench/take.mjs

<span class="cmt"># the agent answers bench-pack/TAKE-THE-BENCH.md
# into bench-pack/answers.json, then:</span>

node bench/grade.mjs bench-pack/answers.json \\
  --label "Your Agent"</code></pre>
      <p>Claude Code: drop <code>skills/company-bench</code> into <code>~/.claude/skills/</code> and say
      <code>/company-bench</code>. Any other agent: one-paste prompt in
      <a href="https://github.com/lordbasilaiassistant-sudo/company-bench/blob/main/PROMPT.md">PROMPT.md</a>.</p>
    </div>
    <div class="pane reveal">
      <h3><i></i>Or point it at your keys — including local</h3>
<pre><code><span class="cmt"># free tier at console.groq.com</span>
export GROQ_API_KEY=...

node bench/run.mjs --models groq-llama70b
node bench/run.mjs --models ollama:qwen3:8b
node bench/run.mjs --models anthropic:claude-opus-5
node bench/run.mjs --list</code></pre>
      <p>Any OpenAI-compatible endpoint: Groq, Z.ai, Mistral, NVIDIA NIM, Cerebras, OpenRouter, vLLM, LM Studio,
      Ollama, OpenAI, Anthropic. Keys stay on your machine. Throughput is recorded too — a model too slow to hold
      a seat cannot hold it, however well it scores.</p>
    </div>
  </div>
  <div class="note reveal">
    <h3>How it avoids becoming decor</h3>
    <p>Benchmarks rot in two directions: they start punishing correct answers, or they start passing everything.
    Every chair therefore ships a <b>gold</b> answer that must score 100% and a <b>decoy</b> — the attractive wrong
    answer — that must not. <code>node bench/selftest.mjs</code> enforces both, plus a third rule that an empty
    answer may never score above 40%. It caught thirteen scorer bugs on day one, before any model was measured.</p>
    <p>A provider error yields <b>no reading</b>, never a zero — incomplete runs are excluded and stamped. Raw
    model output is committed with every result, because a score nobody can audit is a rumour.</p>
  </div>
</div></section>

<section id="faq"><div class="wrap">
  <h2>Questions people actually ask</h2>
  <p class="sub">Written to be quotable in isolation — by a person or by an answer engine.</p>
  <div class="faq">${FAQ.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>
  <p class="caption" style="margin-top:22px">Machine-readable:
    <a href="results.json">results.json</a> ·
    <a href="leaderboard.csv">leaderboard.csv</a> ·
    <a href="llms.txt">llms.txt</a></p>
</div></section>

<section><div class="wrap">
  <div class="support">
    <p><b>Contributions wanted, in this order:</b> a blind frontier result · harder chairs · new departments
    (scheduling, support, research, compliance, hiring) · local-model results. Agents reading this repo should
    start at <code>llms.txt</code>.</p>
    <span style="display:flex;gap:10px;flex-wrap:wrap">
      <a class="btn" href="https://github.com/lordbasilaiassistant-sudo/company-bench/blob/main/CONTRIBUTING.md">Contribute</a>
      <a class="btn" href="https://ko-fi.com/broketobuilt">Support</a>
    </span>
  </div>
</div></section>

<footer><div class="wrap">
  Company Bench · MIT · built by <a href="https://broke2builtai.com">Broke to Built</a> ·
  <a href="https://github.com/lordbasilaiassistant-sudo/company-bench">source</a> ·
  <a href="https://lordbasilaiassistant-sudo.github.io/company-bench/assets/matrix-light.svg">charts</a><br>
  Generated ${new Date().toISOString().slice(0, 10)} from ${ranked.length} committed result${ranked.length === 1 ? '' : 's'} at temperature 0.
</div></footer>

<script>
(function(){
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
  }, {rootMargin:'0px 0px -8% 0px'});
  document.querySelectorAll('.reveal').forEach(function(el){ io.observe(el); });

  var d = {dept:document.getElementById('d-dept'), title:document.getElementById('d-title'),
           id:document.getElementById('d-id'), blurb:document.getElementById('d-blurb'),
           nums:document.getElementById('d-nums')};
  document.querySelectorAll('.chair').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('.chair').forEach(function(x){ x.removeAttribute('aria-current'); });
      b.setAttribute('aria-current','true');
      d.dept.textContent = b.dataset.dept;
      d.title.textContent = b.dataset.title;
      d.id.textContent = b.dataset.id;
      d.blurb.textContent = b.dataset.blurb;
      d.nums.innerHTML = '<span><b>'+b.dataset.checks+'</b> checks</span>'
        + '<span><b>'+b.dataset.traps+'</b> traps</span>'
        + (b.dataset.hard!=='0' ? '<span><b>'+b.dataset.hard+'</b> hard</span>' : '');
    });
  });
})();
</script>
</body>
</html>`;
}
