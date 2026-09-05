import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chat } from './lib/transport.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseModel = { id: 'fixture', model: 'fixture', api: 'openai', baseUrl: 'http://fixture.invalid', apiKey: 'none' };
test('transport rejects truncated answers for each API and never grades hidden reasoning', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const [api, body] of [
    ['openai', { choices: [{ finish_reason: 'length', message: { content: '{"partial":' } }] }],
    ['anthropic', { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] }],
    ['ollama', { done_reason: 'length', response: 'partial' }],
  ]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => body });
    await assert.rejects(chat({ ...baseModel, api }, 'task', { retries: 0 }), /truncated completion/);
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: null, reasoning_content: 'secret reasoning' } }] }) });
  await assert.rejects(chat(baseModel, 'task', { retries: 0 }), /empty completion/);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] }) });
  assert.equal((await chat(baseModel, 'task', { retries: 0 })).text, 'answer');
  await assert.rejects(chat({ ...baseModel, extraBody: { messages: [] } }, 'task', { retries: 0 }), /cannot override/);
});

test('public CLI rejects malformed submissions and creates a disclosed immutable self-administered run', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'company-bench-runner-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'bench'), path.join(temp, 'bench'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'models.json'), JSON.stringify([
    { id: 'missing-key', name: 'Missing key', model: 'fixture', keyEnv: 'COMPANY_BENCH_TEST_MISSING', baseUrl: 'http://fixture.invalid' },
    { id: 'fixture', name: 'Fixture', model: 'fixture', baseUrl: 'http://user:password@fixture.invalid/v1?key=secret' },
  ]));
  const cli = (script, args) => spawnSync(process.execPath, [path.join(temp, 'bench', script), ...args], { cwd: temp, encoding: 'utf8', env: { ...process.env, COMPANY_BENCH_TEST_MISSING: '' } });
  for (const answers of [null, [], { typo_chair: 'answer' }, { integrity: { answer: 'bad' } }]) {
    fs.writeFileSync(path.join(temp, 'answers.json'), JSON.stringify(answers));
    assert.equal(cli('grade.mjs', ['answers.json']).status, 2);
  }
  assert.equal(cli('run.mjs', ['--models', 'missing-key']).status, 2);
  assert.equal(cli('run.mjs', ['--models']).status, 2);
  assert.equal(cli('run.mjs', ['--model', 'missing-key']).status, 2);
  assert.equal(cli('run.mjs', ['--only', 'typo_chair']).status, 2);
  const pack = cli('take.mjs', ['--out', path.join(temp, 'pack'), '--format', 'json']);
  assert.equal(pack.status, 0, pack.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'pack', 'manifest.json')));
  const tasks = JSON.parse(fs.readFileSync(path.join(temp, 'pack', 'tasks.json')));
  assert.deepEqual(manifest.selectedChairs, tasks.map(c => c.id));
  assert.equal(manifest.acquisitionVerified, false);
  fs.writeFileSync(path.join(temp, 'answers.json'), JSON.stringify({ [tasks[0].id]: 'I do not know.' }));
  assert.equal(cli('grade.mjs', ['answers.json', '--id', '../escape']).status, 2);
  assert.equal(cli('grade.mjs', ['answers.json', '--id']).status, 2);
  assert.equal(cli('grade.mjs', ['answers.json', '--merge']).status, 2);
  for (let i = 0; i < 2; i++) {
    const graded = cli('grade.mjs', ['answers.json', '--id', 'test-model']);
    assert.equal(graded.status, 0, graded.stderr);
  }
  const result = JSON.parse(fs.readFileSync(path.join(temp, 'results', 'test-model.json')));
  assert.equal(result.provenance.collection, 'self-administered');
  assert.equal(result.provenance.collectedAt, null);
  assert.equal(result.provenance.acquisitionVerified, false);
  assert.equal(result.provenance.promptHash, manifest.promptHash);
  assert.equal(Object.keys(result.chairs).length, 1);
  assert.ok(fs.readdirSync(path.join(temp, 'results', 'runs', 'test-model')).length >= 2);
  // Exercise the real API CLI with an in-process transport fixture, without any network call.
  const mock = path.join(temp, 'mock-fetch.mjs');
  fs.writeFileSync(mock, "globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'I do not know.' } }] }) });");
  for (const task of tasks.slice(0, 2)) {
    const ran = spawnSync(process.execPath, ['--import', pathToFileURL(mock).href, path.join(temp, 'bench', 'run.mjs'), '--models', 'fixture', '--only', task.id], { cwd: temp, encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
  }
  const apiResult = JSON.parse(fs.readFileSync(path.join(temp, 'results', 'fixture.json')));
  assert.deepEqual(Object.keys(apiResult.chairs), [tasks[1].id], 'partial runs must never silently merge');
  assert.equal(apiResult.provenance.settings.temperature, 0);
  assert.equal(apiResult.provenance.settings.maxTokens, 4000);
  assert.equal(apiResult.provenance.settings.baseUrl, 'http://fixture.invalid/v1');
  assert.ok(apiResult.provenance.collectedAt <= apiResult.chairs[tasks[1].id].collectedAt);
});
