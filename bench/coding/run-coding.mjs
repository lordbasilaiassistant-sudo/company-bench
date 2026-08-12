#!/usr/bin/env node
/**
 * bench/coding/run-coding.mjs — the executed coding track.
 *
 *   node bench/coding/run-coding.mjs --models groq-llama70b
 *   node bench/coding/run-coding.mjs --models ollama:qwen2.5-coder:7b
 *   node bench/coding/run-coding.mjs --answers my-code-answers.json --label "My Agent"
 *   node bench/coding/run-coding.mjs --take                 # write the exam pack and exit
 *   node bench/coding/run-coding.mjs --list
 *
 * A coding score that was not executed is a vibe. Every task here is graded by RUNNING the
 * model's code against tests it never sees, in a subprocess with a hard timeout. Tasks are
 * weighted, because a wrong AMM price and a wrong string reverse are not the same mistake.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TASKS from './tasks.mjs';
import { extractCode } from './extract.mjs';
import { gradeTask, python } from './exec.mjs';
import { chat, loadRegistry, resolveModel } from '../lib/transport.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = path.join(ROOT, 'results', 'coding');

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = n => argv.includes(`--${n}`);
const listOf = n => (flag(n) ?? '').split(',').map(s => s.trim()).filter(Boolean);

// A mistyped flag must fail loudly, not quietly mean something else. `--model` (singular) is the
// obvious typo for `--models`, and it used to be ignored — which fell through to "run EVERY keyed
// model in the registry". Launched in a loop, that ran the whole track against seven free-tier API
// providers for two hours, burning quota, hanging on rate-limit backoff, and never writing a file.
// Unknown flags now stop the run before a single call is made.
const KNOWN_FLAGS = new Set(['models', 'tasks', 'answers', 'label', 'id', 'out', 'take', 'list', 'all']);
const ALIASES = { model: 'models', task: 'tasks', 'answer': 'answers' };
for (const a of argv) {
  if (!a.startsWith('--')) continue;
  const name = a.slice(2);
  if (KNOWN_FLAGS.has(name)) continue;
  const hint = ALIASES[name] ? `  Did you mean --${ALIASES[name]}?` : '';
  console.error(`\n  unknown flag --${name}.${hint}`);
  console.error(`  known flags: ${[...KNOWN_FLAGS].map(f => `--${f}`).join(' ')}\n`);
  process.exit(2);
}

const only = listOf('tasks');
const tasks = only.length ? TASKS.filter(t => only.includes(t.id)) : TASKS;
if (only.length) {
  const unknown = only.filter(id => !TASKS.some(t => t.id === id));
  if (unknown.length) { console.error(`\n  unknown task id(s): ${unknown.join(', ')}\n`); process.exit(2); }
}

if (has('list')) {
  console.log(`\n  EXECUTED CODING TRACK — ${TASKS.length} tasks\n`);
  const byCat = {};
  for (const t of TASKS) (byCat[t.category] ||= []).push(t);
  for (const [cat, ts] of Object.entries(byCat)) {
    console.log(`  ${cat}`);
    for (const t of ts) console.log(`    ${t.id.padEnd(24)} ${t.lang}  weight ${t.weight}`);
  }
  console.log('');
  process.exit(0);
}

if (has('take')) {
  const dir = path.resolve(flag('out') ?? 'bench-pack');
  fs.mkdirSync(dir, { recursive: true });
  const md = [
    '# Company Bench — executed coding track',
    '',
    `${tasks.length} tasks. Your code is executed against hidden tests you will not see. A function that`,
    'looks right and returns the wrong number fails here, which is the whole point of executing it.',
    '',
    '## How to take it',
    '',
    '1. Answer each task with the code block it asks for, and nothing else.',
    '2. Put your complete raw reply for each task into `coding-answers.json` under its task id.',
    '3. Run: `node bench/coding/run-coding.mjs --answers bench-pack/coding-answers.json --label "Your Model"`',
    '',
    'Do not read `bench/coding/tasks.mjs` first — the hidden tests are in it.',
    '',
    '---',
    ...tasks.map((t, i) => [
      '',
      `## Task ${i + 1} of ${tasks.length} — \`${t.id}\``,
      '',
      `**Language:** ${t.lang === 'py' ? 'Python' : 'JavaScript'}  ·  **Category:** ${t.category}`,
      '',
      '```',
      t.prompt,
      '```',
      '',
      '---',
    ].join('\n')),
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'TAKE-THE-CODING-TRACK.md'), md);
  fs.writeFileSync(path.join(dir, 'coding-answers.json'), JSON.stringify(Object.fromEntries(tasks.map(t => [t.id, ''])), null, 2));
  console.log(`\n  Coding pack written to ${dir}\n    TAKE-THE-CODING-TRACK.md · coding-answers.json\n`);
  process.exit(0);
}

if (tasks.some(t => t.lang === 'py') && !python()) {
  console.log('  ⚠ no python interpreter found — Python tasks will be reported as skipped, not failed');
}

/* ------------------------------- collect answers ------------------------------- */

