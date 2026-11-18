# Explaining ECHO in a software engineering interview

## 60-second project pitch

"I built ECHO, an API behavior lab that infers finite-state machines without reading the implementation. Each oracle query replays a symbolic action sequence in a clean sandbox; a bounded learner groups histories by distinguishing continuation outputs. It then searches for a counterexample, persists the model and failing trace in PostgreSQL, and visualizes everything in React. I built asynchronous job handling, cancellation, an explicit query budget, two reference targets, a fixed-contract external adapter, tests and CI. The key design tradeoff is bounded observational equivalence instead of claiming formal proof."

## Evidence you can show

- Rate limiter: 4 inferred states, 8 transitions, an eight-request counterexample (`denied` vs. `cooldown`).
- Authentication flow: 5 inferred states, 20 transitions, no discrepancy in 340 default verification sequences.
- The engine uses `TraceOracle`; implementations live behind HTTP and cannot be imported into the learner.
- Tests include pure inference, invalid observations, sandbox isolation, input validation, real HTTP inference, and optional PostgreSQL persistence; CI provisions PostgreSQL and executes a real smoke run.

**Only claim the metrics after running the commands in README successfully.** These are deterministic expected outcomes, not performance benchmarks.

## Thoughtful tradeoffs

1. **One background worker vs. distributed queue:** simple, predictable, but cannot survive server process restarts mid-run; jobs are marked failed on startup rather than silently retried.
2. **JSON report vs. normalized transitions:** fast iteration and simple retrieval, but harder to query individual edges in SQL.
3. **Bounded fingerprints vs. full active L*:** understandable and constrained, but can merge genuinely different hidden states; counterexample search probes that assumption.
4. **Fixed external URL vs. arbitrary URL entry:** less convenient, but prevents user-triggered SSRF in the API.
5. **One response per action and session resets:** guarantees meaningful Mealy traces for deterministic software; does not handle distributed/nondeterministic targets yet.

## Reasonable next steps (not implemented)

- Learn a distinguishing suffix from discovered counterexamples and rebuild the model (CEGAR-style refinement).
- Add explicit nondeterministic sampling and confidence intervals for probabilistic systems.
- Add job leases, per-target budgets and metrics when there are multiple workers.
- Add authentication, tenancy and isolated network egress before deploying publicly.

## What not to claim

- That ECHO uses an LLM (it does not).
- That the learner is a formal full implementation of L* (it is not).
- That "no mismatch found" proves the target is bug-free.
- That the local Docker demo is internet-safe or horizontally scalable.
