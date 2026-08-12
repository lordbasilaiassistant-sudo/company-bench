# Ollama on a small GPU: what actually moves the number

Measured 2026-08-12 on one machine — RTX 4060 Laptop, **8 GB VRAM**, 31.7 GB RAM, i7-13620H,
Ollama 0.32.9 on Windows. Every figure below is read out of Ollama's own `server.log`, not from
documentation and not from a vendor claim. Where a number is a recollection rather than a
measurement it says so.

This document exists because a benchmark run on this machine published a model's speed that was
wrong by 3x, twice, for two different reasons — both of them harness misconfiguration reported as a
property of the model. A benchmark that gets this wrong is not measuring the candidate.

---

## The one setting that matters more than all the others combined

**Ollama allocates the entire KV cache eagerly at model load, linear in `num_ctx`.** It is not
grown on demand. So the context you ask for is paid for immediately, in VRAM, and whatever no
longer fits gets pushed to the CPU.

On this machine the Ollama desktop app injects `OLLAMA_CONTEXT_LENGTH=262144` into the server it
launches. That value is in neither the user nor the machine environment — it is invisible to
`echo $OLLAMA_CONTEXT_LENGTH` in your own shell, and it applies to every model you load.

Same model blobs, same day, only `-c` differing:

| Model | `-c 8192` | `-c 262144` |
|---|---|---|
| Qwen3-Coder-30B-A3B (IQ4_XS) | **49/49 layers on GPU**, KV 768 MiB, 104 graph splits | **9/49 layers**, KV 24,576 MiB, 582 graph splits |
| Qwythos 9B (Q4_K_M) | 32/33 layers on GPU, KV 256 MiB | 8/33 layers, KV 8,192 MiB |
| Defiant Fable 9B (IQ4_XS) | 25/33 layers on GPU, KV 256 MiB | 5/33 layers, KV 8,192 MiB |

Ollama's own scheduler predicted **7.0 GiB vs 37.2 GiB** of required memory for the same 9B model,
purely from the context setting.

**A correction this measurement forced.** It had been recorded here that Qwen3-Coder-30B "does not
fit in 8 GB VRAM, so it runs on CPU." That is false. At a sane context **all 49 layers went to the
device**; attention is resident and only the MoE expert tensors spill to host memory. The model was
never too big — the KV reservation was. "It doesn't fit" was a conclusion drawn from a symptom
produced by a setting, which is the general shape of most performance folklore.

### What to do

Leave `OLLAMA_CONTEXT_LENGTH` unset on the server and pass `num_ctx` per request, so a task that
needs 64k pays for 64k and a task that needs 8k does not. If your server is started by the desktop
app, its context slider is what you are actually setting.

---

## The setting everyone recommends, which is now a no-op or worse

**Do not set `OLLAMA_FLASH_ATTENTION`.**

Current Ollama passes `--flash-attn auto` to the runner and llama.cpp enables flash attention on
its own. Verified in the launch line in `server.log`. So:

- `OLLAMA_FLASH_ATTENTION=1` — **no-op.** It is already on. Every guide still telling you to set
  this is describing a version where the default was off.
- `OLLAMA_FLASH_ATTENTION=0` — **actively harmful on small cards.** Beyond losing flash attention,
  there is a branch that drops `num_batch` from 512 to 256 when FA is off on a CUDA device with
  ≤ 8 GiB. That is precisely the hardware the setting is usually recommended to.

## The setting that is still worth it

**`OLLAMA_KV_CACHE_TYPE=q8_0` halves KV cache bytes.** Server-level only — there is no per-request
equivalent. The old requirement that flash attention be enabled first is gone in current Ollama,
because flash attention is now on by default.

Combined with the point above, this is how you get large context *and* GPU residency: q8_0 makes a
32k context cost roughly what 16k cost at f16.

---

## Two harness settings that are not speedups but were measured as such

Both of these produced published numbers that were wrong about the model.

**`keep_alive`.** Ollama unloads an idle model after 5 minutes. A benchmark whose gaps between
calls exceed that reloads the weights from disk every time. On a 2.6B model this made **~90 of
every ~100 seconds a disk read**, and the model was published at 21 tok/s when its real generation
rate was 66. The bench was timing a file open, once per task. Set `keep_alive` to cover the whole
run.

**`think`.** Thinking-capable tags emit reasoning by default. Same model, same 64 output tokens:
**24.8s with thinking, 10.2s without, identical generation rate.** On one 8B model the gap was
5.4x. That is a default, not a property of the candidate — and for a coding harness it is usually
not what you want anyway.

**Report generation rate separately from wall-clock.** Ollama returns `eval_count` and
`eval_duration` (nanoseconds, generation only). `eval_count / (eval_duration / 1e9)` is the number
that describes the model; wall-clock describes your setup. Conflating them is how a cold start
becomes "a slow model."

---

## What did *not* turn out to be available

A short list, so nobody re-runs these:

- **Speculative decoding**: no `draft_model` / speculative option exists in Ollama's API surface as
  of 0.32.9. llama.cpp supports it; Ollama does not expose it.
- **Custom quantised KV per request**: `OLLAMA_KV_CACHE_TYPE` is server-wide. You cannot ask for
  q8_0 on one request and f16 on the next.
- **Layer-offload override per request**: `num_gpu` exists in `options`, but with eager KV
  allocation the context setting dominates it; fix the context first and you usually do not need it.

---

## Order of operations

1. Unset `OLLAMA_CONTEXT_LENGTH` on the server (or turn the desktop app's slider down). Pass
   `num_ctx` per request instead. **This is worth more than everything below it combined.**
2. Set `OLLAMA_KV_CACHE_TYPE=q8_0`, then raise `num_ctx` to what your work actually needs.
3. Set `keep_alive` long enough to cover your session, and `think: false` for code work.
4. Leave `OLLAMA_FLASH_ATTENTION` alone.
5. Check `ollama ps`: the `PROCESSOR` column is the whole diagnosis. Mostly-GPU is healthy;
   mostly-CPU with a small model means something above is still wrong.

## Why context is worth paying for anyway

Starving a model of context is not a speedup, it is a capability cut — the tokens are where an
agent keeps the file it just read and the rule it was told. The point of the tuning above is not to
run at 8k. It is that **the cost of context should be a decision you make per task**, rather than a
262144-token bill charged silently to every model you load.
