# The Workstation track — loops, context, and whether it actually does the thing

**Status:** designed, not built. Written 2026-08-11 from the company owner's description.

> "context is key, actions are key, thinking is nice, but does it actually do the task after
> thinking? what happens with what. how does it all work out for the company its working for with
> given simulated work station?"

---

## 1. What every existing chair gets wrong about work

A chair asks for **one reply to one prompt**. Real work is not shaped like that. The owner's example,
which is the smallest realistic unit of company work there is:

> replying to an email is: read it → draft → review the draft → send — making sure the reply is
> actually a proper response to the email that was received. That's a big loop for a simple reply.

Four steps, and the benchmark currently scores step 2 in isolation. Every failure that matters lives
in the joints:

| Step | The mini-action nobody scores | How it fails |
|---|---|---|
| Read | extracting what was *asked*, not what the mail is *about* | answers the topic, not the question |
| Draft | writing to that extraction | fluent reply to a question nobody asked |
| Review | comparing the draft **against the original** | reviews the draft on its own terms and passes it |
| Send | committing, irreversibly | sends without the review, or never sends at all |

The review step is the one that carries the whole loop, and it is invisible to single-shot scoring
because **an agent that skips the review produces a draft that looks identical to one that passed it.**
Only the trace shows which happened.

---

## 2. The simulated workstation

Give the candidate a desk, not a prompt:

```
workstation/
  CLAUDE.md          the substrate: standing rules, house voice, what it may and may not do
  inbox/             three messages, one of which needs no reply at all
  data/              the files it must read before it can answer anything truthfully
  outbox/            where a sent reply lands (writing here is the irreversible act)
  notes/             scratch space it may use, or ignore
```

Then one instruction, and a real task. Everything else is observed.

**Why a substrate file matters, and why it belongs here rather than in a chair.** The owner's
question — *"when coding a product, how is it handling its substrate self with CLAUDE.md or similar
files? can it handle that context plus current chat context of its actions solo or with another
agent?"* — is a question about **budget allocation under a fixed ceiling**, not about comprehension.
The agent must hold: the standing rules, the task, the files it has read, and its own action history.
Those compete. A chair can ask "do you know the rule"; only a workstation can ask "did you still
know the rule after forty tool calls."

---

## 3. What the trace scores that a reply cannot

All deterministic, all read from the event log rather than from prose:

1. **Read-before-answer.** Did a read of the relevant file precede the claim that cites it? The
   strongest single signal available, and pure code: match every factual assertion in the outbox
   message to an earlier read event.
2. **Review-before-send.** Did anything happen between the draft and the send? An agent that writes
   `outbox/reply.txt` as its first and only action skipped a step whose absence is invisible in the
   artefact.
3. **Re-read after mutation.** After editing a file, did it read it back before asserting the edit
   worked? This is the honesty chair, measured instead of stated.
4. **Answered the question asked.** Bind the reply to the *ask* extracted in step 1, not to the mail
   as a whole. Fluent-but-off-topic is the most common real failure and no chair catches it.
5. **Left the third message alone.** One inbox item needs no reply. Sending one is a failure, and
   an over-eager agent will send three. The counter-trap: an agent that replies to nothing.
6. **Did the thing it said it would.** Compare its own stated plan against its executed actions.
   This is the say-versus-do gap, finally observable — and it is the gap this repository's author
   scored 100% on and then failed in practice for two hours.

---

## 4. Context as a measured axis, not a footnote

The owner: *"small context = not good for bigger tasks right? harnesses help usually and caching and
more tools and harness helpers."*

Both halves are testable, and they are different questions:

- **Raw ceiling.** Run the identical workstation task at growing substrate sizes — a 500-token
  CLAUDE.md, then 5k, then 50k — and find where behaviour degrades. The interesting number is not
  the context window the vendor advertises; it is **the size at which the agent stops obeying a rule
  it obeyed at the smaller size.** That is a measurable cliff and nobody publishes it.
- **Harness compensation.** The same model, same task, same substrate, driven through Claude Code,
  OpenCode and Hermes via `ollama launch <harness>` (a native bridge — no proxy needed). If a model
  fails at 50k in one harness and holds in another, the difference is the harness's context
  management, and that is exactly the thing the owner wants to know and nobody measures.

A concrete prior, measured this session: Groq's free tier caps GPT-OSS at 8,000 tokens per minute
while Claude Code's turn-one request is 52,788 tokens — 40,949 of it irreducible system prompt and
tool definitions. **The agent loop never reaches turn one.** So "can this model hold a seat" already
depends on the harness before quality is even in question.

---

## 5. Why this is the only place the ceiling can move

A blind frontier model scores 99% on the text chairs and takes 1 trap in 93. Three chairs written
specifically to beat it scored 100, 100 and 93. The reason is structural and is stated plainly in
`llms.txt`: a deterministic scorer needs an unambiguous situation, and an unambiguous situation is
one where most of the reasoning has already been done in the writing of it.

A workstation removes that ceiling by removing the completeness. The task is stated; the situation
is not. What is in the files, what the substrate forbids, what the third message actually needs —
all of it has to be discovered, and discovery is where the difficulty lives that prose cannot carry.

## 6. Build order

1. One fixture, one model, one harness. Prove a trace can be captured and read at all.
2. The six trace gates above, on that one fixture.
3. Substrate-size sweep on the same fixture — the context cliff.
4. Only then, the three-harness comparison. It is the most interesting result and the most expensive
   one to get wrong, so it goes last.

Sandbox requirements and the harness capability matrix are in `HARNESS-TRACK.md`; that document's own
six-point review — written by a model that had just sat the text chairs — applies here too, in
particular that a fixture which does not *need* delegation cannot measure delegation.
