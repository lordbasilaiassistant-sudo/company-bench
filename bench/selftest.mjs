#!/usr/bin/env node
/**
 * bench/selftest.mjs — prove the scorers before they judge anyone.
 *
 * Two directions, both required for every chair:
 *   1. the `gold` answer scores 100%  — otherwise a candidate's low score is measuring OUR bug,
 *      and a benchmark that punishes correct answers is worse than no benchmark
 *   2. the `decoy` answer scores below 100% — otherwise the chair passes anything and is decor
 *
 * A third pass checks that every chair actually contains a trap, because a chair whose worst
 * plausible answer still scores 100% is a checklist, and models pass checklists.
 *
 * Run this before every commit. CI runs it on every push.
 */
import { CHAIRS, DEPARTMENTS } from './positions/index.mjs';

let failures = 0;
const pct = checks => Math.round((100 * checks.filter(c => c.pass).length) / checks.length);

console.log('\n  SELFTEST — every chair must accept its gold answer and reject its decoy\n');

for (const d of DEPARTMENTS) {
  console.log(`  ${d.label}`);
  for (const chair of d.chairs) {
    const problems = [];

    if (typeof chair.gold !== 'string' || !chair.gold.trim()) problems.push('no gold answer defined');
    if (typeof chair.decoy !== 'string' || !chair.decoy.trim()) problems.push('no decoy answer defined');

    let goldPct = null, decoyPct = null, goldMissed = [];
    if (!problems.length) {
      const g = chair.score(chair.gold);
      goldPct = pct(g);
      goldMissed = g.filter(c => !c.pass).map(c => c.label);
      if (goldPct !== 100) problems.push(`gold scores ${goldPct}% — the scorer rejects a correct answer`);

      const dec = chair.score(chair.decoy);
      decoyPct = pct(dec);
      if (decoyPct === 100) problems.push('decoy scores 100% — this chair passes the wrong answer');
    }

    // ── ANTI-FITTING CHECK ────────────────────────────────────────────────────────────────
    // The deepest bias in this benchmark: selftest requires `gold` to score 100%, and gold is
    // written by whoever wrote the scorer. Every failing check therefore gets "fixed" until the
    // author's own phrasing passes, so the scorers end up fitted to one output distribution.
    // No other candidate is ever given that treatment.
    //
    // The mitigation is VARIANTS: additional, independently-worded correct answers that must ALSO
    // score 100%. A check that accepts one wording and rejects another equally correct one is
    // measuring style, not substance. Chairs without variants are reported rather than failed —
    // but the coverage is printed, so the gap stays visible instead of comfortable.
    const variants = Array.isArray(chair.variants) ? chair.variants : [];
    variants.forEach((v, vi) => {
      const vp = pct(chair.score(v));
      if (vp !== 100) {
        problems.push(`variant ${vi + 1} scores ${vp}% — a differently-worded CORRECT answer is rejected`);
        for (const c of chair.score(v).filter(x => !x.pass)) problems.push(`  variant ${vi + 1} missed: ${c.label}`);
      }
    });
    const trapChecks = chair.score('').filter(c => /^TRAP/.test(c.label)).length;
    if (!trapChecks) problems.push('no check labelled TRAP — a chair without a trap measures nothing');

    // An empty answer must never score well: it would make silence a viable strategy.
    const emptyPct = pct(chair.score(''));
    if (emptyPct > 40) problems.push(`empty answer scores ${emptyPct}% — silence is too cheap here`);

    if (problems.length) {
      failures++;
      console.log(`    ✖ ${chair.id}`);
      for (const p of problems) console.log(`        ${p}`);
      if (goldMissed.length) for (const m of goldMissed) console.log(`        gold missed: ${m}`);
    } else {
      console.log(`    ✓ ${chair.id.padEnd(16)} gold ${goldPct}%  decoy ${String(decoyPct).padStart(3)}%  empty ${String(emptyPct).padStart(3)}%  traps ${trapChecks}`);
    }
  }
  console.log('');
}

const withVariants = CHAIRS.filter(c => Array.isArray(c.variants) && c.variants.length).length;
console.log(`  anti-fitting: ${withVariants}/${CHAIRS.length} chairs carry an independently-worded correct answer`);
const totalChecks = CHAIRS.reduce((n, c) => n + c.score('').length, 0);
const totalTraps = CHAIRS.reduce((n, c) => n + c.score('').filter(x => /^TRAP/.test(x.label)).length, 0);
console.log(`  ${CHAIRS.length} chairs · ${totalChecks} checks · ${totalTraps} of them traps`);
console.log(failures ? `\n  ✖ ${failures} chair(s) failed selftest\n` : '\n  ✓ all chairs sound\n');
process.exit(failures ? 1 : 0);
