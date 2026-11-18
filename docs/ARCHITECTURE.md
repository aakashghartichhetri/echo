# System design: ECHO

## One-sentence explanation

ECHO approximates an unknown deterministic Mealy state machine from a documented HTTP trace interface, then tries to falsify the model using bounded exhaustive sequences.

## Components and dependency direction

```text
React UI (:3001, Express static files)
   |
   v
Express REST API -----> PostgreSQL (Prisma)
   |                        ^
   v                        |
RunManager (single async worker) ---- save report/status
   |
   v
Black-box learner -> HTTP Trace Oracle -> POST /api/v1/sandbox/execute
                                             |
                                             v
                                        Target implementation
                                             |
                                             v
                                      outputs per action
```

The learner imports only the `TraceOracle` interface and the alphabet from the target descriptor. It does not import `sandbox/targets.ts`. That separation matters: the model is inferred from observations, not derived from internal state or source code.

## Trace contract and resets

Every query sends `{ "targetId": "rate-limiter", "actions": ["request", "tick"] }` and expects `{ "outputs": ["allowed", "window-reset"] }`. Each trace executes in a new isolated target instance. A Mealy machine needs deterministic output for each `(state, action)`; clean starts avoid accidental hidden dependencies between queries. Production adapters for nondeterministic services would need probabilistic sampling and controlled fixture resets.

## State learning

Given an input alphabet A, a prefix (history) h and a set of distinguishing suffixes S, calculate a fingerprint:

`F(h) = [outputs(h + s) after skipping outputs(h), for s in S]`

ECHO starts with the empty prefix and explores outgoing actions. A new fingerprint becomes a new state with a representative access sequence. An existing fingerprint reuses its known state. When an unseen state would require a prefix longer than the configured access depth, ECHO fails clearly with `NOT_CLOSED` rather than quietly creating an incomplete machine. Every state has one transition for every action.

This is **bounded observational-equivalence learning**, not full formal active L*. Two states may still be erroneously merged if the chosen suffix depth cannot distinguish them. That is why verification probes longer traces.

## Verification and findings

ECHO exhaustively enumerates sequences in BFS order up to `verifyDepth`, within the query budget. It predicts the outputs using its candidate machine and compares those predictions to the black box. On mismatch, it stores only the failing prefix ending at the first divergent output. The first mismatch visited in BFS order is shortest within the checked search space. The default built-in rate limiter intentionally violates its documented contract after eight consecutive requests.

A difference from the model is evidence of an inaccurate model. It becomes evidence of a **bug** only if it also conflicts with the documented contract. ECHO makes this distinction in its report.

## Why a single worker?

One asynchronous exploration worker per process gives predictable concurrency and avoids unintended load on external targets. Jobs are persisted as `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, or `CANCELLED`. The job queue and AbortControllers live in process memory; a restart marks interrupted work failed. This is appropriate for a single-instance portfolio lab, not for horizontally scaled deployments. A future design could add a database-backed lease queue and one worker process per lease.

## Complexity and budgets

The number of verification sequences at alphabet size `k` and depth `d` is `sum(k^i, i=1..d)`. For two actions at depth eight, that's 510 potential sequences. For four actions at depth four, that's 340. Fingerprinting may require `sum(k^i, i=1..suffixDepth)` additional oracle traces per candidate history, subject to caching. Caps prevent accidental combinatorial explosion: 2–5 actions, access depth 2–6, suffix depth 1–4, verification depth 1–9, maximum 20,000 distinct queries. Users should start with defaults.

## Data model and migrations

One `Run` row stores the request configuration and the final JSON report. Summary counters are separate indexed fields for fast history rendering; JSON preserves detailed transitions and traces without extra relational join tables. This is a deliberate tradeoff: model analysis via SQL is harder, but the schema is small and the domain is experiment/report oriented.

## Reliability, security and scope

- Per-request JSON size/shape checks using Zod; unknown action rejection; safe error messages; body cap; security headers.
- Query budget, finite-length traces, 5-second per-query timeout, 10 pending jobs maximum, one worker, abort support.
- API clients cannot supply arbitrary network URLs. Operators may opt into one external endpoint via environment variables (trusted operator only).
- Docker binds the app to `127.0.0.1`; database is not published to the host.
- No credentials, personal data, payment data, or actual authentication tokens in test scenarios.
- No user login, roles, request auditing, network egress isolation, or per-tenant access controls. **Do not publicly deploy this demo as-is.** A malicious operator-configured remote target can return invalid traces or be slow.

## Interview discussion prompts

- Why are fingerprints an approximation of state equivalence?
- Which training depth or suffixes uncover the hidden rate-limiter mode?
- When does BFS guarantee a shortest counterexample and when does it not?
- How do query budgets trade coverage for cost?
- How would the architecture change for rate-limited external APIs, nondeterministic responses, and process restarts?
- How would you scale discovery safely: distributed leases, idempotent jobs, bounded concurrency, backpressure, and observability?
