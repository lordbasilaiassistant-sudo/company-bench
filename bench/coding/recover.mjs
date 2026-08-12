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
 * Measured on safe-transfer-wrapper, the first task this was run on:
 *
 *   Qwythos 9B   4/6 -> 6/6   one round. Its logic was right; it had written BigInt('0x' + data)
 *                             where data already began with '0x'. A typo, and the harness kills it.
 *   Defiant 9B   4/6 -> 4/6   handed the exact failing assertions and the thrown error, three
 *                             rounds, never converged.
 *
 * Both scored 4/6 one-shot. They are not the same candidate, and only this track can see it.
 *
 * WHAT THE MODEL IS TOLD
 *
 * Only what a CI log would show: the names of the checks that failed and the exception each one
 * threw. Never the test source, never a diagnosis, never a hint about the cause. If the feedback
 * explained the bug the track would measure instruction-following, which the bench already has
 * eleven better ways to measure.
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

/** A CI log, and nothing more. */
function failureReport(g) {
  if (g.fatal) return `The file did not run at all:\n  ${g.fatal}`;
  const bad = (g.checks ?? []).filter(c => !c.ok);
  return ['I ran the tests. These failed:', ...bad.map(c => `  ${c.name}${c.err ? `  ->  ${c.err}` : ''}`)].join('\n');
}

function retryPrompt(task, code, g) {
  return [
    task.prompt, '', 'Your previous answer was:', '',
    '```', code, '```', '',
    failureReport(g), '',
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
  const file = path.join(OUT, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({
    candidate: { id, name: model.name, model: model.model }, track: 'coding-recovery',
    when: new Date().toISOString(), maxRounds: ROUNDS,
    oneShot: wAvg('firstScore'), afterFeedback: wAvg('finalScore'),
    recoveryRate: rate, needed: needed.length, recovered: needed.filter(r => r.recovered).length,
    tasks: rows,
  }, null, 2));
  console.log(`\n  → ${path.relative(ROOT, file)}\n`);
}
