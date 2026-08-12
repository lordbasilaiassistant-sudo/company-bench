#!/usr/bin/env node
/**
 * bench/coding/recover.mjs — the recovery track: can it fix its own code when the tests fail?
 *
 *   node bench/coding/recover.mjs --models ollama-qwythos-9b-fc
 *   node bench/coding/recover.mjs --models a,b --rounds 3 --tasks fee-split-bps
 *
 * WHY THIS EXISTS
 *
 * The one-shot coding score answers "did it write correct code with no feedback", which is a
 * question nobody actually asks of a working agent. Every real harness runs the tests and hands
 * back the failures. So the useful question is not "was it right first time" but "does a failing
 * test make it right" — and those two rank models DIFFERENTLY.
 *
 * Measured over the four crypto tasks the local candidates struggled with, `--feedback ci`:
 *
 *   Defiant Fable 9B   one-shot 53.1%  ->  91.0%   recovered 2 of the 4 it got wrong
 *   Qwythos 9B         one-shot 74.9%  ->  74.9%   recovered 0 of 3; resubmitted identical code
 *   Qwen3-Coder 30B    one-shot 100%                solved all four first try
 *
 * That ordering is not the one-shot ordering: on the full 13-task coding track Qwythos beats
 * Defiant 91.7% to 79.7%, and here it is the other way round. A model that is usually right and
 * cannot be corrected and a model that is often wrong and fixes itself are different hires, and
 * the one-shot score cannot tell them apart.
 *
 * A WARNING ABOUT SMALL SAMPLES, PAID FOR
 *
 * The first version of this measurement was a scratch script on ONE task, and it reported the
 * exact opposite: Qwythos recovering and Defiant stuck. That result was published to the person
 * asking before the full run existed. One task is not a measurement of a model, and the pull to
 * report the first striking number is strongest precisely when it is most likely to be noise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.mjs';
import { extractCode } from './extract.mjs';
import { gradeTask, python } from './exec.mjs';
import { chat, loadRegistry, resolveModel } from '../lib/transport.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = path.join(ROOT, 'results', 'coding', 'recovery');

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const listOf = n => (flag(n) ?? '').split(',').map(s => s.trim()).filter(Boolean);

const ROUNDS = Math.max(1, Number(flag('rounds') ?? 2));
const only = listOf('tasks');
const tasks = only.length ? TASKS.filter(t => only.includes(t.id)) : TASKS;

/**
 * Two feedback modes, because they model two different real situations and they do NOT rank models
 * the same way.
 *
 *   ci      — check names and thrown errors only. The tests stay hidden. This is a graded exam, and
 *             it is what a closed CI or a review gate gives you.
 *   harness — the same, plus the source of each failing assertion. This is what an agent working in
 *             an actual repository sees, because the test file is right there and it can read it.
 *             It is the realistic setting for "can this model drive Claude Code on my code".
 *
 * The distinction is not cosmetic. On safe-transfer-wrapper, Qwythos 9B resubmitted byte-identical
 * code under `ci` and fixed the bug when the expected call and value were spelled out. Neither
 * number is wrong; they answer different questions, and quoting one as the other is how a model
 * gets called stubborn when it was only under-informed.
 */
const MODE = (flag('feedback') ?? 'ci').toLowerCase();
if (!['ci', 'harness'].includes(MODE)) { console.error(`\n  --feedback must be ci or harness\n`); process.exit(2); }

/** Pull the `_chk("name", ...)` line for a named check out of a task's test source. */
function assertionFor(task, name) {
  const re = new RegExp(`_chk\\(\\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][\\s\\S]*?$`, 'm');
  const m = re.exec(task.tests ?? '');
  return m ? m[0].split('\n')[0].trim() : null;
}

function failureReport(task, g) {
  if (g.fatal) return `The file did not run at all:\n  ${g.fatal}`;
  const bad = (g.checks ?? []).filter(c => !c.ok);
  const lines = bad.map(c => {
    const head = `  ${c.name}${c.err ? `  ->  ${c.err}` : ''}`;
    if (MODE !== 'harness') return head;
    const src = assertionFor(task, c.name);
    return src ? `${head}\n      the assertion was: ${src}` : head;
  });
  return ['I ran the tests. These failed:', ...lines].join('\n');
}

function retryPrompt(task, code, g) {
  return [
    task.prompt, '', 'Your previous answer was:', '',
    '```', code, '```', '',
    failureReport(task, g), '',
    'Fix it. Reply with ONE code block containing only the corrected code, and no explanation.',
  ].join('\n');
}

