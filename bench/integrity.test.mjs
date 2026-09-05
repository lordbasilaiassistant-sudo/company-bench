import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHAIRS, DEPARTMENTS } from './positions/index.mjs';
import { placement } from './lib/placement.mjs';
import { buildResult, renderResume } from './lib/scorecard.mjs';
import { provenance, rankingEligibility } from './lib/suite.mjs';
import { replay } from './lib/replay.mjs';
import { writeResult } from './lib/result-store.mjs';
import { resultCatalog } from './lib/catalog.mjs';
import { toResultSet } from './evalport.mjs';

const gold = () => Object.fromEntries(CHAIRS.map(c => {
  const checks = c.score(c.gold);
  return [c.id, { title:c.title, dept:c.dept, raw:c.gold, checks, pct:100, passed:checks.length, total:checks.length }];
}));
const result = () => buildResult({ candidate:{id:'fixture',name:'SYNTHETIC TEST FIXTURE'}, mode:'api', chairs:gold(),
  provenance:provenance({settings:{temperature:0}}) });

test('five perfect chairs cannot grant an interview level', () => {
  const all = gold();
  const p = placement(Object.fromEntries(['ledger','qa-gate','sentry','expander','community'].map(id=>[id,all[id]])));
  assert.equal(p.level,null);
  assert.equal(p.incomplete,true);
  assert.equal(p.missing.length,31);
});
test('every core chair is required, optional departments have explicit coverage', () => {
  const all = gold();
  assert.equal(placement(all).level,'L3');
  for (const c of CHAIRS.filter(c=>!DEPARTMENTS.find(d=>d.id===c.dept).optional)) {
    const partial = {...all}; delete partial[c.id];
    assert.equal(placement(partial).level,null,c.id);
  }
  const core = Object.fromEntries(Object.entries(all).filter(([,r])=>!['crypto','treasury'].includes(r.dept)));
  assert.equal(placement(core).level,'L3');
  assert.equal(placement(core).coverage.fullSuite,false);
  assert.equal(placement(core).custody,null);
});
test('scorer failure, provider failure, invalid score and unknown IDs are no reading', () => {
  for (const change of [{scorerError:'parser failed'},{error:'429'},{pct:NaN},{pct:101},{unanswered:true}]) {
    const all = gold(); Object.assign(all.ledger,change);
    const r = buildResult({candidate:{id:'test',name:'Fixture'},chairs:all,mode:'api'});
    assert.equal(r.placement.level,null);
    assert.equal(r.placement.dept.operations,100);
    assert.ok(!r.placement.reject.includes('ledger'));
    assert.match(renderResume(r),/UNASSESSED/);
    assert.match(renderResume(r),/No reading/);
  }
  assert.equal(placement({...gold(),fake:{pct:100,dept:'integrity'}}).level,null);
});
test('a failed hard gate is never simultaneously recommended for hire', () => {
  const all=gold(); all['qa-gate'].pct=88; all.custody.pct=86;
  const p=placement(all);
  assert.ok(!p.hire.includes('qa-gate'));
  assert.ok(!p.hire.includes('custody'));
  assert.ok(p.reject.includes('qa-gate'));
});
test('baseline requires full current-version API coverage and fixed acquisition settings', () => {
  const r=result(); assert.equal(rankingEligibility(r).eligible,true);
  const variants = [
    {...r,provenance:null}, {...r,mode:'self-administered'}, {...r,mergedFrom:['old']},
    {...r,provenance:{...r.provenance,promptHash:'old'}},
    {...r,provenance:{...r.provenance,scorerHash:'old'}},
    {...r,provenance:{...r.provenance,systemHash:'custom'}},
    {...r,provenance:{...r.provenance,settings:{temperature:0.7}}},
  ];
  for(const v of variants) assert.equal(rankingEligibility(v).eligible,false);
  const partial=result(); delete partial.chairs.vault;
  assert.equal(rankingEligibility(replay(partial)).eligible,false);
});
test('publication replays transcripts instead of trusting supplied percentages', () => {
  const r=result(); r.chairs.ledger.raw='';
  const checked=replay(r);
  assert.equal(checked.chairs.ledger.pct,0);
  assert.notEqual(checked.placement.overall,100);
  assert.equal(r.chairs.ledger.pct,100);
});
test('redacting leaked fixture values cannot turn failures into passes on replay', () => {
  const r=result();
  const vault=CHAIRS.find(c=>c.id==='vault');
  r.chairs.vault.raw=vault.decoy;
  const stored=buildResult({candidate:r.candidate,mode:r.mode,chairs:r.chairs,provenance:r.provenance});
  assert.equal(stored.chairs.vault.redacted,true);
  const checked=replay(stored);
  assert.equal(checked.chairs.vault.pct,null);
  assert.equal(checked.placement.level,null);
  assert.equal(rankingEligibility(checked).eligible,false);
  const legacy=structuredClone(stored); delete legacy.chairs.vault.redacted;
  const replayed=replay(legacy);
  const savedAgain=buildResult({candidate:legacy.candidate,mode:legacy.mode,chairs:replayed.chairs,provenance:legacy.provenance});
  assert.equal(replay(savedAgain).chairs.vault.pct,null,'redaction uncertainty survives repeated persistence and replay');
  const safe=result(); safe.chairs.vault.raw += '\nSanitized example: [REDACTED]';
  const intact=buildResult({candidate:safe.candidate,mode:safe.mode,chairs:safe.chairs,provenance:safe.provenance});
  assert.equal(intact.chairs.vault.redacted,false);
  assert.equal(replay(intact).chairs.vault.pct,100);
});
test('a repaired scorer recovers its transcript, and empty error cards do not claim success', () => {
  const r=result(); r.chairs.ledger.scorerError='old scorer threw';
  const stored=buildResult({candidate:r.candidate,mode:r.mode,chairs:r.chairs});
  assert.equal(stored.chairs.ledger.pct,null);
  assert.equal(replay(stored).chairs.ledger.pct,100);
  const error=buildResult({candidate:r.candidate,mode:'api',chairs:{ledger:{dept:'operations',error:'timeout',pct:0,checks:[]}}});
  const card=renderResume(error);
  assert.doesNotMatch(card,/clean sweep|walked past every/);
  assert.match(card,/No trap checks measured/);
  const exported=toResultSet(error);
  assert.equal(exported.results[0].grader_results[0].score,null);
  assert.equal(exported.metadata.trust_level,null);
});
test('new results preserve previous bytes and cannot overwrite immutable runs or escape directory', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'company-bench-store-'));
  try {
    const a=result(); const file=writeResult(a,{directory}); const original=fs.readFileSync(file,'utf8');
    const b=result(); writeResult(b,{directory});
    const files=fs.readdirSync(path.join(directory,'runs','fixture'));
    assert.ok(files.some(f=>fs.readFileSync(path.join(directory,'runs','fixture',f),'utf8')===original));
    assert.throws(()=>writeResult(b,{directory}),/EEXIST/);
    assert.throws(()=>writeResult({...b,candidate:{id:'../escape'}},{directory}),/Result id/);
    const partial=result(); delete partial.chairs.ledger;
    writeResult(partial,{directory});
    const catalog=resultCatalog(directory);
    assert.equal(catalog.baseline.length,1);
    assert.equal(catalog.baseline[0].placement.coverage.fullSuite,true);
    assert.match(catalog.baseline[0].storagePath,/^runs\//);
    assert.ok(catalog.archive.some(r=>r.runId===partial.runId));
    // A maintainer's exclusion must revoke the same immutable run, not merely its alias.
    fs.writeFileSync(path.join(directory,'revocation.json'),JSON.stringify({...b,excluded:true}));
    assert.ok(!resultCatalog(directory).baseline.some(r=>r.runId===b.runId));
    assert.ok(!resultCatalog(directory).archive.some(r=>r.runId===b.runId));
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
