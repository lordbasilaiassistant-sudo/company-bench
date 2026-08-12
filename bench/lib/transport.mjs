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
    // Two settings decide whether a local model is measured or slandered, both found by
    // re-measuring a model this bench had already disqualified:
    //
    //   keep_alive — Ollama unloads after 5 minutes by default. A 29-chair run takes longer than
    //     that per gap, so the model was reloaded from disk repeatedly and ~90 of every ~100
    //     seconds was a disk read, not inference. The bench was timing a file open, 29 times.
    //   think     — thinking-capable tags emit reasoning by default. Same model, same 64 output
    //     tokens: 24.8s with thinking, 10.2s without, identical generation rate. On an 8B model the
    //     gap was 5.4x. That is a harness default, not a property of the candidate.
    //
    // This is the same rule already applied to API providers — a provider ceiling is not a model
    // failure — which had simply never been applied to local models.
    const body = {
      model: model.model, prompt, stream: false,
      keep_alive: model.keepAlive ?? '30m',
      options: { temperature: 0, num_predict: maxTokens, num_ctx: model.numCtx ?? 8192 },
    };
    if (model.think !== undefined) body.think = model.think;
    else body.think = false;
    const res = await fetch(`${model.baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    // eval_duration is nanoseconds of GENERATION only. Reporting it separately keeps a cold start
    // from being read as a slow model.
    const genRate = j.eval_count && j.eval_duration
      ? Math.round((j.eval_count / (j.eval_duration / 1e9)) * 10) / 10
      : null;
    return { text: j.response ?? '', tokens: j.eval_count ?? 0, genRate };
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
    // An ollama entry that does not pin a baseUrl follows the machine's own OLLAMA_HOST. A pinned
    // one is left exactly as written — someone who typed a port meant it.
    if (m.api === 'ollama' && !m.baseUrl) m.baseUrl = ollamaBaseUrl();
  }
  return reg;
}

/**
 * Where the local Ollama server actually is.
 *
 * `OLLAMA_HOST` is the variable Ollama itself defines and the one every user has already exported
 * (it is what `ollama ps` and `ollama launch` read). This resolver honoured only `OLLAMA_HOST_URL`
 * and otherwise hard-defaulted to port 11434 — so on a machine whose server listens on 11435, an
 * `ollama:<tag>` spec produced a bare `fetch failed` against a dead port, with the server sitting
 * healthy the whole time and logging no request at all. Accept both, and accept the bare `host:port`
 * form Ollama uses, since `OLLAMA_HOST` has no scheme.
 */
export function ollamaBaseUrl() {
  const raw = process.env.OLLAMA_HOST_URL || process.env.OLLAMA_HOST;
  if (!raw) return 'http://127.0.0.1:11434';
  const s = String(raw).trim();
  return /^https?:\/\//i.test(s) ? s.replace(/\/$/, '') : `http://${s.replace(/\/$/, '')}`;
}

/** `ollama:qwen3:8b` / `openai:gpt-4o` / `anthropic:claude-opus-5` / a registry id. */
export function resolveModel(spec, registry) {
  const known = registry.find(m => m.id === spec);
  if (known) return known;
  const [scheme, ...rest] = spec.split(':');
  const name = rest.join(':');
  // `ollama:<tag>` and the registry entry that names the same tag are the SAME candidate, and must
  // not get two identities. They did: results are filed under the model id, so a full run launched
  // by tag and a re-run launched by registry id produced two files for one model, one of them a
  // 60-character slug of a HuggingFace path. Prefer the registry entry whenever the tag matches —
  // it also carries that entry's numCtx/keepAlive, which the ad-hoc form silently drops.
  const sameModel = registry.find(m => m.api === scheme && m.model === name);
  if (sameModel) return sameModel;
  if (scheme === 'ollama') {
    return { id: spec, name: `${name} (ollama)`, api: 'ollama', model: name, cost: 'local',
      baseUrl: ollamaBaseUrl(), apiKey: 'none' };
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
