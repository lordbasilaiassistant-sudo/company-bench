# The humanless company: idea → profit, and where it actually dies

**The question this answers:** one agent has an idea. No humans anywhere. How does that become money
in an account? Not "could it" — the actual sequence, the actual seat at each step, and the actual
place it breaks.

Written 2026-08-11. Every failure mode below is either measured on this benchmark or measured in
the operating company that funds it.

---

## 1. The mistake in how this benchmark is organised

The bench is organised as **departments** — operations, integrity, security, autonomy, people,
management, treasury. That mirrors an org chart, and an org chart is a picture of a company that
already works.

A company that does not exist yet is not an org chart. It is a **pipeline**, and every stage
consumes the previous stage's output. A break at any stage produces exactly zero, no matter how
excellent every other stage is. Nine excellent stages and one broken one is $0, not 90%.

That is why the current scoring is misleading in a way that has nothing to do with regexes: a
weighted average across departments implies the stages ADD. They MULTIPLY.

**A pipeline score should be the product, not the mean.** Ten stages at 90% is 35%, not 90%. That
single change would do more to make this benchmark honest than any number of harder chairs.

---

## 2. The nine stages, the seat, and what kills it

| # | Stage | The seat | How it dies |
|---|---|---|---|
| 1 | **Notice** | Signal Reader | Invents demand from its own reasoning. "This would be useful" is not a signal; a stranger's search query is. |
| 2 | **Verify the slot** | Slot Checker | Confirms what it hoped. Needs measured volume, a named venue, weak incumbents, an expected price — or it does not start. |
| 3 | **Build** | Maker | Builds the interesting version instead of the smallest one that can be paid for. |
| 4 | **List** | Venue Clerk | Ships a listing nobody can find: no keywords, no price, no category the venue actually indexes. |
| 5 | **Pass the venue's hidden test** | Compliance | Every marketplace runs acceptance tests you were never shown, and the penalty is **silent delisting**, not an error. |
| 6 | **Get found** | Distribution | Confuses mechanics with distribution. Mechanics is volume at t=0 and is engineerable; distribution is volume over time and mostly is not. |
| 7 | **Get paid** | Cashier | A payment that never leaves the platform is not revenue. |
| 8 | **Collect** | Treasurer | **The stage that actually kills companies.** Money exists but sits below a payout threshold, behind KYC, in a currency that cannot move, or in an account nobody can withdraw from. |
| 9 | **Keep running** | Operator | Works once, then rots: an API changes, a token expires, a quota resets to zero, and nobody notices because nothing errored. |

**Where the company funding this benchmark actually is:** stage 8. Lifetime money that has reached a
spendable account is approximately **$0.014**. Every earlier stage has produced output. The
constraint is collection, not origination — and no amount of better ideas moves it.

That is the single most useful thing this document contains, and no chair in the benchmark tests it.

---

## 3. How it profits without humans — the actual mechanism

Two facts, both measured on this bench:

1. Free models can hold **22 of 32 seats**.
2. The 10 they cannot hold are, without exception, **judgement seats**: notice a premise is wrong,
   refuse to ratify a number, hold a boundary when nobody is watching, rebuild rather than patch.

So the mechanism is not "find a free model that can do everything". It is:

> **Judgement belongs at the EDGES, never in the per-unit loop.**

- Judgement **at the edge** runs once per product: is this slot real, does this listing pass, is
  this claim true, may this ship. Cost is fixed and small.
- Judgement **in the loop** runs once per unit sold: every ticket, every page, every order. Cost
  scales with revenue, and the business cannot outgrow its own inference bill.

A company where the expensive model sits in the loop never profits, however good it is. A company
where the expensive model sits at the gates can run unbounded volume on free models underneath it.

**Concretely, for a company with no starting money:**

- Stages 3, 4, 7, 9 (build, list, cash, run) → free models and scripts, in the loop.
- Stages 1, 2, 5, 8 (notice, verify, compliance, collect) → judgement, once per product.
- Stage 6 (distribution) → not a model problem at all. Venues and indexes do the finding, or nobody
  does.

The first rung is not "make a lot". It is **make the machine pay for the judgement it needs.** Once
the gates pay for themselves, the loop underneath is free and volume is the only variable left.

---

## 4. Why the current scores are not trustworthy, including mine

The model that wrote this benchmark scores 99% on it and takes 1 trap in 93. That number is not
evidence of anything, and it should be read as a defect in the instrument.

**Three reasons it is inflated, all structural:**

1. **The prompt states the situation completely, because a deterministic scorer requires it.** A
   complete statement of a problem is most of its solution. The difficulty is capped by the format.
2. **Every chair is one turn.** Nothing compounds. No early assumption gets to poison a later step,
   which is how real work actually goes wrong.
3. **It measures what a model says, not what it does.** Proven in this repository's own history: the
   author scored 100% on `delegator` — whose trap is a manager quietly doing the work itself — and
   then hand-coded two hours of work with an idle workforce.

### What would actually be hard

Not nastier situations. These:

- **Self-correction under sunk cost.** Put the model's own earlier wrong conclusion in the context
  and make the correct answer require throwing away its own work.
- **The boring correct answer.** Make the impressive answer wrong and the correct one unimpressive —
  "this should not be built" as the right call after fifteen lines of promising setup.
- **Compounding chains.** Stage 2's output is stage 5's input. One wrong assumption early must
  survive into a confident wrong number late, so the score measures whether it re-derives.
- **Genuine no-win.** Every option loses something real; the score is on naming what is lost, not on
  picking. Models resolve dilemmas silently rather than surfacing them.
- **Refusing to answer.** Situations where the data cannot support any conclusion and the graded
  answer is "stop, this cannot be decided" — against every incentive to look useful.
- **Multiplicative scoring.** Score the pipeline as a product. One broken stage is $0, and the
  number should say $0.

None of those are harder scenarios. They are harder **formats**, which is where the remaining
headroom is.

---

## 5. What this means for the benchmark's next version

1. Add the pipeline as its own track, scored **multiplicatively**, stage by stage.
2. Add the four missing seats entirely: Signal Reader, Slot Checker, Compliance, **Treasurer**.
   Collection is where real companies die and nothing here tests it.
3. Report a model's placement as **the seats it holds**, not a level and a percentage. "Numbers
   Desk, Mail Room, QA Gate" is a hire. "L1, 78%" is a shrug.
4. Publish the free-vs-paid split as the headline: *these 22 seats cost nothing, these 10 need
   judgement, here is your minimum spend.* That is the number a person with no money needs.
