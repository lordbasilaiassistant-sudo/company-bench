# GPT-OSS 120B (Groq free) in a real coding harness — viability probe

Measured 2026-08-11. Not a benchmark run.
**Verdict: no, on the free tier — and the blocker is a provider ceiling, not the model.** The model does
agentic tool-calling correctly in a minimal loop. Every real harness dies because its turn-1 request is
larger than Groq's entire per-minute token budget.

## 1. Claude Code — blocked twice over
Groq serves OpenAI-compatible paths only. Probed live (POST): `/anthropic/v1/messages` → 404,
`/v1/messages` → 404, `/openai/v1/messages` → 404. Groq's API reference lists `/v1/chat/completions`,
`/v1/responses`, `/v1/audio/*`, `/v1/models`, `/v1/batches`, `/v1/files`, `/v1/fine_tunings` — no Anthropic
Messages endpoint (a feature request is open on their forum, unimplemented). So `ANTHROPIC_BASE_URL` cannot
point at Groq directly; a translating proxy is required. **Minimum free bridge:** litellm — not installed here
(`pip show litellm` → not found), but `pip download litellm --no-deps` succeeded
(`litellm-1.96.2-cp310-abi3-win_amd64.whl`, open source, runs locally at $0). Alternative:
`wearedevx/groq-for-claude-code`, a purpose-built Anthropic→Groq proxy.

**The bridge is pointless anyway.** I pointed Claude Code at a local sink server that captures and tokenizes
the outbound request. Turn-1 `POST /v1/messages` on the prompt "say hi": 198,861 bytes; system prompt
**2,325 tokens**; **73 tool definitions = 38,624 tokens**; messages 11,839; **total 52,788** (o200k_base).
The irreducible floor — system + tool schemas, before a word of conversation — is **40,949 tokens** against a
free TPM limit of **8,000**: Claude Code is **5.1x over the cap on request one.** No proxy, no pacing, and no
context trimming closes a 5x gap.

## 2. OpenCode — configured correctly, ran, failed
OpenCode 1.18.14. `groq/openai/gpt-oss-120b` is a built-in model id (`opencode models`), and auth resolves
straight from the `GROQ_API_KEY` env var (`opencode providers list` shows Groq under Environment, zero stored
credentials). No config file edits needed — just the env var and
`opencode run --model groq/openai/gpt-oss-120b "<task>"`.
Task: *"create a file hello.txt in the current directory containing exactly the word hello"*, scratch dir.
**Result: did not complete. Killed at the 180s timeout. `hello.txt` never created. Not one tool ever ran.**
It emitted the same compaction summary ~14 times in a loop. The log shows why:

```
AI_APICallError: Request too large for model `openai/gpt-oss-120b` ... on tokens per minute (TPM):
Limit 8000, Requested 17681, please reduce your message size and try again.
```

Turn-1 request is **17,681 tokens** — 2.2x the cap. OpenCode auto-compacted, retried, got 17,766, compacted
again, 17,814, 17,830... The floor is its own system prompt plus tool schemas, which compaction cannot touch,
so it ground there until timeout. The rising numbers are retries, not progress.

**This is a provider ceiling and records as no score.** The ceiling is on *request size*, not pacing: a
request needing 17,681 tokens exceeds the whole 8,000/min budget, so it fails no matter how long you wait.
Groq returns a genuinely different 429 for pacing (`Used 7544, Requested 1233. Please try again in 5.8275s`).
I hit both; only the first is fatal.

## 3. What the model itself does
To separate ceiling from capability I wrote a minimal loop: short system prompt, 2 tools, same task.
**It succeeded** — 3 turns, **12.8s wall clock**, `hello.txt` written with exactly `hello`, read back to
verify, then `DONE`. Per-turn `prompt_tokens`: **185 → 219 → 246**.

**Parallel tool calls: no.** Tested twice — three independent ops with an explicit batching instruction, then
`parallel_tool_calls: true` with three independent reads. Both times **exactly 1 tool call**. Budget N
sequential turns for N operations, which multiplies the TPM problem rather than amortizing it.

**Long system prompts: the model holds them, the tier doesn't.** Context window is 131,072 with 65,536 max
completion tokens (`/v1/models`). The 8,000 TPM gate bites at ~6% of the advertised context.

**`max_tokens` is reserved up front — confirmed.** One call with 186 prompt tokens and `max_tokens: 300` moved
`x-ratelimit-remaining-tokens` 8000 → 7514 (486 = 186 + 300). You are charged TPM for output never generated.
Headers confirm the tier: `limit-tokens: 8000`, `limit-requests: 1000` (docs: 30 RPM, 1K RPD, 8K TPM, 200K TPD).

### Turn count before the cap — the killer question
Per-turn TPM debit = `prompt_tokens + max_tokens reserved`, and `prompt_tokens` carries the whole transcript.
For both real harnesses the answer is **zero turns** — 17,681 and 40,949 exceed 8,000 on turn one.

For a hypothetical lean harness that does fit: a 1,500-token floor, ~800 tokens added per turn (one real file
read), 1,000-token reservation → turn 1 debits 2,500; turn 2 debits 3,300 (cum. 5,800); turn 3 needs 4,100
(cum. 9,900) and is refused. That is **2–3 productive turns per 60s window**, then a stall until the bucket
refills; a routine 20-turn task becomes 7–10 minutes that is mostly waiting. My trivial loop grew only
~30 tok/turn because its tool results were the 5-byte string `hello` — real file contents are 20–50x that.

## Bottom line
Free-tier Groq gpt-oss-120b cannot drive Claude Code or OpenCode. Claude Code additionally needs a bridge that
does not exist natively (litellm, free, local) — but fixing that changes nothing, because the request is 5x the
cap regardless. The model is capable of the agentic loop; the 8,000 TPM request-size ceiling is what makes a real
harness impossible. Lifting it requires a paid Dev Tier upgrade, out of scope. The usable free niche is a
purpose-built loop with few tools and a short prompt — proven here at 3 turns in 12.8s — not a general harness.
