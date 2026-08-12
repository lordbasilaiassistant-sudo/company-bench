/**
 * scorecard.mjs — one renderer for every path into the bench.
 *
 * Whether the answers came from an API key or from an agent that took the test by hand, the
 * scorecard is identical. That is deliberate: a self-administered result and a key-driven result
 * are directly comparable, or the self-administered path would be a participation trophy.
 */
import { DEPARTMENTS } from '../positions/index.mjs';
import { redactSecrets } from './parse.mjs';
import { placement, verdictOf, gradeOf } from './placement.mjs';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', grey: '\x1b[90m',
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (col, s) => (useColor ? C[col] + s + C.reset : s);

const tone = pct => (pct >= 85 ? 'green' : pct >= 60 ? 'yellow' : 'red');
const bar = pct => {
  const filled = Math.round(pct / 5);
  return c(tone(pct), '█'.repeat(filled)) + c('grey', '·'.repeat(20 - filled));
};

/** Output tokens per second across every chair that reported both, or null. */
export function throughput(chairs) {
  // Prefer the model's MEASURED generation rate where the backend reports it (Ollama does). The
  // end-to-end fallback bundles model load and prompt processing into the number, which once had
  // this bench disqualifying a local model at '21 tok/s' that actually generates at 66.
  const measured = Object.values(chairs).map(r => r.genRate).filter(v => typeof v === 'number' && v > 0);
  if (measured.length >= 3) {
    return Math.round((measured.reduce((a, b) => a + b, 0) / measured.length) * 10) / 10;
  }
  const rows = Object.values(chairs).filter(r => r.tokens > 0 && r.ms > 0);
  if (rows.length < 3) return null;
  const tokens = rows.reduce((n, r) => n + r.tokens, 0);
  const ms = rows.reduce((n, r) => n + r.ms, 0);
  return Math.round((tokens / (ms / 1000)) * 10) / 10;
}

export function buildResult({ candidate, chairs, mode }) {
  // Scoring already ran against the untouched text; from here on the transcript is written to
  // disk, so anything credential-shaped is redacted before it can be committed or published.
  for (const r of Object.values(chairs)) {
    if (typeof r.raw === 'string') r.raw = redactSecrets(r.raw);
  }
  const forPlacement = Object.fromEntries(Object.entries(chairs).map(([id, r]) => [id, { pct: r.pct, dept: r.dept, error: r.error }]));
  const deptsRun = [...new Set(Object.values(chairs).map(r => r.dept))];
  return {
    candidate, mode, when: new Date().toISOString(),
    // v3 adds the One Team department (5 chairs). The aggregate now includes a flow no earlier run
    // was ever asked about, so a v2 overall and a v3 overall are not the same measurement and must
    // not be put on one line. Per-chair scores are still comparable across both.
    benchVersion: 3,
    tokensPerSecond: throughput(chairs),
    chairs,
    placement: placement(forPlacement, { deptsRun }),
  };
}

/** Every planted trap this candidate was actually shown, and how many it walked into. */
export function trapTally(chairs) {
  const all = Object.values(chairs).flatMap(r => (r.checks ?? []).filter(ch => /^TRAP/.test(ch.label)));
  return { took: all.filter(ch => !ch.pass).length, total: all.length };
}

/**
 * The one sentence that keeps this benchmark honest about its own headline number.
 * An averaged percentage is a real quantity and a bad summary: it turns a handful of
 * catastrophic single failures into a passing grade, and those failures are exactly what
 * decide whether an agent can be left in a seat.
 */
export const WHY_TRAPS_LEAD =
  'An averaged score hides catastrophic single failures, and the failures are what decide whether an agent can hold a seat.';

export function printScorecard(result) {
  const { candidate, chairs, placement: p } = result;
  const line = ch => '─'.repeat(ch);
  const t = trapTally(chairs);
  const trapTone = t.took === 0 ? 'green' : t.took / Math.max(1, t.total) >= 0.1 ? 'red' : 'yellow';

  console.log('');
  console.log(c('bold', `  ${candidate.name}${candidate.vendor ? c('grey', `  ·  ${candidate.vendor}`) : ''}`));
  console.log(c('grey', `  ${candidate.model ?? candidate.id}  ·  ${result.mode}  ·  ${result.when.slice(0, 10)}`));
  console.log('');

  // ── the headline: traps and flags, before any percentage ──
  console.log(`  ${c('bold', 'TRAPS TAKEN')}   ${c(trapTone, `${t.took} of ${t.total}`)}` +
    `   ${p.flags.length ? c('red', `⛔ ${p.flags.length} disqualifying flag${p.flags.length > 1 ? 's' : ''}`) : c('green', '✓ no disqualifying flags')}`);
  console.log(c('grey', `                the count that predicts production failure`));
  console.log(c('grey', `  overall       ${p.overall}%  (weighted average — useful only for comparing similar models)`));
  console.log(c('grey', `                ${WHY_TRAPS_LEAD}`));
  console.log('');

  for (const d of DEPARTMENTS) {
    const rows = Object.entries(chairs).filter(([, r]) => r.dept === d.id);
    if (!rows.length) continue;
    const deptPct = p.dept[d.id] ?? 0;
    console.log(`  ${c('bold', d.label.toUpperCase().padEnd(12))} ${bar(deptPct)} ${c(tone(deptPct), String(deptPct).padStart(3) + '%')}`);
    for (const [id, r] of rows) {
      const failed = (r.checks ?? []).filter(ch => !ch.pass);
      const traps = failed.filter(ch => /^TRAP/.test(ch.label)).length;
      const note = r.error ? c('red', `  error: ${r.error.slice(0, 60)}`)
        : traps ? c('red', `  ${traps} trap${traps > 1 ? 's' : ''} taken`)
        : failed.length ? c('grey', `  ${failed.length} check${failed.length > 1 ? 's' : ''} missed`)
        : c('green', '  clean');
      console.log(`    ${c('grey', id.padEnd(16))} ${String(r.pct).padStart(3)}%  ${c('grey', (r.passed + '/' + r.total).padEnd(6))}${note}`);
    }
    console.log('');
  }

  console.log(c('grey', `  ${line(64)}`));
  if (p.incomplete) {
    console.log(`  ${c('yellow', 'INCOMPLETE RUN')} — ${p.errored.length} chair(s) errored: ${p.errored.join(', ')}`);
    console.log(c('grey', '  A provider error is not a candidate failure. Those chairs have no reading,'));
    console.log(c('grey', '  no trust level is asserted, and this result must not be published as a score.'));
    console.log('');
  }
  console.log(`  ${c('bold', 'TRUST LEVEL')}   ${c('cyan', p.level + ' — ' + p.levelName)}`);
  console.log(c('grey', `                ${p.levelRule}`));
  console.log('');
  for (const f of p.flags) {
    console.log(`  ${c('red', '⛔ ' + f.label)}  ${c('grey', f.why)}`);
  }
  if (!p.flags.length) console.log(`  ${c('green', '✓ no disqualifying flags')}`);
  console.log('');
  console.log(`  ${c('grey', 'hire for   ')} ${p.hire.join(', ') || c('grey', '—')}`);
  console.log(`  ${c('grey', 'probation  ')} ${p.probation.join(', ') || c('grey', '—')}`);
  console.log(`  ${c('grey', 'do not use ')} ${p.reject.join(', ') || c('grey', '—')}`);
  console.log('');
}

/** The hiring résumé — committed alongside the raw result so a placement can always be explained. */
export function renderResume(result) {
  const { candidate, chairs, placement: p } = result;
  const lat = Object.values(chairs).map(r => r.ms).filter(Boolean).sort((a, b) => a - b);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : null;
  const trapsTaken = Object.values(chairs).flatMap(r => (r.checks ?? []).filter(ch => !ch.pass && /^TRAP/.test(ch.label)).map(ch => ch.label));
  const t = trapTally(chairs);

  const rows = [];
  for (const d of DEPARTMENTS) {
    for (const [id, r] of Object.entries(chairs)) {
      if (r.dept !== d.id) continue;
      rows.push(`| ${d.label} | ${r.title} | \`${id}\` | ${r.pct}% | ${gradeOf(r.pct)} | ${verdictOf(r.pct)} |`);
    }
  }

  const failures = [];
  for (const [id, r] of Object.entries(chairs)) {
    for (const ch of r.checks ?? []) if (!ch.pass) failures.push(`- \`${id}\` — ${ch.label}`);
  }

  return `# ${candidate.name} — placement card

> Company Bench v${result.benchVersion} · ${result.mode} · ${result.when.slice(0, 10)}
> ${candidate.vendor ? `${candidate.vendor} · ` : ''}\`${candidate.model ?? candidate.id}\`${candidate.cost ? ` · ${candidate.cost}` : ''}${median ? ` · median latency ${median}ms` : ''}

${p.incomplete ? `> ⚠️ **INCOMPLETE RUN** — ${p.errored.length} chair(s) errored (\`${p.errored.join('`, `')}\`). A provider
error is not a candidate failure: those chairs have no reading, no trust level is asserted,
and this card must not be cited as a score.
` : ''}
## ${t.took} of ${t.total} planted traps taken · ${p.flags.length ? `${p.flags.length} disqualifying flag${p.flags.length > 1 ? 's' : ''}` : 'no disqualifying flags'}

Read those two numbers first. ${WHY_TRAPS_LEAD}

${p.flags.length ? p.flags.map(f => `**⛔ ${f.label}** — ${f.why}`).join('\n\n') : '**No disqualifying flags.**'}

## Trust level: ${p.level} — ${p.levelName}

${p.levelRule}

## Departments

<sub>Overall ${p.overall}% — a weighted average, kept because it is real and useful for comparing similar
models. It is not the headline: the trap count above is.</sub>

${DEPARTMENTS.filter(d => p.dept[d.id] !== undefined).map(d => `- **${d.label}** — ${p.dept[d.id]}%  ·  _${d.question}_`).join('\n')}

## Every chair

| Department | Chair | id | Score | Grade | Verdict |
|---|---|---|---|---|---|
${rows.join('\n')}

## Traps taken — ${t.took} of ${t.total}, named

${trapsTaken.length ? trapsTaken.map(t => `- ${t.replace(/^TRAP /, '')}`).join('\n') : '- none — it walked past every planted wrong answer'}

## Every missed check, verbatim

${failures.length ? failures.join('\n') : '- none — clean sweep'}

---
*Reproduce: \`node bench/run.mjs --models ${candidate.id}\` · raw transcript in \`results/${candidate.id}.json\`*
`;
}

export { verdictOf, gradeOf };
