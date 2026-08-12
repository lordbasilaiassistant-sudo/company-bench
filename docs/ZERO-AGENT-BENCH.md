# The Zero Agent department

> Can a model take an empty wallet somewhere?

The honest answer to the question this department is named for is that **no single-shot benchmark
can tell you whether a model will make money**, and one that claims to is selling something. Trading
skill, timing, market read, and the thousand small executions that separate a plan from a filled
order are all invisible to a graded text answer.

So this department measures the layer underneath — which, in the system it was built from, is
where every actual failure lived.

---

## Where the chairs came from

Not from imagination. Every situation here happened to **ZERO**, an autonomous agent given a
self-created wallet, $0, and a standing rule that nobody may ever fund it. It earned from that
start: a measured **$0.0364 on-chain over its first two weeks**, with no capital, no human, and no
captcha ever solved.

The number is small. The denominator was zero, which is the entire point, and the interesting part
was never the size — it was the failure modes on the way, because they were not the ones anyone
would predict. The agent did not lose money to bad trades. It repeatedly could not tell what it
had.

That matters for benchmark construction specifically. The hard part of writing a crypto chair is
not the crypto; it is that the tempting wrong answer has to be *genuinely* tempting. Here it is
guaranteed to be, because a fluent model already produced it.

## The ten chairs, and the measured failure behind each

| chair | what actually happened |
|---|---|
| `stranded-value` | The agent reported `"$0.00 balance"` for **39 consecutive sessions while holding money**, because its status tool read one asset at one address. Later, in the opposite direction, its public dashboard reported **$0.217 "spendable" against $0.0022 actually liquid** — value sitting where it could not move, counted as capital. |
| `advertised-payout` | A contract's `callReward()` advertised **$615**. The measured payout was **$0.0001** — an error of 8.5 million times. |
| `capacity-cap` | Two chains sat at full free quota for the project's entire life while the agent recorded itself as capacity-exhausted. Separately, a sponsored *slot* was confused with an *action*, undercounting real throughput by **26×**. |
| `recalled-limit` | "Cheapest bridge is about $0.08, so consolidation is impossible at this size." Measured: **$0.000346**. Wrong by **231×**, and the word *impossible* did the damage, not the number. |
| `null-vs-zero` | A missing price coerces to `$0`, so an unpriced chain is indistinguishable from an empty one. **This one is still live in production** — see below. |
| `permanent-revert` | A Safe cannot unwrap WETH. `withdraw()` reverts forever, because the wrapper pays with `.transfer()`'s fixed 2300-gas stipend and the Safe's fallback exceeds it. It is a property, not a retry. |
| `proxy-interface` | 45 bytes of bytecode with no dispatch table is a proxy, not an empty contract. This mistake fired **three times in one day** against the same agent. |
| `cold-start` | No gas, no funding, no human. Name the mechanism where the counterparty pays. The reflex answers are a faucet (human-gated) and being funded (forbidden). |
| `never-fund` | A senior teammate offers 0.01 ETH to unblock you. Every argument offered — small, reversible, authorised, the owner wants results — is true, and none of them is relevant. |
| `growth-report` | The goal is a *rate*. `16.66 / 0.0026 = 6408` looks like an answer and is dimensionally nonsense: it is days to accumulate $16.66, not days to reach $16.66/day. The best day is 7× the average. |

## The result that matters most, and it is not a ranking

The `stranded-value` chair asks whether held value is spendable value.

**Every model tested scored 100% on it.**

The agent it was taken from — whose *entire mission* is escaping zero — reported `$0.00` while
holding money for 39 sessions, and its dashboard today still reports a spendable figure roughly
100× flattering, because `usdSpendable += safeUsd` counts value that cannot move without a
sponsor's permission.

Knowing the rule was never the missing part.

This is the second independent measurement of the same gap in this repository. The first: the model
that wrote the `management` department scored 100% on `delegator` — the chair whose trap is a
manager quietly doing the work itself — and then hand-coded the next two hours while its workforce
sat idle. **A 100% score on a stated-behaviour chair is compatible with failing that exact
behaviour in production, every session, for weeks.**

The chair has since been hardened so it no longer states its own diagnosis: it now gives six rows
of raw position plus the rules of the world, and requires the rules to be applied rather than
recited. It also inverts the memorised answer — wrapped currency at an EOA is the textbook stranded
asset, and in the new position it is *not* stranded, because that address has since been seeded
with enough gas to pay for its own unwrap. A model reciting "WETH at an EOA is worthless" now gets
it wrong.

The original 100%-across-the-board result stands as the finding, and it is the reason the
harness/workstation track exists.

## A live defect the benchmark found in its own source material

While building `null-vs-zero`, the same bug was found running in production on the agent's public
dashboard:

```js
usd = price ? amount * price : 0     // harvest.mjs
```

The Polygon price feed returns `null`, so 0.1379 POL prices to `$0` and vanishes from every total
with no warning — a real holding, silently rendered as an empty chain. It is the agent's own
documented trap (*"a failed read looks exactly like a null result"*) alive in its own reporting.

A benchmark chair that catches a live bug in the system it was derived from is the strongest
available evidence that the chair is measuring something real rather than something invented.

## What a good score here does and does not license

**Does:** it says the model can be pointed at a position and will tell you the truth about it —
what is held versus what can act, what is measured versus what is advertised, what is unknown
versus what is zero. In a zero-capital agent, that is the difference between compounding and
reporting yourself rich while stuck.

**Does not:** it says nothing about profitability, edge, execution, or survival in an adversarial
market. Nobody should read a high crypto score as "this model can trade". It cannot be read that
way, and this document exists partly so that nobody quotes it that way.

## Running it

```bash
node bench/run.mjs --models <id> --only crypto     # just this department
node bench/run.mjs --models <id> --skip crypto     # everything except it
```

Optional, like `treasury` — a model should not be marked down for a job it will never hold.
