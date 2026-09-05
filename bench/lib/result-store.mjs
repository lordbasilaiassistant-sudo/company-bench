import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderResume } from './scorecard.mjs';

const ROOT = fileURLToPath(new URL('../../results/', import.meta.url));
export function safeId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id) || id === '.' || id === '..') {
    throw new Error('Result id must be 1–120 letters, digits, dots, underscores or hyphens, starting with a letter or digit.');
  }
  return id;
}

export function writeResult(result, { directory = ROOT } = {}) {
  const id = safeId(result.candidate?.id);
  const run = safeId(result.runId);
  const archive = path.join(directory, 'runs', id);
  fs.mkdirSync(archive, { recursive: true });
  fs.mkdirSync(path.join(directory, 'cards'), { recursive: true });
  const latest = path.join(directory, `${id}.json`);
  // Preserve the exact previous bytes, including pre-manifest historical readings.
  if (fs.existsSync(latest)) {
    const old = fs.readFileSync(latest);
    const digest = createHash('sha256').update(old).digest('hex');
    const oldPath = path.join(archive, `previous-${digest}.json`);
    if (!fs.existsSync(oldPath)) fs.writeFileSync(oldPath, old, { flag: 'wx' });
  }
  const serialized = JSON.stringify(result, null, 2) + '\n';
  fs.writeFileSync(path.join(archive, `${run}.json`), serialized, { flag: 'wx' });
  fs.writeFileSync(latest, serialized);
  fs.writeFileSync(path.join(directory, 'cards', `${id}.md`), renderResume(result));
  return latest;
}
