# Local model candidates

**Question:** can a local model replace a frontier model in an agent harness?

**Status:** shortlist only. Nothing here was downloaded. Every number labelled *measured* was taken on
the bench machine during this pass; every number labelled *projected* is an estimate and is marked as
one. Measured 2026-08-11.

---

## 0. Before the shortlist: the LFM2.5 disqualification was measured wrong

The only local model on the leaderboard is `LFM2.5 2.6B`, recorded at **21 tok/s** and **129–163
seconds per task**, and disqualified on speed. That disqualification does not survive re-measurement.

The model was already on disk, so it could be re-measured without downloading anything. Same machine,
same Ollama build (0.32.9), same tag (`hf.co/Abiray/LFM2.5-2.6B-Heretic-Abliterated-GGUF:Q8_0`):

| condition | wall clock | output tokens | generation rate | tool call correct |
|---|---|---|---|---|
| cold (model not resident) | **100.3 s** | 64 | 65.8 tok/s | yes |
| warm, `think: false` | **10.2 s** | 64 | 64.3 tok/s | yes |
| warm, `think: true` | **24.8 s** | 64 | 64.1 tok/s | yes |

Three things follow, and they change what to test next more than the shortlist does:

1. **Generation is 62–66 tok/s, not 21.** The 21 figure is end-to-end task throughput, not the
   model's speed. It bundles model load, prompt processing and output length into one number and
   then compares that number against a per-token bar. Those are different quantities.
2. **~90 of the ~100 cold seconds are model load, not inference.** A warm model answers the same
   question in 10.2 s. If the harness lets Ollama's `keep_alive` lapse between the 29 chairs — the
   default is 5 minutes, and a chair that takes longer than that to grade will drop the model — then
   the bench is largely timing a disk read, 29 times.
3. **Thinking tokens are the second tax.** Same model, same 64 output tokens, 24.8 s vs 10.2 s.
   `ollama show` reports `thinking` as a capability for this tag, and it is on by default.

Confirmed on a second, unrelated model on the same box
(`Josiefied-Qwen3-8B-abliterated-v1-i1-GGUF:Q4_K_M`, already on disk), one identical tool-call task:

| condition | wall clock | output tokens | generation rate |
|---|---|---|---|
| `think: true` | **139.8 s** | ~1600 | 11.5 tok/s |
| `think: false` | **25.8 s** | 166 | 11.2 tok/s |

**5.4× wall-clock reduction, identical generation rate, tool call still correct.** The generation
rate never moved. All of the difference is tokens emitted.

> **Do this before downloading anything.** Set `keep_alive` long enough to span the whole run and
> pass `think: false` in the Ollama request body. Until then the harness cannot tell a slow model
> from a cold one, and any local model will be disqualified for the harness's behaviour rather than
> its own. LFM2.5 should be re-run under those settings; its real disqualifier is its **L0 score**
> (38 overall, 21 operations, 34 people), which is a genuine finding and does not need a speed
> argument propping it up.

---

## 1. The hardware, measured

Everything below assumes this machine. It is a laptop, and that matters more than the GPU name.

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 4060 **Laptop** |
| VRAM | 8188 MiB (~8.0 GB), of which ~1.5–2.0 GB is held by the Windows desktop and browsers |
| **Usable VRAM budget** | **~6.0 GB** for a model plus its KV cache |
| System RAM | 32 GB |
| PCIe link | **gen 3 × 8** (~7.9 GB/s) — measured, not the gen 4 × 8 the spec sheet implies |
| Thermal state under load | **82–89 °C**, SM clock **1515–2010 MHz against a 3105 MHz maximum** |
| Runner | Ollama 0.32.9, listening on **port 11435** (not the default 11434) |

Two consequences that most published benchmarks will mislead you about:

- **Halve every number you read online.** Public "RTX 4060 does 40+ tok/s at 8B Q4_K_M" figures are
  desktop cards at full clocks. This card runs sustained inference at roughly half its rated SM
  clock because it is thermally limited in a laptop chassis. Measured here: 8B Q4_K_M delivered
  **11.25 and 12.88 tok/s** across two runs. Not 40.
