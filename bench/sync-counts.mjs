#!/usr/bin/env node
/**
 * bench/sync-counts.mjs — make every "N chairs, M checks, T traps" claim in the docs true.
 *
 *   node bench/sync-counts.mjs          # show what is stale
 *   node bench/sync-counts.mjs --write  # fix it
 *
 * WHY THIS EXISTS
 *
 * The counts were hand-written in seven places. They went stale the first time a department was
 * added and stayed stale through three more: README said 35 chairs, llms.txt said 29, the site's
 * FAQ answer and its JSON-LD description both said 29 across 7 departments, and the real number
 * was 45 across 9. Those strings are what an LLM reads when it is asked what this project is, and
 * the JSON-LD is what a search engine indexes, so a stale number there is not cosmetic — it is the
 * project describing itself incorrectly to every automated reader it has.
 *
 * The counts are derivable, so nobody should be typing them. This is the fix that holds: it reads
 * the org chart and rewrites the claims. Run it in CI next to selftest and the docs cannot drift
 * again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { DEPARTMENTS, CHAIRS } from './positions/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const WRITE = process.argv.includes('--write');

const chairs = CHAIRS.length;
const depts = DEPARTMENTS.length;
const coreChairs = DEPARTMENTS.filter(d => !d.optional).reduce((n, d) => n + d.chairs.length, 0);
let checks = 0, traps = 0;
for (const c of CHAIRS) {
  const list = c.score('');
  checks += list.length;
  traps += list.filter(x => /^TRAP\b/.test(x.label)).length;
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve'];
const word = n => WORDS[n] ?? String(n);

/*
 * Every rule is anchored to a phrase that can ONLY be the project describing its current size.
 *
 * The first version of this file was not, and a dry run caught it about to rewrite history. A
 * blanket /\d+ chairs/ hit "a frontier model sat all 29 chairs cold" in the corrections log and
 * "25 s median per chair across 32 chairs" in a measurement record — both true statements about
 * past runs that become lies when updated. A blanket /N departments/ hit README's "a model
 * excellent at five departments and hopeless at one", where "five" is prose, not a count.
 *
 * So: narrow patterns, and historical documents are not in the file list at all. A corrections log
 * that gets silently corrected is worse than no corrections log.
 */
