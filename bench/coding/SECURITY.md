# Experimental trusted-local coding track

This track executes submitted JavaScript and Python with the current user's OS permissions.
It is disabled by default. `--allow-unsafe-execution` explicitly enables it, including recovery
runs. The library requires `{ allowUnsafeExecution: true }`. Review the code first and use a
disposable environment with no credentials or valuable files. Do not run public submissions
on a personal machine or expose this runner as a service.

The subprocess is **not a sandbox**. It retains filesystem and network access. A reduced
environment, output limits and a direct-child timeout reduce accidental exposure and runaway
output; they do not constrain descendants, filesystem access or malicious code.

The grader rejects missing/duplicate result lines, wrong check names/counts/types, failed
exits and timeouts. These are protocol correctness checks, **not a security boundary**.
Candidate code shares an interpreter with the test harness and can inspect or modify it.
A deliberate full-manifest forgery or shared-scope tampering can still invalidate scores.
The tests are published in the repository, so they are not secret held-out evaluations.

Use these scores only as local correctness diagnostics for non-adversarial code. They do not
establish agent trust, safety, general capability or an independently verified leaderboard.
Checked-in selftests verify known references and negative controls using the production grader;
they do not establish benchmark validity. A public adversarial track needs a separate isolated
execution service with assertions and scoring outside the candidate's trust domain.
