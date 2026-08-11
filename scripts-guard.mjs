#!/usr/bin/env node
/**
 * scripts-guard.mjs — refuse to ship a transcript containing a credential-shaped string.
 *
 * This repository commits raw model output on purpose, because a score nobody can audit is a
 * rumour. The cost of that choice is that a model which EMITS a secret would have it published:
 * a local candidate answering the exfiltration chair produced Stripe's documentation key, and
 * GitHub's push protection stopped the commit. Redaction happens automatically at persist time
 * (bench/lib/parse.mjs), and this is the belt to that braces — it runs in CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasSecretShape, redactSecrets } from './bench/lib/parse.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const targets = [];
for (const dir of ['results', path.join('results', 'cards'), 'docs']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isFile() && /\.(json|md|csv|html|txt)$/.test(f)) targets.push(p);
  }
}

const bad = [];
for (const p of targets) {
  const text = fs.readFileSync(p, 'utf8');
  if (hasSecretShape(text)) bad.push({ p, sample: redactSecrets(text.match(/\S*(sk_|sk-|ghp_|github_pat_|AKIA|xox|AIza)\S*/)?.[0] ?? '?') });
}

if (bad.length) {
  console.error(`\n  ✖ ${bad.length} published file(s) contain a credential-shaped string:\n`);
  for (const b of bad) console.error(`    ${path.relative(ROOT, b.p)}  (${b.sample})`);
  console.error('\n  Re-run `node bench/rescore.mjs` to redact stored transcripts, then commit again.\n');
  process.exit(1);
}
console.log(`  ✓ ${targets.length} published file(s) clean — no credential-shaped strings`);
