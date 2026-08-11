/**
 * exec.mjs — the executed grader.
 *
 * The model's code and a set of tests it never sees are concatenated into one file and run in a
 * subprocess with a hard timeout. Nothing judges the code: it either produces the right values or
 * it does not. A crash, a timeout and a plausible-looking wrong number all score the same, which
 * is the point — this is the domain gate that a schema check cannot be.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HARNESS } from './tasks.mjs';

/** Python is `python3` on most systems, `py` on Windows, `python` on some. Find one once. */
let PY = null;
export function python() {
  if (PY) return PY;
  for (const cand of ['python3', 'py', 'python']) {
    try {
      const r = spawnSync(cand, ['-c', 'print(1)'], { encoding: 'utf8', timeout: 10000 });
      if (r.status === 0 && String(r.stdout).trim() === '1') { PY = cand; return PY; }
    } catch { /* next */ }
  }
  return null;
}

function run(cmd, args, cwd, timeoutMs) {
  return new Promise(resolve => {
    let p;
    try { p = spawn(cmd, args, { cwd, windowsHide: true }); }
    catch (e) { return resolve({ out: '', err: String(e), timedOut: false, code: -1 }); }
    let out = '', err = '', done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; try { p.kill('SIGKILL'); } catch {} resolve({ out, err, timedOut: true, code: null }); }
    }, timeoutMs);
    p.stdout.on('data', d => { out += d; if (out.length > 200000) { try { p.kill('SIGKILL'); } catch {} } });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { if (!done) { done = true; clearTimeout(timer); resolve({ out, err: String(e), timedOut: false, code: -1 }); } });
    p.on('close', code => { if (!done) { done = true; clearTimeout(timer); resolve({ out, err, timedOut: false, code }); } });
  });
}

export async function gradeTask(task, code) {
  if (task.lang === 'py' && !python()) {
    return { total: 0, passed: 0, checks: [], fatal: 'no python interpreter found (tried python3, py, python)', skipped: true };
  }
  const dir = join(tmpdir(), `company-bench-${task.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  try {
    const ext = task.lang === 'py' ? 'py' : 'mjs';
    const mark = task.lang === 'py' ? '#' : '//';
    const file = join(dir, `t.${ext}`);
    writeFileSync(file, [HARNESS[task.lang], `${mark}---CODE-START---`, code, `${mark}---CODE-END---`, task.tests].join('\n'), 'utf8');
    const r = task.lang === 'py'
      ? await run(python(), ['-I', file], dir, task.timeoutMs)
      : await run(process.execPath, [file], dir, task.timeoutMs);
    const m = r.out.match(/__RESULT__(\{[\s\S]*\})\s*$/m);
    if (!m) {
      const reason = r.timedOut ? 'timeout' : (r.err.trim().split('\n').pop() || 'produced no result line').slice(0, 200);
      return { total: 0, passed: 0, checks: [], fatal: reason };
    }
    const checks = JSON.parse(m[1]).checks ?? [];
    return { total: checks.length, passed: checks.filter(c => c.ok).length, checks, fatal: null };
  } catch (e) {
    return { total: 0, passed: 0, checks: [], fatal: `grader: ${e.message}`.slice(0, 200) };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows file locks */ }
  }
}
