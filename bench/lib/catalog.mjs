import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { replay } from './replay.mjs';
import { rankingEligibility } from './suite.mjs';

export function resultCatalog(directory) {
  const files=[];
  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name);
      if (entry.isDirectory() && entry.name !== 'cards') visit(file);
      else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.evalport.json')) files.push(file);
    }
  }
  visit(directory);
  // Prefer permanent run files to mutable convenience aliases.
  files.sort((a,b)=>Number(b.includes(`${path.sep}runs${path.sep}`))-Number(a.includes(`${path.sep}runs${path.sep}`)) || a.localeCompare(b));
  const records=[];
  for(const file of files) {
    let r;
    try { r=JSON.parse(fs.readFileSync(file,'utf8')); } catch { continue; }
    if(!r.chairs || !r.candidate) continue;
    const identity=r.runId ?? createHash('sha256').update(JSON.stringify([r.candidate,r.when,r.mode,r.chairs])).digest('hex');
    records.push({file,r,identity});
  }
  // A correction on any alias revokes the same archived run too. Immutable bytes must
  // remain available as evidence, but must never bypass a later exclusion decision.
  const revoked=new Set(records.filter(({r})=>r.reference || r.excluded).map(({identity})=>identity));
  const seen=new Set(), all=[];
  for(const {file,r,identity} of records) {
    if(revoked.has(identity)) continue;
    if(seen.has(identity)) continue;
    seen.add(identity);
    all.push({...replay(r), storagePath:path.relative(directory,file).split(path.sep).join('/')});
  }
  all.sort((a,b)=>(b.rescoredAt ?? b.when ?? '').localeCompare(a.rescoredAt ?? a.when ?? ''));
  const selected=new Set();
  const baseline=all.filter(r=>{
    if(!rankingEligibility(r).eligible || selected.has(r.candidate.id)) return false;
    selected.add(r.candidate.id); return true;
  });
  return {baseline, archive:all.filter(r=>!baseline.includes(r))};
}
