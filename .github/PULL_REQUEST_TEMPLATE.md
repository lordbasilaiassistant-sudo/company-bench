## What this changes

<!-- One or two sentences. -->

## If this adds or edits a chair

- [ ] `node bench/selftest.mjs` passes
- [ ] It has a `gold` that scores 100% and a `decoy` that does not
- [ ] It has at least one check labelled `TRAP` — an attractive wrong answer, not a checklist item
- [ ] The correct answer is defensible **from the prompt alone**, by someone who never saw the scorer
- [ ] Tested against at least two models of genuinely different capability, scores below

| Model | Score on the new/edited chair |
|---|---|
|  |  |
|  |  |

> If every model scored 100%, the chair is dead weight and should be hardened before merging.

## If this edits an existing chair

- [ ] Stated below what the old chair failed to measure and what this catches
- [ ] Ran `node bench/rescore.mjs` so committed results reflect the change

## If this submits a result

- [ ] Temperature 0, prompts exactly as committed, or the label says otherwise
- [ ] No chair errored
- [ ] Includes `results/<id>.json` with the raw output intact