- **Spilling to system RAM is fatal, not merely slow.** At PCIe gen 3 × 8 the link is ~7.9 GB/s
  against the GPU's own ~200 GB/s. Any model whose weights plus KV cache exceed the ~6 GB usable
  budget stops being a GPU model. This is a cliff, not a slope, and it sets the real size ceiling.

**Working rule for this box: keep the GGUF file at or under ~5.5 GB.** Above that you are betting on
headroom you do not have.

---

## 2. Hard gates, applied in order

Applied as the brief specifies — tool calling first, because it is binary.

1. **Tool calling.** Verify, do not assume. `ollama show <model>` prints a `Capabilities` block; the
   word `tools` must appear in it. This was confirmed working on both locally installed models
   during this pass. A `tools` flag is necessary but not sufficient — it says the template can
   *parse* a tool call, not that the model reliably *emits* one, so every candidate still needs a
   live single-call probe before it takes a bench seat.
2. **Q4_K_M or better.** No Q2, no Q3. Note that `granite4.1` publishes `q2_K` and `q3_K_S` tags and
   they are the smallest files on the page — they are the trap, not the bargain. There is also a
   specific, documented failure here: **IQ3 quantisation of Qwen3.6-35B-A3B produces malformed
   function-call JSON** while IQ4 and Q6 do not. Low quant does not degrade tool calling gracefully;
   it breaks the JSON.
3. **≥10 tok/s, ideally ≥20.** On this machine that translates directly to file size, per §1.
4. **Architecture stable in llama.cpp/Ollama.** This is currently the single most active source of
   wasted downloads — see §4.

---

## 3. The shortlist

Ranked by likelihood of reaching **L2 (unattended operator)** on this bench. Sizes are the published
Ollama download sizes. Speeds marked *(measured)* were taken on this box during this pass; all others
are *(projected)* by interpolation between the two measured points and should be treated as estimates
with roughly ±30% error until run.

### 1. `qwen3.5:9b-q4_K_M` — highest ceiling, worst fit

| | |
|---|---|
| Identifier | `ollama pull qwen3.5:9b-q4_K_M` |
| Params / quant | 9B dense / Q4_K_M |
| Size | **6.6 GB** |
| VRAM needed | ~7.5 GB with KV cache — **over the ~6 GB usable budget on this box** |
| Speed | ~8–10 tok/s *(projected)*, worse if it spills |
| Tool calling | **Confirmed** — `qwen3.5` is listed under Ollama's `tools` capability filter |

The best judgment available in a size that is even arguably local, and the Qwen3 series has the
lowest dropped-tool-call rate of the local families. But 6.6 GB does not fit the measured budget.
Ranked first on ceiling and last on fit; realistically this needs a 12 GB+ card. Also note the 9b
tag is multimodal ("Text, Image input"), which adds a vision projector you will never use and
weights you still have to load.

### 2. `qwen3.5:4b-q4_K_M` — the best balance

| | |
|---|---|
| Identifier | `ollama pull qwen3.5:4b-q4_K_M` |
| Params / quant | 4B dense / Q4_K_M |
| Size | **3.4 GB** |
| VRAM needed | ~4.5 GB with KV cache — **fits comfortably** |
| Speed | ~22–30 tok/s *(projected)* — clears the 20 tok/s target |
| Tool calling | **Confirmed** via the `qwen3.5` tools capability listing |

Newest generation, fits the budget with room for context, clears the ideal speed bar. If only one
model gets downloaded, it is this one. Caveat: released March 2026 and natively multimodal, so it
carries the mmproj risk described in §4 — pull the **official library tag**, never a third-party
HF GGUF of it.

### 3. `qwen3:4b-instruct-2507-q4_K_M` — the safe pick, and the one to run first

| | |
|---|---|
| Identifier | `ollama pull qwen3:4b-instruct-2507-q4_K_M` |
| Params / quant | 4B dense / Q4_K_M |
| Size | **2.5 GB** |
| VRAM needed | ~3.5 GB with KV cache — **fits easily** |
| Speed | ~28–35 tok/s *(projected)* |
| Tool calling | **Confirmed** — Qwen3 tool calling is documented and OpenAI-shaped |