async function answersFromModel(model) {
  const answers = {};
  for (const t of tasks) {
    process.stdout.write(`  ${t.id.padEnd(24)} `);
    try {
      const { text, ms } = await chat(model, t.prompt, { maxTokens: model.maxTokens ?? 3000 });
      answers[t.id] = text;
      process.stdout.write(`${(ms / 1000).toFixed(1)}s  `);
    } catch (e) {
      // A transport failure is NOT a coding failure. Grading '' here scored the model 1/8 on a task
      // it was never asked, and merged that over a real 8/8 — two dead sockets took a 91.7% result
      // to 80.4%. CONTRIBUTING.md already says an incomplete run must be excluded rather than
      // published as a score; leaving `graded[t.id]` unset is what enforces it, because the merge
      // and the weighted average both skip tasks with no grade.
      console.log(`⚠  call failed, NOT scored: ${String(e.message).slice(0, 60)}`);
      callFailures.push(t.id);
      continue;
    }
    const code = extractCode(answers[t.id] ?? '', t.lang);
    const g = await gradeTask(t, code);
    g.code = code;                       // the exact source that was executed — see note at persist time
    reportLine(t, g);
    graded[t.id] = g;
  }
  return answers;
}

let graded = {};
let callFailures = [];
function reportLine(t, g) {
  const score = g.total ? g.passed / g.total : 0;
  const bar = '█'.repeat(Math.round(score * 10)).padEnd(10, '·');
  const note = g.skipped ? '  ⃠ skipped' : g.fatal ? `  ✖ ${g.fatal.slice(0, 52)}`
    : g.passed < g.total ? `  ✖ ${g.checks.filter(c => !c.ok).map(c => c.name).join(', ').slice(0, 52)}` : '';
  console.log(`${bar} ${String(g.passed).padStart(2)}/${String(g.total).padEnd(2)} ${(score * 100).toFixed(0).padStart(3)}%${note}`);
}

/* ------------------------------- main ------------------------------- */

const answersFile = flag('answers');
const candidates = [];

if (answersFile) {
  const raw = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
  const label = flag('label') ?? path.basename(answersFile, '.json');
  console.log(`\n  EXECUTED CODING TRACK — ${label}  (self-administered)\n`);
  graded = {};
  for (const t of tasks) {
    process.stdout.write(`  ${t.id.padEnd(24)} `);
    const answer = raw[t.id];
    if (!answer || !String(answer).trim()) { console.log('—  not attempted'); continue; }
    const code = extractCode(String(answer), t.lang);
    const g = await gradeTask(t, code);
    g.code = code;
    reportLine(t, g);
    graded[t.id] = g;
  }
  candidates.push({ id: (flag('id') ?? label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48), name: label, mode: 'self-administered', graded: { ...graded } });
} else {
  const registry = loadRegistry(path.join(ROOT, 'models.json'));
  const wanted = listOf('models');
  // Running "everything keyed in the registry" is a real thing to want, but it must be asked for.
  // As a silent default it turned one mistyped flag into a seven-provider run.
  const allKeyed = registry.filter(m => !m.disabled && m.apiKey && m.apiKey !== 'none');
  let models;
  if (wanted.length) {
    models = wanted.map(s => resolveModel(s, registry)).filter(Boolean);
    const missing = wanted.filter(s => !resolveModel(s, registry));
    if (missing.length) { console.error(`\n  unknown model(s): ${missing.join(', ')}\n`); process.exit(2); }
  } else if (has('all')) {
    models = allKeyed;
    console.log(`\n  --all: ${models.length} keyed model(s): ${models.map(m => m.id).join(', ')}`);
  } else {
    console.error('\n  no model selected. Use --models <id>[,<id>] or --answers <file>.');
    console.error(`  --all would run these ${allKeyed.length}: ${allKeyed.map(m => m.id).join(', ')}\n`);
    process.exit(2);
  }
  if (!models.length) { console.error('\n  no model selected.\n'); process.exit(2); }
  for (const m of models) {
    console.log(`\n  EXECUTED CODING TRACK — ${m.name}${m.vendor ? ` · ${m.vendor}` : ''}\n`);
    graded = {}; callFailures = [];
    await answersFromModel(m);
    const slug = m.id.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 64);
    candidates.push({ id: slug, name: m.name, vendor: m.vendor, model: m.model, mode: 'api',
      graded: { ...graded }, callFailures: [...callFailures] });
  }
}

