import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gradeTask, python } from './exec.mjs';
import TASKS from './tasks.mjs';

const optIn = { allowUnsafeExecution: true };
const task = { id: 'integrity-js', lang: 'js', timeoutMs: 1500,
  tests: '_chk("answer", () => answer() === 42);\n_done();' };

test('both coding CLIs fail closed before loading answers or calling a model', () => {
  for (const [file, args] of [
    ['run-coding.mjs', ['--answers', 'nonexistent.json']],
    ['recover.mjs', ['--models', 'invalid']]
  ]) {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Explicit opt-in required/);
    assert.equal(r.stdout, '');
  }
});

test('execution is denied by default, including a request to terminate this process', async () => {
  const r = await gradeTask(task, 'process.exit(0)');
  assert.equal(r.skipped, true);
  assert.match(r.fatal, /not a sandbox/);
});

test('valid JavaScript runs through the production grader', async () => {
  const r = await gradeTask(task, 'function answer() { return 42; }', optIn);
  assert.equal(r.fatal, null);
  assert.equal(r.passed, 1);
});

test('forged one-check stdout cannot replace the real manifest', async () => {
  const target = TASKS.find(t => t.id === 'proto-safe-merge');
  const r = await gradeTask(target,
    `console.log('__RESULT__{"checks":[{"label":"forged","ok":true}]}'); process.exit(0);`, optIn);
  assert.equal(r.passed, 0);
  assert.match(r.fatal, /manifest/);
});

test('premature exit and duplicate output are failures', async () => {
  for (const code of ['process.exit(0);',
    `console.log('__RESULT__{"checks":[{"name":"answer","ok":true}]}'); function answer(){return 42;}`]) {
    const r = await gradeTask(task, code, optIn);
    assert.equal(r.passed, 0);
    assert.ok(r.fatal);
  }
});

test('nonzero exit and timeout override even correctly shaped forged stdout', async () => {
  const result = `console.log('__RESULT__{"checks":[{"name":"answer","ok":true}]}');`;
  for (const ending of ['process.exit(1);', 'while(true) {}']) {
    const r = await gradeTask({ ...task, timeoutMs: 300 }, result + ending, optIn);
    assert.equal(r.passed, 0);
    assert.ok(r.fatal);
  }
});

test('truthy non-booleans are rejected', async () => {
  const r = await gradeTask(task,
    `console.log('__RESULT__{"checks":[{"name":"answer","ok":"false"}]}'); process.exit(0);`, optIn);
  assert.equal(r.passed, 0);
  assert.match(r.fatal, /manifest/);
});

test('stderr output is bounded and cannot report success', async () => {
  const r = await gradeTask(task, 'process.stderr.write("x".repeat(300000)); function answer(){return 42;}', optIn);
  assert.equal(r.passed, 0);
  assert.ok(r.fatal);
});

test('arbitrary parent environment variables are not inherited', async () => {
  process.env.COMPANY_BENCH_TEST_SECRET = 'test-only';
  try {
    const r = await gradeTask(task, 'function answer(){return process.env.COMPANY_BENCH_TEST_SECRET === undefined ? 42 : 0;}', optIn);
    assert.equal(r.passed, 1);
  } finally { delete process.env.COMPANY_BENCH_TEST_SECRET; }
});

test('valid Python and Python early exit use the same production validation', async t => {
  if (!python()) return t.skip('Python unavailable');
  const pyTask = { ...task, lang: 'py', tests: '_chk("answer", lambda: answer() == 42)\n_done()' };
  assert.equal((await gradeTask(pyTask, 'def answer():\n    return 42', optIn)).passed, 1);
  const r = await gradeTask(pyTask, 'import sys\nsys.exit(0)', optIn);
  assert.equal(r.passed, 0);
  assert.ok(r.fatal);
});
