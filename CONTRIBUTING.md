# Contributing

Two kinds of contribution are wanted, and one is much more valuable than the other.

1. **A new chair** — a job an agent could hold, with a trap in it. This is the valuable one.
2. **A result** — you ran a model we have not measured. Send the JSON.

Everything is plain Node with no dependencies. `node bench/selftest.mjs` is the gate.

---

## Adding a chair

A chair is one job, one prompt, and a scorer made of code. It lives in
`bench/positions/<department>.mjs` and looks like this:

```js
{
  id: 'invoice-clerk',
  title: 'Invoice Desk',
  blurb: 'One sentence a hiring manager could read. Say what the trap is about, not that there is one.',
  prompt: [
    'Instructions the candidate sees.',
    'Output ONLY JSON: {"total": ..., "unpayable": [...]}',
  ].join('\n'),
  score(out) {
    const j = tryJson(out) ?? {};
    return [
      { label: 'TRAP total excludes the duplicated line', pass: close(j.total, 41.20) },
      { label: 'flags the invoice with no PO number',      pass: (j.unpayable ?? []).includes('INV-7') },
    ];
  },
  gold:  '{"total":41.20,"unpayable":["INV-7"]}',
  decoy: '{"total":52.90,"unpayable":[]}',
}
```

Then add it to the department array. `bench/positions/index.mjs` picks it up automatically.

### The four rules

**1. The scorer is code. No LLM judges anything.**

A gate must be stronger than what it gates, and this benchmark is a gate. An LLM-judged
rubric would make the benchmark exactly as reliable as the model judging it, which is the
thing under test. Every check is a pure function returning `{label, pass}`.

**2. Every chair needs a trap, and the trap must be attractive.**

A checklist is not a test — models pass checklists. A trap is a wrong answer that a *fluent,
capable* model actually reaches for:

- a number that is real but attached to the wrong thing
- a fact deliberately withheld, so the only correct move is to refuse
- an instruction buried inside data that looks like legitimate content
- a teammate who is confident, senior-sounding, and wrong
- a deadline plus an unreachable human plus a reversibility argument
- a request where being helpful is the failure

Label those checks `TRAP <what it catches>`. The selftest requires at least one per chair,
and the report ranks traps by how many candidates take them.

A trap is *not* a gotcha. The correct answer must be defensible from the prompt alone, by
someone who read it carefully and had no access to the scorer. If two answers are both
defensible, the chair measures nothing and will be rejected.

**3. Ship a `gold` and a `decoy`.**

- `gold` is a correct answer. It **must** score 100%. If it does not, the scorer punishes
  correct work, and every candidate's low score on that chair is measuring your bug.
- `decoy` is the attractive wrong answer. It **must** score below 100%. If it does not, the
  chair passes anything.

`node bench/selftest.mjs` enforces both directions plus a third: an empty answer must not score
above 40%, or silence becomes a viable strategy. It caught thirteen scorer bugs the day this
repo was written — including three chairs where the gold answer failed its own scorer.

**4. Be generous about format, strict about substance.**

Use the helpers in `bench/lib/parse.mjs` (`tryJson`, `tryJsonAll`, `stripFences`, `close`,
`absent`). A model that got the substance right and wrapped it in a code fence should lose at
most one check. A model that emitted perfect JSON containing a fabricated number should lose
the chair. If you write a "did not say X" check, use `absent()` — a plain negation is trivially
true of an empty answer.

### Before you open the PR

```bash
node bench/selftest.mjs        # must pass
node bench/run.mjs --list      # your chair appears with its blurb
```

Then run it against at least two real models with genuinely different capability — a small
local model and a frontier one is ideal. Paste both scores in the PR. **If every model scores
100%, the chair is dead weight and will not be merged.** Harden it or withdraw it. Spread is
the whole product.

---

## Sending a result

Run any model and open a PR with the file from `results/`:

```bash
node bench/run.mjs --models ollama:your-model
node bench/report.mjs
```

Include `results/<id>.json` and `results/cards/<id>.md`. The raw model output is inside the
JSON on purpose — a score nobody can audit is a rumour.

Two things will get a result rejected, both for the same reason:

- **Incomplete runs.** If a provider rate-limited you, chairs will show `error`. Those runs are
  automatically excluded from the leaderboard and must not be presented as scores. A provider
  ceiling is not a model failure, and publishing it as one is defamatory.
- **Non-default sampling.** Everything runs at temperature 0 with the prompt exactly as
  committed. If you tuned a system prompt, scaffolded retries, or ran best-of-N, that is a
  legitimate and interesting experiment — say so in the label (`--label "Model (best-of-5)"`)
  so nobody compares it to a single-shot number.

Self-administered results are welcome and sit on the same leaderboard as key-driven ones. If
the agent read `bench/positions/` before answering, that must be in the label. Nobody will
mind; quietly omitting it is the only version that is a problem.

---

## Changing an existing chair

Chairs get harder over time; that is intended. But a chair edit invalidates every committed
score for it, so:

- Say in the PR what the old chair failed to measure and what the edit catches.
- Bump `benchVersion` in `bench/lib/scorecard.mjs` if the change is broad enough that old and
  new results should not be compared.
- Do not delete a chair because everyone passes it. Either harden it, or mark it a floor check
  and say so in the blurb — a chair every model passes is still useful against weak models,
  as long as nobody cites it as evidence when placing a strong one.

---

## Code style

Match what is there. Plain ES modules, no dependencies, no build step, no TypeScript.
Comments explain *why a rule exists* — most of the rules in this repo have a specific failure
behind them, and the comment is where that failure is recorded so the next person does not
undo the fix.

## Conduct

Be straight with people. If a chair is bad, say which check is wrong and why. If a model
scores badly, that is a fact about the model on this test, not a verdict on anyone's work.
