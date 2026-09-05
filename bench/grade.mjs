#!/usr/bin/env node
/**
 * bench/grade.mjs — score an answer set produced by hand, by an agent, or by any runner.
 *
 *   node bench/grade.mjs answers.json --label "Claude Opus 5"
 *   node bench/grade.mjs answers.json --label "MyAgent" --id my-agent
 *
 * answers.json = { "<chairId>": "<the complete raw reply>", ... }
 *
 * The grader is the same code the API runner uses, so a self-administered result and a
 * key-driven result land on the same leaderboard. A chair with no answer scores zero and is
 * reported as unanswered rather than as a wrong answer — those are different failures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAIRS } from './positions/index.mjs';
import { buildResult, printScorecard } from './lib/scorecard.mjs';
import { provenance } from './lib/suite.mjs';
import { writeResult } from './lib/result-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const argv = process.argv.slice(2);
const valueFlags = new Set(['--label', '--id', '--vendor', '--model', '--cost']);
let positionalCount = 0;
for (let i = 0; i < argv.length; i++) {
  if (valueFlags.has(argv[i])) {
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) { console.error(`missing value for ${argv[i]}`); process.exit(2); }
    i++;
  } else if (argv[i] === '--merge') continue;
  else if (argv[i].startsWith('--') || ++positionalCount > 1) { console.error(`unknown argument: ${argv[i]}`); process.exit(2); }
}
const flag = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const fail = message => { console.error(message); process.exit(2); };
if (argv.includes('--merge')) fail('--merge is unsupported: each measurement must remain a separate run');

// first positional argument: skip every --flag and the value that follows it
let file;
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { i++; continue; }
  file = argv[i]; break;
}
if (!file) {
  console.error('\n  usage: node bench/grade.mjs answers.json --label "Your Model Name"\n');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error(`  no such file: ${file}`); process.exit(2); }

let answers;
try { answers = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch { fail('answers must be a valid JSON object of chair IDs to raw reply strings'); }
if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail('answers must be a JSON object');
if (Object.values(answers).some(value => typeof value !== 'string')) fail('every answer must be a raw reply string');
const LABEL = flag('label') ?? path.basename(file, '.json');
const ID = flag('id') ?? LABEL.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(ID)) fail('--id must be 1–80 letters, digits, hyphens or underscores and start with a letter or digit');

const unknown = Object.keys(answers).filter(k => !CHAIRS.some(c => c.id === k));
if (unknown.length) fail(`unknown chair key(s): ${unknown.join(', ')}`);

const out = {};
let answered = 0;
for (const chair of CHAIRS) {
  const raw = answers[chair.id];
  if (raw === undefined || String(raw).trim() === '') {
    const total = chair.score('').length;
    out[chair.id] = { title: chair.title, dept: chair.dept, pct: 0, passed: 0, total, ms: null, checks: [], raw: '', unanswered: true };
    continue;
  }
  answered++;
  // A scorer that throws on a malformed-but-plausible answer must cost ONE chair, never abort
  // the whole grading run. Measured: discrepancies sent as a string instead of an array threw
  // TypeError and took every remaining chair down with it.
  let checks;
  try { checks = chair.score(String(raw)); }
  catch (e) {
    const total = chair.score('').length;
    out[chair.id] = { title: chair.title, dept: chair.dept, pct: 0, passed: 0, total, ms: null, checks: [], raw: String(raw), scorerError: String(e.message ?? e).slice(0, 160) };
    continue;
  }
  const passed = checks.filter(c => c.pass).length;
  out[chair.id] = {
    title: chair.title, dept: chair.dept, pct: Math.round((100 * passed) / checks.length),
    passed, total: checks.length, ms: null, checks, raw: String(raw),
  };
}

// Chairs the taker chose not to sit are not counted against it — but they are never counted FOR
// it either: they simply do not exist in the placement, and the card says so.
const skipped = Object.entries(out).filter(([, r]) => r.unanswered).map(([id]) => id);
for (const id of skipped) delete out[id];

if (!Object.keys(out).length) {
  console.error('\n  Every answer was empty. Fill in answers.json first — see bench-pack/TAKE-THE-BENCH.md\n');
  process.exit(2);
}

const result = buildResult({
  candidate: { id: ID, name: LABEL, vendor: flag('vendor'), model: flag('model') ?? LABEL, cost: flag('cost') },
  chairs: out, mode: 'self-administered',
  provenance: { ...provenance({ chairs: CHAIRS.filter(c => out[c.id]), collection: 'self-administered',
    settings: { model: flag('model') ?? LABEL, temperature: null, maxTokens: null } }),
    collectedAt: null, gradedAt: new Date().toISOString(),
    acquisitionVerified: false,
    uncertainty: 'Prompt delivery, model identity, generation settings, tools, retries and prior scorer exposure are unverified. Hashes identify the grading suite, not proven answer acquisition.' },
});
result.skippedChairs = skipped;

printScorecard(result);
if (skipped.length) {
  console.log(`  \x1b[90mnot attempted (${skipped.length}): ${skipped.join(', ')}\x1b[0m`);
  console.log(`  \x1b[90mthese are excluded from the placement, not scored as zero\x1b[0m\n`);
}

console.log('  Self-administered: answer acquisition and model settings are unverified.');
console.log(`  → ${writeResult(result)}\n`);
