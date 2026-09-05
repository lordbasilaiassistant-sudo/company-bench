/**
 * exec.mjs — the executed grader.
 *
 * Experimental trusted-local execution only; see SECURITY.md. Candidate code and published tests
 * share an interpreter. Protocol checks catch malformed results, not malicious harness tampering.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HARNESS } from './tasks.mjs';

/** Python is `python3` on most systems, `py` on Windows, `python` on some. Find one once. */
let PY = null;
export function python() {
  if (PY) return PY;
  for (const cand of process.platform === 'win32' ? ['py', 'python3', 'python'] : ['python3', 'python', 'py']) {
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
    // Reduce accidental credential exposure. This does NOT prevent filesystem/network access.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|LANG|LC_ALL)$/i.test(k)));
    try { p = spawn(cmd, args, { cwd, windowsHide: true, env }); }
    catch (e) { return resolve({ out: '', err: String(e), timedOut: false, code: -1 }); }
    let out = '', err = '', done = false, outputExceeded = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; try { p.kill('SIGKILL'); } catch {} resolve({ out, err, timedOut: true, code: null }); }
    }, timeoutMs);
    function append(which, d) {
      const value = d.toString();
      if (which === 'out') out = (out + value).slice(0, 200000);
      else err = (err + value).slice(0, 200000);
      if (out.length + err.length >= 200000) {
        outputExceeded = true;
        try { p.kill('SIGKILL'); } catch {}
      }
    }
    p.stdout.on('data', d => append('out', d));
    p.stderr.on('data', d => append('err', d));
    p.on('error', e => { if (!done) { done = true; clearTimeout(timer); resolve({ out, err: String(e), timedOut: false, code: -1 }); } });
    p.on('close', code => { if (!done) { done = true; clearTimeout(timer); resolve({ out, err, timedOut: false, code, outputExceeded }); } });
  });
}

export const EXECUTION_WARNING = 'Experimental trusted-local coding track: candidate code can access this computer and the tests. A subprocess is not a sandbox; scores are not adversarially trustworthy. Use only reviewed code in a disposable environment without credentials. Explicit opt-in required: --allow-unsafe-execution.';

export async function gradeTask(task, code, { allowUnsafeExecution = false } = {}) {
  if (allowUnsafeExecution !== true) {
    return { total: 0, passed: 0, checks: [], fatal: EXECUTION_WARNING, skipped: true };
  }
  if (!['py', 'js'].includes(task.lang)) throw new Error('unsupported coding language');
  if (!Number.isFinite(task.timeoutMs) || task.timeoutMs <= 0) throw new Error('positive timeoutMs required');
  const expected = [...task.tests.matchAll(/_chk\(\s*["']([^"']+)["']/g)].map(m => m[1]);
  const fail = fatal => ({ total: expected.length, passed: 0, checks: [], fatal });
  if (!expected.length || new Set(expected).size !== expected.length) return fail('invalid test manifest');
  if (task.lang === 'py' && !python()) {
    return { total: 0, passed: 0, checks: [], fatal: 'no python interpreter found (tried python3, py, python)', skipped: true };
  }
  const dir = mkdtempSync(join(tmpdir(), 'company-bench-'));
  try {
    const ext = task.lang === 'py' ? 'py' : 'mjs';
    const mark = task.lang === 'py' ? '#' : '//';
    const file = join(dir, `t.${ext}`);
    writeFileSync(file, [HARNESS[task.lang], `${mark}---CODE-START---`, code, `${mark}---CODE-END---`, task.tests].join('\n'), 'utf8');
    const r = task.lang === 'py'
      ? await run(python(), ['-I', file], dir, task.timeoutMs)
      : await run(process.execPath, [file], dir, task.timeoutMs);
    if (r.timedOut) return fail('timeout');
    if (r.outputExceeded) return fail('output limit exceeded');
    if (r.code !== 0) return fail(`process exited unsuccessfully (${r.code}): ${r.err.trim().split('\n').pop() || ''}`.slice(0, 200));
    const lines = r.out.trim().split(/\r?\n/);
    const results = lines.filter(line => line.startsWith('__RESULT__'));
    if (results.length !== 1 || results[0] !== lines.at(-1)) return fail('missing, duplicate, or non-final result line');
    const checks = JSON.parse(results[0].slice('__RESULT__'.length)).checks;
    if (!Array.isArray(checks) || checks.length !== expected.length ||
        checks.some((c, i) => !c || c.name !== expected[i] || typeof c.ok !== 'boolean' ||
          (c.err !== undefined && typeof c.err !== 'string'))) return fail('result does not match trusted check manifest');
    return { total: checks.length, passed: checks.filter(c => c.ok).length, checks, fatal: null };
  } catch (e) {
    return fail(`grader: ${e.message}`.slice(0, 200));
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows file locks */ }
  }
}
