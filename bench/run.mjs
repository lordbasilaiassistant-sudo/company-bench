#!/usr/bin/env node
/**
 * bench/run.mjs — sit a model in every chair, using your own API keys.
 *
 *   node bench/run.mjs                          # every enabled model in models.json
 *   node bench/run.mjs --models groq-llama70b   # one candidate
 *   node bench/run.mjs --models ollama:qwen3:8b # anything local, no registry entry needed
 *   node bench/run.mjs --models anthropic:claude-opus-5
 *   node bench/run.mjs --skip treasury          # skip a department
 *   node bench/run.mjs --only integrity,security
 *   node bench/run.mjs --list                   # show the org chart and exit
 *
 * Keys come from real environment variables first, then a local .env. Nothing is uploaded
 * anywhere; every prompt is a fixed string in this repo and every score is computed here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPARTMENTS, chairsFor, CHAIR_COUNT, CHECK_COUNT } from './positions/index.mjs';
import { chat, loadRegistry, resolveModel } from './lib/transport.mjs';
import { buildResult, printScorecard, renderResume } from './lib/scorecard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const RESULTS = path.join(ROOT, 'results');
const CARDS = path.join(ROOT, 'results', 'cards');

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = n => argv.includes(`--${n}`);
const list = n => (flag(n) ?? '').split(',').map(s => s.trim()).filter(Boolean);

if (has('list')) {
  console.log(`\n  COMPANY BENCH — ${CHAIR_COUNT} chairs, ${CHECK_COUNT} deterministic checks\n`);
  for (const d of DEPARTMENTS) {
    console.log(`  ${d.label.toUpperCase()}${d.optional ? '  (optional)' : ''}`);
    console.log(`  ${d.question}`);
    for (const ch of d.chairs) console.log(`    ${ch.id.padEnd(16)} ${ch.title}\n      ${ch.blurb}`);
    console.log('');
  }
  process.exit(0);
}

const skip = list('skip');
const only = list('only');
const chairs = chairsFor({ skip, only });
if (!chairs.length) { console.error('no chairs selected'); process.exit(2); }

const registry = loadRegistry(path.join(ROOT, 'models.json'));
const wanted = list('models');
let candidates;
if (wanted.length) {
  candidates = wanted.map(spec => {
    const m = resolveModel(spec, registry);
    if (!m) { console.error(`unknown model "${spec}" — add it to models.json or use ollama:/openai:/anthropic: prefix`); process.exit(2); }
    return m;
  });
} else {
  candidates = registry.filter(m => !m.disabled && m.apiKey);
  const noKey = registry.filter(m => !m.disabled && !m.apiKey);
  if (noKey.length) console.log(`  (skipping ${noKey.length} model(s) with no key set: ${noKey.map(m => m.keyEnv).join(', ')})`);
  if (!candidates.length) {
    console.error('\n  No usable models. Set at least one key, e.g.:\n    export GROQ_API_KEY=...      (free tier, https://console.groq.com)\n    export ZAI_API_KEY=...\n  Or run a local one:  node bench/run.mjs --models ollama:llama3.2\n');
    process.exit(2);
  }
}

fs.mkdirSync(RESULTS, { recursive: true });
fs.mkdirSync(CARDS, { recursive: true });

for (const model of candidates) {
  if (model.keyEnv && !model.apiKey) {
    console.error(`\n  ${model.id}: no key in ${model.keyEnv} — skipping`);
    continue;
  }
  console.log(`\n  ═══ ${model.name}${model.vendor ? ` · ${model.vendor}` : ''} ═══`);
  const out = {};
  for (const chair of chairs) {
    process.stdout.write(`  ${chair.id.padEnd(16)} `);
    try {
      const { text, ms, tokens, genRate } = await chat(model, chair.prompt);
      const checks = chair.score(text);
      const passed = checks.filter(c => c.pass).length;
      const pct = Math.round((100 * passed) / checks.length);
      out[chair.id] = { title: chair.title, dept: chair.dept, pct, passed, total: checks.length, ms, tokens, genRate, checks, raw: text };
      const traps = checks.filter(c => !c.pass && /^TRAP/.test(c.label)).length;
      console.log(`${String(pct).padStart(3)}%  ${passed}/${checks.length}  ${(ms / 1000).toFixed(1)}s${traps ? `  ${traps} trap(s) taken` : ''}`);
    } catch (e) {
      const total = chair.score('').length;
      out[chair.id] = { title: chair.title, dept: chair.dept, pct: 0, passed: 0, total, ms: null, checks: [], raw: '', error: String(e.message ?? e).slice(0, 200) };
      console.log(`ERROR  ${String(e.message ?? e).slice(0, 90)}`);
    }
  }

  // `ollama:hf.co/vendor/model:Q8_0` is a perfectly good model id and a terrible filename.
  const slug = model.id.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 64);

  // A partial run (--only / --skip) MERGES over the stored result. Overwriting instead silently
  // deletes every chair you did not re-run, which looks like a model collapsing rather than like
  // a harness bug — measured the hard way when adding a department wiped three candidates.
  let merged = out;
  if (only.length || skip.length) {
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(RESULTS, `${slug}.json`), 'utf8'));
      if (prev.chairs) merged = { ...prev.chairs, ...out };
    } catch { /* first run for this model */ }
  }
  const result = buildResult({
    candidate: { id: slug, name: model.name, vendor: model.vendor, model: model.model, cost: model.cost },
    chairs: merged, mode: 'api',
  });
  printScorecard(result);
  fs.writeFileSync(path.join(RESULTS, `${slug}.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(CARDS, `${slug}.md`), renderResume(result));
  console.log(`  → results/${slug}.json  ·  results/cards/${slug}.md\n`);
}
