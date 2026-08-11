/**
 * The company org chart: every department, every chair.
 *
 * Adding a chair? See CONTRIBUTING.md. The short version: it needs a deterministic scorer,
 * a `gold` answer that scores 100%, a `decoy` answer that does not, and at least one TRAP —
 * a wrong answer that a fluent model actually reaches for. `node bench/selftest.mjs` enforces
 * the first three. Human review enforces the fourth.
 */
import { OPERATIONS } from './operations.mjs';
import { INTEGRITY } from './integrity.mjs';
import { SECURITY } from './security.mjs';
import { AUTONOMY } from './autonomy.mjs';
import { PEOPLE } from './people.mjs';
import { MANAGEMENT } from './management.mjs';
import { TREASURY } from './treasury.mjs';

export const DEPARTMENTS = [
  {
    id: 'operations', label: 'Operations', optional: false,
    question: 'Can it do the work correctly when the inputs are dirty?',
    chairs: OPERATIONS,
  },
  {
    id: 'integrity', label: 'Integrity', optional: false,
    question: 'Can its output be believed — and can it catch a lie in someone else\'s?',
    chairs: INTEGRITY,
  },
  {
    id: 'security', label: 'Security', optional: false,
    question: 'Can it be pointed at input written by strangers?',
    chairs: SECURITY,
  },
  {
    id: 'autonomy', label: 'Autonomy', optional: false,
    question: 'What happens when nobody is watching and the rules get inconvenient?',
    chairs: AUTONOMY,
  },
  {
    id: 'people', label: 'People', optional: false,
    question: 'Can it face a human, or another agent, without a supervisor?',
    chairs: PEOPLE,
  },
  {
    id: 'management', label: 'Management', optional: false,
    question: 'Can it run a workforce — or does it quietly do the work itself?',
    chairs: MANAGEMENT,
  },
  {
    id: 'treasury', label: 'Treasury', optional: true,
    question: 'Can it be trusted near money it can actually move?',
    chairs: TREASURY,
  },
];

/** Flat list of every chair, each tagged with its department. */
export const CHAIRS = DEPARTMENTS.flatMap(d =>
  d.chairs.map(c => ({ ...c, dept: d.id, deptLabel: d.label })));

export function chairsFor({ skip = [], only = [] } = {}) {
  let list = CHAIRS;
  if (only.length) list = list.filter(c => only.includes(c.id) || only.includes(c.dept));
  if (skip.length) list = list.filter(c => !skip.includes(c.id) && !skip.includes(c.dept));
  return list;
}

export const CHAIR_COUNT = CHAIRS.length;
export const CHECK_COUNT = CHAIRS.reduce((n, c) => n + c.score('').length, 0);
