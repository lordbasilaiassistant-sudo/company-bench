/**
 * transport.mjs — one function that talks to anything.
 *
 * Three shapes cover the entire field: OpenAI-compatible /chat/completions (Groq, z.ai, Mistral,
 * NVIDIA NIM, Cerebras, Together, OpenRouter, vLLM, LM Studio, Ollama's compat endpoint, OpenAI
 * itself), Anthropic's /v1/messages, and Ollama's native /api/generate.
 *
 * Everything runs at temperature 0. A benchmark you cannot re-run to the same number is a story.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 180_000;

/** Resolve an API key: real env var first, then a .env file next to the repo, then ~/.claude/secrets. */
export function resolveKey(envName, { keyFile } = {}) {
  if (!envName) return 'none';
  if (process.env[envName]) return process.env[envName];
  const candidates = [
    path.join(process.cwd(), '.env'),
    ...(keyFile ? [path.join(os.homedir(), '.claude', 'secrets', keyFile)] : []),
  ];
  for (const f of candidates) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(new RegExp(`^\\s*${envName}\\s*=\\s*(.+)$`, 'm'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* next */ }
  }
  return undefined;
}

/**
 * @param {object} model  { id, api: 'openai'|'anthropic'|'ollama', baseUrl, model, apiKey, maxTokens }
 * @returns {Promise<{text: string, ms: number, tokens: number}>}
 */
export async function chat(model, prompt, { maxTokens, retries = 2, timeoutMs } = {}) {
  timeoutMs = timeoutMs ?? model.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  maxTokens = maxTokens ?? model.maxTokens ?? 4000;
  const t0 = Date.now();
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const out = await once(model, prompt, maxTokens, timeoutMs);
      // Some endpoints return an empty completion under load. Retrying is fairer than scoring "".
      if (!out.text.trim() && attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
      return { ...out, ms: Date.now() - t0 };
    } catch (e) {
      lastErr = e;
      const retriable = /429|5\d\d|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(String(e.message ?? e));
      if (attempt < retries && retriable) { await sleep(3000 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw lastErr ?? new Error('exhausted retries');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function once(model, prompt, maxTokens, timeoutMs) {
  const api = model.api ?? 'openai';
  const signal = AbortSignal.timeout(timeoutMs);

  if (api === 'ollama') {
    const res = await fetch(`${model.baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model.model, prompt, stream: false,
        options: { temperature: 0, num_predict: maxTokens, num_ctx: model.numCtx ?? 8192 },
      }),
      signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return { text: j.response ?? '', tokens: j.eval_count ?? 0 };
  }

  if (api === 'anthropic') {
    const res = await fetch(`${model.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': model.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.model, max_tokens: maxTokens, temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    const text = (j.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('');
    return { text, tokens: j.usage?.output_tokens ?? 0 };
  }

  // default: OpenAI-compatible
  const body = {
    model: model.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: maxTokens,
  };
  if (model.extraBody) Object.assign(body, model.extraBody);
  const res = await fetch(`${model.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${model.apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${model.id} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const msg = j.choices?.[0]?.message ?? {};
  // Reasoning models sometimes put the answer in reasoning_content when content is truncated.
  const text = msg.content || msg.reasoning_content || '';
  return { text, tokens: j.usage?.completion_tokens ?? 0 };
}

/** Load models.json, resolve keys, and expand `--model provider:name` shorthands. */
export function loadRegistry(file) {
  const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const m of reg) {
    m.api ??= 'openai';
    m.apiKey = m.keyEnv ? resolveKey(m.keyEnv, m) : 'none';
  }
  return reg;
}

/** `ollama:qwen3:8b` / `openai:gpt-4o` / `anthropic:claude-opus-5` / a registry id. */
export function resolveModel(spec, registry) {
  const known = registry.find(m => m.id === spec);
  if (known) return known;
  const [scheme, ...rest] = spec.split(':');
  const name = rest.join(':');
  if (scheme === 'ollama') {
    return { id: spec, name: `${name} (ollama)`, api: 'ollama', model: name, cost: 'local',
      baseUrl: process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434', apiKey: 'none' };
  }
  if (scheme === 'anthropic') {
    return { id: spec, name, api: 'anthropic', model: name, cost: 'paid',
      baseUrl: 'https://api.anthropic.com', apiKey: resolveKey('ANTHROPIC_API_KEY') };
  }
  if (scheme === 'openai') {
    return { id: spec, name, api: 'openai', model: name, cost: 'paid',
      baseUrl: 'https://api.openai.com/v1', apiKey: resolveKey('OPENAI_API_KEY') };
  }
  return null;
}
