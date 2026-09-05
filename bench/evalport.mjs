#!/usr/bin/env node
// Export a company-bench result as an EvalPort ResultSet.
//
// Proposed in issue #1. The mapping is a near 1:1 rename — each chair becomes one
// `results[]` entry carrying a single `code` grader result, because that is exactly
// what a chair is: raw model output scored by a plain JS `score(out)` function with
// no deps and no LLM judge.
//
//   node bench/evalport.mjs <id> [...]     -> writes results/<id>.evalport.json
//   node bench/evalport.mjs --all          -> every result in results/
//   node bench/evalport.mjs <id> --stdout  -> print instead of writing
//
// Two things this deliberately does NOT do:
//
//   * It does not invent a score for a chair that errored. A transport failure
//     (a 402, a timeout) is not a zero — the model never answered. Those chairs
//     are emitted with `score: null` and `status: "error"`, and the ResultSet
//     metadata carries `incomplete: true`, so a downstream consumer cannot
//     average a billing error into a capability number.
//   * It does not renormalise. `pct` is 0..100 here and `score` is 0..1 there;
//     that is the whole conversion.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { placement as assess } from './lib/placement.mjs';
import { safeId } from './lib/result-store.mjs';

const RESULTS_DIR = 'results';
const SUITE_ID = 'company-bench';
const SPEC_VERSION = '1.0.0';

/** company-bench result -> EvalPort ResultSet. Pure; exported for tests. */
export function toResultSet(r) {
  const chairs = r.chairs ?? {};
  const placement = assess(chairs);

  const results = Object.entries(chairs).map(([id, c]) => {
    const errored = Boolean(c.error || c.scorerError || c.unanswered || !Number.isFinite(c.pct));
    const checks = c.checks ?? [];

    return {
      test_case_id: id,
      status: errored ? 'error' : 'completed',
      output: c.raw ?? '',
      ...(errored ? { error: { message: c.error || c.scorerError || 'No reading' } } : {}),
      duration_ms: c.ms ?? null,
      grader_results: [
        {
          grader_id: `${id}.score`,
          grader_type: 'code',
          // null, not 0 — an unanswered chair has no score. See header.
          score: errored ? null : c.pct / 100,
          passed: errored ? null : c.pct === 100,
          metadata: {
            checks,
            passed_count: c.passed ?? checks.filter((k) => k.pass).length,
            total: c.total ?? checks.length,
          },
        },
      ],
      metadata: { title: c.title, dept: c.dept },
    };
  });

  return {
    version: SPEC_VERSION,
    suite_id: `${SUITE_ID}-v${r.benchVersion ?? 1}`,
    run_id: r.runId ?? r.candidate?.id,
    started_at: r.when,
    provider: {
      name: r.candidate?.vendor,
      model: r.candidate?.model,
    },
    results,
    metadata: {
      candidate_name: r.candidate?.name,
      cost: r.candidate?.cost,
      mode: r.mode,
      tokens_per_second: r.tokensPerSecond ?? null,
      trust_level: placement.level,
      trust_level_name: placement.levelName,
      trust_level_rule: placement.levelRule,
      flags: placement.flags ?? [],
      overall: placement.overall,
      // Surfaced, not smoothed: a run with errored chairs is not comparable to
      // a complete one, and the consumer needs to be able to see that.
      incomplete: Boolean(placement.incomplete),
      errored_chairs: placement.errored ?? [],
      missing_chairs: placement.missing ?? [],
      coverage: placement.coverage,
      provenance: r.provenance ?? null,
      hire: placement.hire ?? [],
      probation: placement.probation ?? [],
      reject: placement.reject ?? [],
    },
  };
}

function idsFromArgs(args) {
  if (args.includes('--all')) {
    return fs
      .readdirSync(RESULTS_DIR)
      .filter((f) => f.endsWith('.json') && !f.startsWith('_') && !f.endsWith('.evalport.json'))
      .map((f) => f.replace(/\.json$/, ''));
  }
  return args.filter((a) => !a.startsWith('--'));
}

function main() {
  const args = process.argv.slice(2);
  const ids = idsFromArgs(args);
  const toStdout = args.includes('--stdout');

  if (!ids.length) {
    console.error('usage: node bench/evalport.mjs <id> [...] | --all   [--stdout]');
    process.exit(2);
  }

  for (const id of ids) {
    safeId(id);
    const src = path.join(RESULTS_DIR, `${id}.json`);
    if (!fs.existsSync(src)) {
      console.error(`[evalport] no such result: ${src}`);
      process.exitCode = 1;
      continue;
    }
    const set = toResultSet(JSON.parse(fs.readFileSync(src, 'utf8')));

    if (toStdout) {
      console.log(JSON.stringify(set, null, 2));
      continue;
    }
    const out = path.join(RESULTS_DIR, `${id}.evalport.json`);
    fs.writeFileSync(out, JSON.stringify(set, null, 2) + '\n');
    const scored = set.results.filter((x) => x.grader_results[0].score !== null).length;
    console.log(`[evalport] ${out}  (${scored}/${set.results.length} chairs scored)`);
  }
}

// pathToFileURL, not string-building: a Windows argv[1] is C:\... and hand-rolling
// the file:// prefix drops a slash, so the guard silently never fires. The argv[1]
// guard matters too — importing this as a module (which is the whole point of the
// exported toResultSet) can leave argv[1] undefined, and pathToFileURL throws on it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