fs.mkdirSync(OUT, { recursive: true });
for (const c of candidates) {
  const file = path.join(OUT, `${c.id}.json`);

  // MERGE, never clobber. `--tasks x,y` re-runs two tasks; without this the file is rewritten with
  // only those two and eleven real results are gone. The identical bug in bench/run.mjs (`--only`)
  // silently deleted three models' scorecards and cost a full re-run to notice, so the fix lands
  // here too rather than waiting for it to happen a second time.
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const rows = new Map((prior?.tasks ?? []).map(t => [t.id, t]));

  for (const t of tasks) {
    const g = c.graded[t.id];
    if (!g) continue;                                   // not attempted this run — keep any prior row
    rows.set(t.id, { id: t.id, category: t.category, lang: t.lang, weight: t.weight,
      attempted: true, skipped: g.skipped ?? false,
      score: g.total ? g.passed / g.total : 0, passed: g.passed ?? 0, total: g.total ?? 0,
      fatal: g.fatal ?? null, failedChecks: (g.checks ?? []).filter(x => !x.ok).map(x => x.name),
      // The source that was actually executed. CONTRIBUTING.md: "a score nobody can audit is a
      // rumour" — the text track has always stored raw output, and this track shipped without it,
      // so for three local models there was no way to tell a real blind spot from a scorer bug.
      // Two of them failed the SAME two checks on safe-transfer-wrapper and the only way to rule
      // out my own scorer was to run a third model. Store the code; don't repeat that.
      code: g.code ?? null });
  }

  // Recompute over the MERGED set, in canonical task order, so a partial re-run yields the same
  // number a full run would have.
  const ordered = TASKS.map(t => rows.get(t.id)).filter(Boolean);
  const scored = ordered.filter(r => r.attempted && !r.skipped);
  let wSum = 0, wScore = 0;
  const byCat = {};
  for (const r of scored) {
    wSum += r.weight; wScore += r.score * r.weight;
    (byCat[r.category] ||= { s: 0, w: 0 });
    byCat[r.category].s += r.score * r.weight; byCat[r.category].w += r.weight;
  }
  const final = wSum ? wScore / wSum : 0;
  const solved = scored.filter(r => r.total > 0 && r.passed === r.total).length;

  // Nothing graded means every call died. Writing that as a result would publish a network outage
  // as a 0%, and — worse, with merging — overwrite a good file with an empty one.
  if (!scored.length) {
    console.log(`\n  ✖ no task was scored (${(c.callFailures ?? []).length} call failure(s)). Nothing written.\n`);
    continue;
  }
  if (c.callFailures?.length) {
    console.log(`\n  ⚠ ${c.callFailures.length} task(s) never reached the model and are excluded, not zeroed:`);
    console.log(`     ${c.callFailures.join(', ')}`);
  }

  console.log(`\n  ── SCORE ${(final * 100).toFixed(1)}%  (weighted, ${scored.length} task${scored.length === 1 ? '' : 's'} executed)`);
  for (const [cat, v] of Object.entries(byCat)) console.log(`     ${cat.padEnd(18)} ${((v.s / v.w) * 100).toFixed(0)}%`);
  console.log(`     fully solved       ${solved}/${scored.length}`);

  fs.writeFileSync(file, JSON.stringify({
    candidate: { id: c.id, name: c.name, vendor: c.vendor, model: c.model },
    track: 'coding', mode: c.mode, when: new Date().toISOString(),
    score: final, fullySolved: solved, executed: scored.length, total: TASKS.length,
    byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.s / v.w])),
    ...(c.callFailures?.length ? { callFailures: c.callFailures } : {}),
    tasks: ordered,
  }, null, 2));
  console.log(`\n  → ${path.relative(ROOT, file)}\n`);
}
