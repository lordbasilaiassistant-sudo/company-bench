import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { CHAIRS } from '../positions/index.mjs';

export const BENCH_VERSION = 4;
const hash = value => createHash('sha256').update(value).digest('hex');
export const PROMPT_HASH = hash(JSON.stringify(CHAIRS.map(c => [c.id, c.prompt])));
// Hash whole modules: closures use helpers outside score.toString(). Normalize checkout
// line endings so Windows and Linux identify the same committed instrument.
const scoringFiles = [
  ...readdirSync(new URL('../positions/', import.meta.url)).filter(f => f.endsWith('.mjs')).map(f => `../positions/${f}`),
  './parse.mjs', './placement.mjs', './scorecard.mjs', './replay.mjs', './suite.mjs',
].sort();
export const SCORER_HASH = hash(JSON.stringify(scoringFiles.map(f => [f,
  readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n')])));

export function provenance({ chairs, settings = {}, collection = 'api', system = null } = {}) {
  return { promptHash: PROMPT_HASH, scorerHash: SCORER_HASH,
    selectedChairs: (chairs ?? CHAIRS).map(c => c.id),
    collectedAt: new Date().toISOString(), collection,
    systemHash: system ? hash(system) : null, settings };
}

export function unverifiableTranscript(row) {
  return row.redacted === true
    || row.scorerError === 'Redacted transcript cannot be independently rescored'
    || (row.redacted === undefined && /\[REDACTED(?:\]|-)/.test(row.raw ?? ''));
}

// No historical run is silently relabelled as a current, comparable measurement.
export function rankingEligibility(result) {
  const p = result.provenance;
  const reasons = [];
  if (result.reference || result.excluded) reasons.push('reference or excluded');
  if (!result.placement?.coverage?.fullSuite) reasons.push('not all current chairs measured');
  if (!p || p.promptHash !== PROMPT_HASH) reasons.push('missing or different prompt version');
  if (!p || p.scorerHash !== SCORER_HASH) reasons.push('missing or different scorer version');
  if (result.mode !== 'api' || p?.collection !== 'api') reasons.push('not an API baseline');
  if (p?.systemHash || result.systemPrompt) reasons.push('custom system prompt');
  if (p?.settings?.temperature !== 0) reasons.push('non-baseline or unknown temperature');
  if (result.mergedFrom) reasons.push('assembled from multiple runs');
  if (Object.values(result.chairs ?? {}).some(unverifiableTranscript)) reasons.push('redacted transcript cannot be independently rescored');
  return { eligible: reasons.length === 0, reasons };
}