const registry = loadRegistry(path.join(ROOT, 'models.json'));
const wanted = listOf('models');
const models = wanted.map(s => registry.find(m => m.id === s) ?? resolveModel(s, registry)).filter(Boolean);
if (!models.length) { console.error('\n  no model selected. --models <id>[,<id>]\n'); process.exit(2); }
if (tasks.some(t => t.lang === 'py') && !python()) {
  console.log('  ⚠ no python interpreter found — Python tasks will be skipped, not failed');
}

fs.mkdirSync(OUT, { recursive: true });

for (const model of models) {
  console.log(`\n  RECOVERY TRACK — ${model.name}   (up to ${ROUNDS} round${ROUNDS === 1 ? '' : 's'})\n`);
  const rows = [];

  for (const t of tasks) {
    process.stdout.write(`  ${t.id.padEnd(24)} `);
    let code = null, g = null, unreachable = null;

    try {
      const r = await chat(model, t.prompt, { maxTokens: model.maxTokens ?? 3000 });
      code = extractCode(r.text, t.lang);
      g = await gradeTask(t, code);
    } catch (e) { unreachable = String(e.message).slice(0, 80); }

    // A dead socket is not a coding failure and must never be scored as one.
    if (unreachable) { console.log(`⚠ call failed, NOT scored: ${unreachable}`); continue; }
    if (g.skipped) { console.log('⃠ skipped'); continue; }

    const first = g.total ? g.passed / g.total : 0;
    process.stdout.write(`${g.passed}/${g.total}`);

    let rounds = 0;
    while (g.total && g.passed < g.total && rounds < ROUNDS - 1) {
      rounds++;
      let next;
      try {
        const r = await chat(model, retryPrompt(t, code, g), { maxTokens: model.maxTokens ?? 3000 });
        next = extractCode(r.text, t.lang);
      } catch (e) { process.stdout.write(`  ⚠ retry call failed: ${String(e.message).slice(0, 40)}`); break; }
      // An empty or unchanged reply is a refusal to iterate; stop rather than burn rounds on it.
      if (!next.trim() || next.trim() === code.trim()) { process.stdout.write('  → unchanged'); break; }
      code = next;
      g = await gradeTask(t, code);
      process.stdout.write(` → ${g.passed}/${g.total}`);
    }

    const last = g.total ? g.passed / g.total : 0;
    const solvedFirst = first === 1;
    const recovered = !solvedFirst && last === 1;
    console.log(recovered ? '   ✔ recovered' : last > first ? '   ~ improved' : solvedFirst ? '' : '   ✖ stuck');

    rows.push({ id: t.id, category: t.category, weight: t.weight,
      firstScore: first, finalScore: last, rounds, solvedFirst, recovered,
      finalFailedChecks: (g.checks ?? []).filter(c => !c.ok).map(c => c.name), code });
  }

  // Recovery rate is over tasks that HAD something to recover from. Counting first-try solves as
  // successful recoveries would score the strongest model lowest, which is how this metric is
  // usually reported and why it is usually useless.
  const needed = rows.filter(r => !r.solvedFirst);
  const rate = needed.length ? needed.filter(r => r.recovered).length / needed.length : null;
  const wAvg = k => { let s = 0, w = 0; for (const r of rows) { s += r[k] * r.weight; w += r.weight; } return w ? s / w : 0; };

  console.log(`\n  ── one-shot ${(wAvg('firstScore') * 100).toFixed(1)}%   after feedback ${(wAvg('finalScore') * 100).toFixed(1)}%`);
  console.log(`     recovered ${needed.filter(r => r.recovered).length}/${needed.length} of the tasks it got wrong` +
    (rate === null ? '' : `  (${(rate * 100).toFixed(0)}%)`));

  const id = (model.id ?? model.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 64);
  // Mode is part of the identity: a ci run and a harness run of the same model are two different
  // measurements and must not overwrite one another.
  const file = path.join(OUT, `${id}.${MODE}.json`);
  fs.writeFileSync(file, JSON.stringify({
    candidate: { id, name: model.name, model: model.model }, track: 'coding-recovery',
    when: new Date().toISOString(), maxRounds: ROUNDS, feedback: MODE,
    oneShot: wAvg('firstScore'), afterFeedback: wAvg('finalScore'),
    recoveryRate: rate, needed: needed.length, recovered: needed.filter(r => r.recovered).length,
    tasks: rows,
  }, null, 2));
  console.log(`\n  → ${path.relative(ROOT, file)}\n`);
}