Deliberately the *older* generation, and that is the point: `qwen3` has been stable in llama.cpp and
Ollama for over a year, so the quants load. It is also the **`instruct`** variant rather than
`thinking` — given that thinking tokens cost 5.4× wall clock on this box (§0), starting from a
non-thinking checkpoint removes the largest single time cost by construction rather than by config
flag. Lower ceiling than `qwen3.5:4b`, far lower risk. Best first download.

### 4. `granite4.1:8b-q4_K_M` — trained for exactly this job

| | |
|---|---|
| Identifier | `ollama pull granite4.1:8b-q4_K_M` |
| Params / quant | 8B / Q4_K_M |
| Size | **5.3 GB** |
| VRAM needed | ~6.3 GB with KV cache — **right at the edge of the budget** |
| Speed | ~12–14 tok/s *(projected, anchored on the measured 8B result)* |
| Tool calling | **Confirmed** — IBM documents tool use and structured JSON output as trained capabilities |

The only candidate whose vendor treats tool use and structured JSON as headline features rather than
side effects, plus a 128K context and Apache 2.0. Clears the 10 tok/s floor but not the 20 target,
and sits at the VRAM edge. Worth testing specifically on the chairs where small models fail — a model
post-trained for structured output may hold the integrity and treasury chairs better than its size
suggests.

### 5. `qwen3:8b-q4_K_M` — the only fully measured candidate

| | |
|---|---|
| Identifier | `ollama pull qwen3:8b-q4_K_M` |
| Params / quant | 8B dense / Q4_K_M |
| Size | **5.2 GB** |
| VRAM needed | 6.0 GB resident, **measured** (`ollama ps` reported 100% GPU) |
| Speed | **11.25 and 12.88 tok/s across two runs (measured)** |
| Tool calling | **Confirmed by live probe, not by flag** — emitted `get_ledger_row{row_id:"L-1042"}`, arguments valid |

Ranked here rather than higher because everything about it is known rather than hoped. A near-identical
8B Q4_K_M was on disk and was actually run: it produced a correct, well-formed tool call in **25.8 s**
with `think: false`. It clears the 10 tok/s floor and misses the 20 target. Its real value is as the
**calibration point** — it is the one row in this table that is not an estimate, and every projection
above is anchored to it.

### 6. `granite4.1:3b-q4_K_M` — the speed floor

| | |
|---|---|
| Identifier | `ollama pull granite4.1:3b-q4_K_M` |
| Params / quant | 3B / Q4_K_M |
| Size | **2.1 GB** |
| VRAM needed | ~3.0 GB — trivially fits |
| Speed | ~35–45 tok/s *(projected)* |
| Tool calling | **Confirmed** (same IBM tool-use training as the 8B) |

Fastest credible tool-caller here. Included to establish the bottom of the curve, not because 3B is
expected to hold a chair. If this scores materially above LFM2.5's 38 it tells you the LFM2.5 result
was about that model rather than about the size class — which is worth knowing cheaply.

### 7. `qwen3.5:2b-q4_K_M` — the control

| | |
|---|---|
| Identifier | `ollama pull qwen3.5:2b-q4_K_M` |
| Params / quant | 2B dense / Q4_K_M |
| Size | **1.9 GB** |
| VRAM needed | ~2.8 GB |
| Speed | ~50–65 tok/s *(projected)* |
| Tool calling | **Confirmed** via the `qwen3.5` tools capability listing |

Not a candidate for a seat. It is the size-matched control against LFM2.5 2.6B: same class, newer
generation, current architecture. Running it isolates whether LFM2.5's L0 is a 2B-class ceiling or a
model-specific result. Cheap and answers a real question.

### 8. `gemma4:12b-it-qat` — listed to be ruled out

| | |
|---|---|
| Identifier | `ollama pull gemma4:12b-it-qat` |
| Size | **7.2 GB** (the `q4_K_M` tag is 7.6 GB) |
| Tool calling | Confirmed — `gemma4` lists vision, audio, tools, thinking |
| Verdict | **Does not fit.** 7.2 GB against a ~6.0 GB usable budget |

Documented here so it is not re-proposed. Gemma 4's smallest tags are misleadingly named: `e2b` is a
26B-parameter MoE, so `gemma4:e2b-it-q4_K_M` is **7.2 GB**, not the ~2 GB the name suggests. Every
Gemma 4 tag exceeds this machine's budget. Revisit on a 12 GB+ card.