const RULES = [
  [/\b(All|any of the) \d+ core chairs\b/g, `$1 ${coreChairs} core chairs`],
  [/\b(requires?|require) all \d+(\s+)chairs\b/g, `$1 all ${chairs}$2chairs`],
  [/\b\d+-chair (?:diagnostic |diagnostic benchmark|benchmark)/g,
    m => m.replace(/^\d+/, String(chairs))],
  [/\(\d+ tasks\)/g, `(${chairs} tasks)`],
  [/\banswer all \d+ tasks\b/g, `answer all ${chairs} tasks`],
  [/# all \d+ chairs\b/g, `# all ${chairs} chairs`],
  [/^(?:Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+) departments\. `node bench\/run\.mjs --list`/gm,
    `${word(depts)[0].toUpperCase() + word(depts).slice(1)} departments. \`node bench/run.mjs --list\``],
  [/\b\d+ chairs across (?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+) departments\b/g,
    `${chairs} chairs across ${word(depts)} departments`],
  [/\bseats a model in \d+ chairs across \d+ departments\b/g,
    `seats a model in ${chairs} chairs across ${depts} departments`],
  [/\bThe org chart: (?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+) departments, \d+ chairs\b/g,
    `The org chart: ${word(depts)} departments, ${chairs} chairs`],
  [/\bthis version is the hardened one: \d+ chairs\b/gi, `This version is the hardened one: ${chairs} chairs`],
  [/\b\d+ deterministic checks, \d+ (?:of them traps|planted traps|of which are planted traps)\b/g,
    (m) => m.replace(/\d+ deterministic checks/, `${checks} deterministic checks`)
            .replace(/\d+ (of them traps|planted traps|of which are planted traps)/, `${traps} $1`)],
  [/\b\d+ of its \d+ checks are traps\b/g, `${traps} of its ${checks} checks are traps`],
  [/\b\d+ chairs · \d+ checks · \d+ of them traps\b/g, `${chairs} chairs · ${checks} checks · ${traps} of them traps`],
  [/\b\d+ deterministic checks, \d+ of them traps\b/g, `${checks} deterministic checks, ${traps} of them traps`],
  [/^\d+ deterministic checks, \d+ of them traps\.$/gm, `${checks} deterministic checks, ${traps} of them traps.`],
  [/\bbehaviour on \d+ constructed situations\b/g, `behaviour on ${chairs} constructed situations`],
];

/*
 * Only files that state the project's CURRENT identity. Deliberately excluded:
 *   docs/CORRECTIONS.md      a log of past errors; its numbers are the historical record
 *   docs/LOCAL-CANDIDATES.md describes specific past runs at the size they ran at
 *   docs/llms.txt            a copy made by report.mjs; editing it would be undone next build
 */
const FILES = ['README.md', 'llms.txt', 'CONTRIBUTING.md', 'bench/site.mjs',
  'package.json', 'PROMPT.md', 'skills/company-bench/SKILL.md'];

function synchronize(source, rel) {
  let output = source;
  for (const [re, to] of RULES) output = output.replace(re, to);
  if (rel === 'README.md') {
    const table = '| Department | The question it answers | Chairs |\n|---|---|---|\n' +
      DEPARTMENTS.map(d => `| **${d.label}**${d.optional ? ' _(optional)_' : ''} | ${d.question} | ${d.chairs.map(c => `\`${c.id}\``).join(' ')} |`).join('\n');
    output = output.replace(/\| Department \| The question it answers \| Chairs \|\r?\n\|---\|---\|---\|\r?\n(?:\|[^\n]*\|(?:\r?\n|$))+/,
      `${table}\n`);
  }
  return output;
}

if (process.argv.includes('--selftest')) {
  for (const [before, after] of [
    ['A 25-chair benchmark', `A ${chairs}-chair benchmark`],
    ['(35 tasks)', `(${chairs} tasks)`],
    ['answer all 25 tasks', `answer all ${chairs} tasks`],
    ['# all 25 chairs', `# all ${chairs} chairs`],
    ['All 25 core chairs', `All ${coreChairs} core chairs`],
    ['Baseline rankings require all 25\nchairs', `Baseline rankings require all ${chairs}\nchairs`],
    ['Eight departments. `node bench/run.mjs --list`', `${word(depts)[0].toUpperCase() + word(depts).slice(1)} departments. \`node bench/run.mjs --list\``],
    ['a frontier model sat all 29 chairs cold', 'a frontier model sat all 29 chairs cold'],
    ['25 s median per chair across 32 chairs', '25 s median per chair across 32 chairs'],
  ]) assert.equal(synchronize(before, ''), after);
  const tableFixture = '| Department | The question it answers | Chairs |\n|---|---|---|\n| old | old | old |\n';
  const table = synchronize(tableFixture, 'README.md');
  for (const c of CHAIRS) assert.ok(table.includes(`\`${c.id}\``), `org chart missing ${c.id}`);
  assert.equal(synchronize(table, 'README.md'), table, 'sync must be idempotent');
  console.log('  count synchronization regression cases passed');
}

let stale = 0;
for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, 'utf8');
  const after = synchronize(before, rel);
  if (after === before) { console.log(`  ${rel.padEnd(28)} ok`); continue; }

  const changed = [];
  const bl = before.split('\n'), al = after.split('\n');
  for (let i = 0; i < bl.length; i++) if (bl[i] !== al[i]) changed.push(i + 1);
  stale += changed.length;
  console.log(`  ${rel.padEnd(28)} ${changed.length} line(s) stale: ${changed.slice(0, 8).join(', ')}`);
  if (WRITE) fs.writeFileSync(p, after);
}

console.log(`\n  truth: ${chairs} chairs · ${depts} departments · ${checks} checks · ${traps} traps`);
if (!WRITE && stale) { console.log(`\n  ${stale} stale line(s). Run with --write.\n`); process.exit(1); }
console.log(WRITE ? '\n  written\n' : '\n  all counts current\n');
