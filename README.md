# ECHO

**Explore how a stateful API behaves, keep the evidence, and compare changes between releases.**

ECHO is a workspace for black-box API experiments. Instead of reading an implementation, it sends sequences of documented actions to a resettable test interface. It groups histories with similar observed futures into a candidate state machine, checks longer sequences against that model, and saves the shortest mismatches it finds. Teams can compare two saved runs before and after a change to spot behavior that may break a client.

ECHO currently supports two built-in example APIs: a rate limiter and a small authentication flow. The rate limiter deliberately returns an unexpected result on its eighth request. This is a repeatable demonstration of model disagreement, **not** a claim that ECHO can discover every bug.

## What you can do

- **Explore APIs:** Launch bounded experiments without access to their source code.
- **Inspect states:** Read the learned transitions alongside exact input and output sequences.
- **Investigate disagreements:** See the first trace where a prediction differs from an observation.
- **Check releases:** Compare saved models and actual trace evidence without reprobing the target.
- **Manage work:** Cancel experiments, browse reports, download JSON evidence, and delete saved runs.
- **Keep accounts separate:** Hosted users sign in with GitHub and see only their own reports.

## How the system fits together

```text
React + TypeScript workspace
          |
    Express REST API ---- GitHub OAuth / sessions / CSRF
          |
    Run manager (one worker) ---- PostgreSQL + Prisma
          |
   Bounded inference engine
          |
   HTTP oracle (fresh state per trace)
          |
   Built-in sandbox targets
```

**Stack:** Node.js 24, TypeScript, Express, Zod, React, Vite, PostgreSQL, Prisma, Vitest, Docker Compose, GitHub Actions, and Caddy for hosted HTTPS.

## Run it locally

Install Docker Desktop with Compose. The source ZIP contains the app directly (no separate `source` or `patches` folder). Its startup script restores the pinned lockfile if it is missing. From the extracted project folder, run:

```bash
./start.sh
```

Open **http://localhost:3001**. Run `./verify-local.sh` to check the application after it starts. Local mode uses a demo account and a PostgreSQL container; no OAuth credentials are required. The first start applies migrations and creates sample reports. Stop the app with `docker compose down`, which keeps your saved data. Avoid `down -v` unless you intend to delete the database volume.

## Verify changes

Run `./verify-local.sh`, or execute checks individually:

```bash
docker compose exec app npm run lint
docker compose exec app npm run typecheck
docker compose exec app npm test
docker compose exec -e RUN_DB_TESTS=1 app npm run test -w @echo/api
docker compose exec app npm run smoke
node --test scripts/operations.test.mjs
```

CI additionally audits production dependencies, builds the React and API bundles, and builds the Docker image. The source-hygiene check catches merge markers and malformed file endings; TypeScript and Vitest provide the deeper checks. Docker and CI install the committed npm lockfile with `npm ci`.

A separate, dependency-free check (`npm run test:core`) verifies the learning examples. Run `npm run benchmark:core` for repeatable in-process timing measurements. See [benchmarks](docs/BENCHMARKS.md) for the measured environment and why those times are **not** HTTP throughput or SaaS capacity results.

## Engineering and security decisions

ECHO deliberately performs **bounded observational learning**, not formal verification. Each trace starts in a fresh state, queries are cached within a run, and the budget stops exploration before costs grow indefinitely. A mismatch is evidence to investigate against the API contract, not proof of a defect.

Hosted mode requires HTTPS and GitHub OAuth. Sessions use random, hashed database tokens and secure cookies; modifying requests require a session-bound CSRF token and matching origin. Report access is scoped by account. A running job can be cancelled without allowing a late result to overwrite that decision. The outbound HTTP client pins checked DNS answers, refuses redirects and private network addresses by default, limits response size, and enforces a timeout. Public users cannot submit arbitrary target URLs.

## Limits and deployment

The app runs **one worker per instance** with finite queue, daily, storage, and query limits. In-memory rate limiting is supplemental, not an internet-scale DDoS defense. Arbitrary API integrations, durable distributed scheduling, live progress metrics, and billing are not implemented. The built-in examples are the supported test targets for hosted accounts.

For hosted deployment, follow the [production runbook](docs/PRODUCTION.md) for GitHub OAuth, Caddy HTTPS, managed PostgreSQL, verified restore drills and go-live gates. The [architecture diagram](docs/architecture.svg) shows the actual deployment boundary. These live checks require your own infrastructure; a green local test does not prove public readiness. See the [architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT_MODEL.md), and [engineering review](docs/REVIEW.md) for remaining risks and decisions.

**License:** MIT. [Source and issue tracker](https://github.com/aakashghartichhetri/echo).

## Working from GitHub

For an existing checkout, create a feature branch, copy the reviewed source files into it without touching `.git`, run `./verify-local.sh`, then push and open a pull request. Do not publish a hosted service until the separate real OAuth, HTTPS, backup restoration and monitoring checks in `docs/PRODUCTION.md` pass.
