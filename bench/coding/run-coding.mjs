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

const only = listOf('tasks');
const tasks = only.length ? TASKS.filter(t => only.includes(t.id)) : TASKS;

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
      answers[t.id] = '';
      process.stdout.write(`call failed: ${String(e.message).slice(0, 50)}  `);
    }
    const g = await gradeTask(t, extractCode(answers[t.id] ?? '', t.lang));
    reportLine(t, g);
    graded[t.id] = g;
  }
  return answers;
}

let graded = {};
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
    const g = await gradeTask(t, extractCode(String(answer), t.lang));
    reportLine(t, g);
    graded[t.id] = g;
  }
  candidates.push({ id: (flag('id') ?? label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48), name: label, mode: 'self-administered', graded: { ...graded } });
} else {
  const registry = loadRegistry(path.join(ROOT, 'models.json'));
  const wanted = listOf('models');
  const models = wanted.length
    ? wanted.map(s => resolveModel(s, registry)).filter(Boolean)
    : registry.filter(m => !m.disabled && m.apiKey);
  if (!models.length) { console.error('\n  no model selected. --models <id> or --answers <file>\n'); process.exit(2); }
  for (const m of models) {
    console.log(`\n  EXECUTED CODING TRACK — ${m.name}${m.vendor ? ` · ${m.vendor}` : ''}\n`);
    graded = {};
    await answersFromModel(m);
    const slug = m.id.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 64);
    candidates.push({ id: slug, name: m.name, vendor: m.vendor, model: m.model, mode: 'api', graded: { ...graded } });
  }
}

fs.mkdirSync(OUT, { recursive: true });
for (const c of candidates) {
  const scored = tasks.filter(t => c.graded[t.id] && !c.graded[t.id].skipped);
  let wSum = 0, wScore = 0;
  const byCat = {};
  for (const t of scored) {
    const g = c.graded[t.id];
    const s = g.total ? g.passed / g.total : 0;
    wSum += t.weight; wScore += s * t.weight;
    (byCat[t.category] ||= { s: 0, w: 0 });
    byCat[t.category].s += s * t.weight; byCat[t.category].w += t.weight;
  }
  const final = wSum ? wScore / wSum : 0;
  const solved = scored.filter(t => c.graded[t.id].passed === c.graded[t.id].total && c.graded[t.id].total > 0).length;

  console.log(`\n  ── SCORE ${(final * 100).toFixed(1)}%  (weighted, ${scored.length} task${scored.length === 1 ? '' : 's'} executed)`);
  for (const [cat, v] of Object.entries(byCat)) console.log(`     ${cat.padEnd(18)} ${((v.s / v.w) * 100).toFixed(0)}%`);
  console.log(`     fully solved       ${solved}/${scored.length}`);

  const file = path.join(OUT, `${c.id}.json`);
  fs.writeFileSync(file, JSON.stringify({
    candidate: { id: c.id, name: c.name, vendor: c.vendor, model: c.model },
    track: 'coding', mode: c.mode, when: new Date().toISOString(),
    score: final, fullySolved: solved, executed: scored.length, total: tasks.length,
    byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.s / v.w])),
    tasks: tasks.map(t => {
      const g = c.graded[t.id];
      return { id: t.id, category: t.category, lang: t.lang, weight: t.weight,
        attempted: !!g, skipped: g?.skipped ?? false,
        score: g && g.total ? g.passed / g.total : 0, passed: g?.passed ?? 0, total: g?.total ?? 0,
        fatal: g?.fatal ?? null, failedChecks: (g?.checks ?? []).filter(x => !x.ok).map(x => x.name) };
    }),
  }, null, 2));
  console.log(`\n  → ${path.relative(ROOT, file)}\n`);
}
