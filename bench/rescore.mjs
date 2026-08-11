#!/usr/bin/env node
/**
 * bench/rescore.mjs — re-apply the current scorers to transcripts already on disk.
 *
 *   node bench/rescore.mjs            # every result in results/
 *   node bench/rescore.mjs groq-llama70b
 *
 * Chairs get hardened, and scorers get fixed. Both invalidate committed scores. Because every
 * result file stores the model's raw output, a change to a scorer can be replayed against the
 * exact same words without paying for inference again — and, more importantly, without anyone
 * having to trust that the old number and the new number were produced the same way.
 *
 * This is also the audit path: if you think a score is wrong, edit the check, run this, and
 * see precisely which candidates it moves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAIRS } from './positions/index.mjs';
import { buildResult, renderResume } from './lib/scorecard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const RESULTS = path.join(ROOT, 'results');
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));

const files = fs.readdirSync(RESULTS)
  .filter(f => f.endsWith('.json') && f !== 'LEADERBOARD.md')
  .filter(f => !only.length || only.includes(path.basename(f, '.json')));

if (!files.length) { console.error('  nothing to rescore'); process.exit(1); }

let moved = 0;
for (const f of files) {
  const prev = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'));
  if (!prev.chairs) continue;

  const out = {};
  const deltas = [];
  for (const [id, old] of Object.entries(prev.chairs)) {
    const chair = CHAIRS.find(c => c.id === id);
    if (!chair) { out[id] = old; continue; }           // chair was removed; keep history intact
    if (old.error) { out[id] = old; continue; }        // no transcript to rescore
    if (typeof old.raw !== 'string') { out[id] = old; continue; }

    const checks = chair.score(old.raw);
    const passed = checks.filter(c => c.pass).length;
    const pct = Math.round((100 * passed) / checks.length);
    out[id] = { ...old, title: chair.title, dept: chair.dept, pct, passed, total: checks.length, checks };
    if (pct !== old.pct) deltas.push(`${id} ${old.pct}→${pct}`);
  }

  const next = buildResult({ candidate: prev.candidate, chairs: out, mode: prev.mode });
  next.rescoredFrom = prev.when;
  if (prev.skippedChairs) next.skippedChairs = prev.skippedChairs;

  fs.writeFileSync(path.join(RESULTS, f), JSON.stringify(next, null, 2));
  fs.mkdirSync(path.join(RESULTS, 'cards'), { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'cards', f.replace(/\.json$/, '.md')), renderResume(next));

  const lvl = prev.placement?.level !== next.placement.level
    ? `  level ${prev.placement?.level} → ${next.placement.level}` : '';
  if (deltas.length || lvl) moved++;
  console.log(`  ${path.basename(f, '.json').padEnd(28)} ${deltas.length ? deltas.join('  ') : 'unchanged'}${lvl}`);
}
console.log(`\n  ${files.length} result(s) rescored, ${moved} moved.\n`);
