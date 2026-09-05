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
import { DEPARTMENTS, CHAIRS, chairsFor, CHAIR_COUNT, CHECK_COUNT } from './positions/index.mjs';
import { chat, loadRegistry, resolveModel } from './lib/transport.mjs';
import { buildResult, printScorecard } from './lib/scorecard.mjs';
import { provenance } from './lib/suite.mjs';
import { writeResult } from './lib/result-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const argv = process.argv.slice(2);
const valueFlags = new Set(['--models', '--skip', '--only', '--system']);
for (let i = 0; i < argv.length; i++) {
  if (valueFlags.has(argv[i])) {
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) { console.error(`missing value for ${argv[i]}`); process.exit(2); }
    i++;
  } else if (!['--list', '--merge'].includes(argv[i])) { console.error(`unknown argument: ${argv[i]}`); process.exit(2); }
}
const flag = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

/**
 * --system <file>  run every chair with that file as the model's system prompt.
 *
 * For measuring whether a standing instruction file helps or hobbles: same model, same chairs,
 * one variable. The result is filed under a DIFFERENT id and carries the prompt's identity, because
 * a run with a system prompt and a run without are two different candidates. CONTRIBUTING.md is
 * explicit that anything other than the committed prompt at temperature 0 must be stated in the
 * label — an A/B nobody can tell apart is just two numbers.
 */
const systemFile = flag('system');
let SYSTEM = null, SYSTEM_TAG = '';
if (systemFile) {
  SYSTEM = fs.readFileSync(systemFile, 'utf8');
  const bytes = Buffer.byteLength(SYSTEM);
  // A short, stable fingerprint so two runs of the "same" file can be told apart if it was edited.
  let h = 5381; for (let i = 0; i < SYSTEM.length; i++) h = ((h * 33) ^ SYSTEM.charCodeAt(i)) >>> 0;
  SYSTEM_TAG = `${path.basename(systemFile).replace(/\.[^.]+$/, '')}-${h.toString(36).slice(0, 6)}`;
  console.log(`\n  SYSTEM PROMPT: ${systemFile} (${bytes} bytes, tag ${SYSTEM_TAG})`);
  console.log('  This run is NOT comparable to a run without it and is filed separately.\n');
}
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
const unknown = [...skip, ...only].filter(id => !CHAIRS.some(c => c.id === id || c.dept === id));
if (unknown.length) { console.error(`unknown chair or department: ${unknown.join(', ')}`); process.exit(2); }
if (has('merge')) { console.error('--merge is unsupported: each measurement must remain a separate run'); process.exit(2); }
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

for (const model of candidates) {
  if (model.keyEnv && !model.apiKey) {
    console.error(`\n  ${model.id}: no key in ${model.keyEnv} — skipping`);
    process.exitCode = 2;
    continue;
  }
  const endpoint = new URL(model.baseUrl);
  endpoint.username = ''; endpoint.password = ''; endpoint.search = ''; endpoint.hash = '';
  const runProvenance = provenance({ chairs, system: SYSTEM ?? model.system ?? null,
    settings: { api: model.api ?? 'openai', model: model.model, baseUrl: endpoint.toString(),
      temperature: model.extraBody?.temperature ?? 0,
      maxTokens: model.extraBody?.max_tokens ?? model.maxTokens ?? 4000,
      numCtx: model.api === 'ollama' ? model.numCtx ?? 8192 : null,
      think: model.api === 'ollama' ? model.think ?? false : null,
      extraBody: model.extraBody ?? null } });
  console.log(`\n  ═══ ${model.name}${model.vendor ? ` · ${model.vendor}` : ''} ═══`);
  const out = {};
  for (const chair of chairs) {
    const collectedAt = new Date().toISOString();
    process.stdout.write(`  ${chair.id.padEnd(16)} `);
    try {
      const { text, ms, tokens, genRate } = await chat(model, chair.prompt, SYSTEM !== null ? { system: SYSTEM } : {});
      const checks = chair.score(text);
      const passed = checks.filter(c => c.pass).length;
      const pct = Math.round((100 * passed) / checks.length);
      out[chair.id] = { title: chair.title, dept: chair.dept, pct, passed, total: checks.length, ms, tokens, genRate, checks, raw: text, collectedAt };
      const traps = checks.filter(c => !c.pass && /^TRAP/.test(c.label)).length;
      console.log(`${String(pct).padStart(3)}%  ${passed}/${checks.length}  ${(ms / 1000).toFixed(1)}s${traps ? `  ${traps} trap(s) taken` : ''}`);
    } catch (e) {
      const total = chair.score('').length;
      out[chair.id] = { title: chair.title, dept: chair.dept, pct: 0, passed: 0, total, ms: null, checks: [], raw: '', error: String(e.message ?? e).slice(0, 200) };
      console.log(`ERROR  ${String(e.message ?? e).slice(0, 90)}`);
      out[chair.id].collectedAt = collectedAt;
      process.exitCode = 1;
    }
  }

  // `ollama:hf.co/vendor/model:Q8_0` is a perfectly good model id and a terrible filename.
  let slug = model.id.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 64);
  if (SYSTEM_TAG) slug = `${slug}--sys-${SYSTEM_TAG}`.slice(0, 80);

  const result = buildResult({
    candidate: { id: slug, name: model.name + (SYSTEM_TAG ? ` (+${SYSTEM_TAG})` : ''),
      vendor: model.vendor, model: model.model, cost: model.cost },
    chairs: out, mode: 'api', provenance: runProvenance,
  });
  if (SYSTEM_TAG) result.systemPrompt = { file: systemFile, bytes: Buffer.byteLength(SYSTEM), tag: SYSTEM_TAG };
  printScorecard(result);
  console.log(`  → ${writeResult(result)}\n`);
}
