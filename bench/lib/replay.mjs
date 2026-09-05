import { CHAIRS } from '../positions/index.mjs';
import { placement } from './placement.mjs';
import { unverifiableTranscript } from './suite.mjs';

// Public summaries are derived from transcripts, not supplied percentages or verdicts.
export function replay(result) {
  const chairs = {};
  for (const [id, row] of Object.entries(result.chairs ?? {})) {
    const chair = CHAIRS.find(c => c.id === id);
    if (!chair) { chairs[id] = row; continue; }
    if ((row.error && !row.scorerError) || row.unanswered) { chairs[id] = row; continue; }
    if (unverifiableTranscript(row)) {
      chairs[id] = { ...row, redacted: true, pct: null, checks: [], scorerError: 'Redacted transcript cannot be independently rescored' };
      continue;
    }
    if (typeof row.raw !== 'string') {
      chairs[id] = { ...row, pct: null, scorerError: 'Missing raw transcript', checks: [] };
      continue;
    }
    try {
      const checks = chair.score(row.raw);
      const passed = checks.filter(c => c.pass).length;
      chairs[id] = { ...row, dept: chair.dept, title: chair.title, checks, passed, total: checks.length,
        pct: Math.round(100 * passed / checks.length) };
      delete chairs[id].scorerError;
      delete chairs[id].error;
    } catch (error) {
      chairs[id] = { ...row, pct: null, checks: [], scorerError: String(error.message) };
    }
  }
  return { ...result, chairs, placement: placement(chairs) };
}