### Explicitly out of reach on 8 GB

`qwen3:30b-a3b-instruct-2507-q4_K_M` (19 GB), `qwen3.5:27b` / `qwen3.5:35b`, `qwen3.6:35b-a3b`,
`gpt-oss:20b` (~14 GB), `lfm2:24b`, `nemotron-3.5-lightning:30b`. The MoE models in this group are
tempting because only ~3B parameters activate per token, but **all experts must still be resident**.
At 19 GB against 8 GB of VRAM the remainder streams over a measured PCIe gen 3 × 8 link, and the
model becomes unusable rather than merely slow. Do not attempt these on this machine; they are the
right shortlist for a 24 GB card and a different document.

---

## 4. The architecture trap, with receipts

The brief warns that days-old architectures ship quants the loader cannot read. This is currently
happening to precisely the models that look most attractive:

- **`unknown model architecture: 'qwen35moe'`** when loading imported Qwen3.5/3.6 GGUFs
  ([ollama/ollama#14730](https://github.com/ollama/ollama/issues/14730))
- **`qwen3next: layer 40 missing attn_qkv/attn_gate projections`** — Ollama fails on Qwen3.6-35B-A3B
  GGUFs built with the upstream MTP/nextn prediction layer, including Unsloth's
  ([ollama/ollama#16282](https://github.com/ollama/ollama/issues/16282))
- **mmproj vision sidecars are not handled by Ollama's loader**, which affects the multimodal
  Qwen3.5/3.6 and Gemma 4 GGUFs ([ollama/ollama#15834](https://github.com/ollama/ollama/issues/15834),
  [#16264](https://github.com/ollama/ollama/issues/16264))

**The rule that falls out of this:** the *official* `ollama.com/library` tags for `qwen3.5` and
`qwen3.6` work, because Ollama packages and tests them. Third-party HuggingFace GGUF conversions of
the same weights frequently do not. Prefer `ollama pull qwen3.5:4b-q4_K_M` over any `hf.co/...` tag
of the same model. Note that both models currently on this box are `hf.co/...` third-party abliterated
conversions — they happen to load, but they are not the configuration to standardise on.

---

## 5. Can any of these reach L2? Probably not.

**The honest answer is no, and the reasoning is not about local models specifically.**

Where the leaderboard actually stands:

| model | class | level | overall | traps taken /78 |
|---|---|---|---|---|
| Claude Opus 5 | frontier | **L3** | 99 | 1 |
| GLM 4.5 Flash | hosted free, ~100B+ | **L1** | 76 | 15 |
| Mistral Small | hosted free, ~24B | **L1** | 74 | 23 |
| Llama 3.3 70B | hosted free, 70B | **L0** | 74 | 14 |
| LFM2.5 2.6B | local, 2.6B | **L0** | 38 | 40 |

Read the trap column, not the overall column. Opus takes 1 trap in 78. The best free hosted model
takes 15. A 70B model takes 14 and still lands L0. LFM2.5 takes 40 — it walks into more than half of
them. Overall scores compress; trap resistance does not, and **L2 is gated on trap resistance**,
because "runs unsupervised on reversible work, stops dead at anything irreversible" is exactly the
behaviour a trap is designed to break.

The problem this creates for the local case: **every model on the shortlist is smaller than every
model that has already failed to clear L1.** Mistral Small is roughly 24B and reached L1 with 23
traps taken. Llama 3.3 70B is nearly ten times the size of the largest candidate here and did not
reach L1 at all. Asking a 4B model to clear a bar that a 70B model missed is not a hopeful bet, it is
an unmotivated one. Nothing in §3 has an argument for why it would.

There is also a specific failure mode the security column exposes. LFM2.5 scored **41 on security**;
GLM 4.5 Flash, far larger, scored **53**. The security chairs are where an instruction is hidden
inside a forwarded email — the model has to notice that some text in its context is data rather than
instruction. That discrimination appears to come from post-training scale, and it is precisely the
capability an unattended operator cannot be without. A model that reads injected text as an order
cannot hold an L2 seat regardless of how fast it does so.

**Where L2 might actually live.** Extrapolating from the two hosted L1 results, the plausible
threshold is the **27B–35B class at Q4_K_M**, roughly 17–20 GB — `qwen3.5:27b`, `qwen3.6:35b-a3b`,
`qwen3:30b-a3b-instruct-2507`. That needs a 24 GB card, not this laptop. And it remains a bet rather
than a projection: GLM 4.5 Flash is well above that size and still only made L1. The size that
*reliably* clears L2 may be above anything that runs locally on consumer hardware at all.

### What is worth doing anyway

The negative result does not make the exercise worthless, but the goal should be stated honestly:

- **L0/L1 seats are real seats.** GLM 4.5 Flash holds L1 and is in production use. A local 4B at L1
  would be a genuinely useful drafter that runs with no API, no rate limit and no dependency on
  anyone's free tier. That is the realistic target — not L2.
- **Fix the harness first (§0).** Cold-load and thinking-token costs currently dominate the local
  measurements by 5–10×. Any local run made before `keep_alive` and `think: false` are set measures
  the harness, not the model. This costs nothing and invalidates a real result that is already on
  the leaderboard.
- **Download order.** `qwen3:4b-instruct-2507-q4_K_M` first (safest, fastest, non-thinking), then
  `qwen3.5:4b-q4_K_M` (best balance), then `granite4.1:8b-q4_K_M` (the tool-use specialist). That is
  8.2 GB of downloads and answers the question. If none of the three clears L1, the local avenue is
  closed at this hardware tier and should be recorded as closed rather than retried.

---

## 6. How to reproduce the measurements

Ollama listens on **port 11435** on this machine, not the default 11434 (`OLLAMA_HOST` is set to
`http://localhost:11435`). Zero dependencies, Node ≥ 18:

```js
const H = "http://127.0.0.1:11435";
const tools = [{ type: "function", function: {
  name: "get_ledger_row",
  description: "Fetch one row from the ledger by its id.",
  parameters: { type: "object", properties: { row_id: { type: "string" } }, required: ["row_id"] }
}}];

const t0 = Date.now();
const r = await fetch(H + "/api/chat", { method: "POST", body: JSON.stringify({
  model: process.argv[2],
  stream: false,
  think: false,                 // 5.4x wall-clock reduction, measured
  keep_alive: "30m",            // otherwise you are timing a disk read
  tools,
  options: { temperature: 0, num_predict: 400 },
  messages: [{ role: "user", content: "Pull ledger row L-1042 and tell me its amount. Use the tool; do not guess." }]
})});

const j = await r.json();
const tc = j.message?.tool_calls;
console.log({
  wall_s: (Date.now() - t0) / 1000,
  tool_call_ok: !!tc?.length && tc[0].function.arguments.row_id === "L-1042",
  out_tokens: j.eval_count,
  tok_s: j.eval_count / (j.eval_duration / 1e9)   // generation rate, separate from wall clock
});
```

Report `tok_s` and `wall_s` as **separate columns on the leaderboard**. Collapsing them into one
"tokens per second" figure is what produced the incorrect LFM2.5 disqualification: the model
generated at 62 tok/s and was recorded at 21.

Capability check before any of this — binary, and it costs nothing:

```
ollama show <model>     # the Capabilities block must contain: tools
```

---

## Sources

- [Ollama tools-capable model list](https://ollama.com/search?c=tools)
- [qwen3.5 tags](https://ollama.com/library/qwen3.5/tags) · [qwen3 tags](https://ollama.com/library/qwen3/tags) · [granite4.1 tags](https://ollama.com/library/granite4.1/tags) · [gemma4 tags](https://ollama.com/library/gemma4/tags)
- [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) · [unsloth GGUF builds](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF)
- Ollama loader issues: [#14730](https://github.com/ollama/ollama/issues/14730) · [#15834](https://github.com/ollama/ollama/issues/15834) · [#16264](https://github.com/ollama/ollama/issues/16264) · [#16282](https://github.com/ollama/ollama/issues/16282)
- [Best Ollama models for AI agents](https://localaimaster.com/blog/best-ollama-models-for-agents) · [Ollama VRAM requirements](https://localllm.in/blog/ollama-vram-requirements-for-local-llms) · [Morph: best Ollama models ranked by VRAM](https://www.morphllm.com/best-ollama-models) · [Ollama v0.32 release notes](https://www.promptquorum.com/local-llms/top-open-source-models-ollama)
