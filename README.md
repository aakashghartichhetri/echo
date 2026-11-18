# ECHO — Black-Box Behavior Lab

A full-stack application that automatically explores API behavior, learns finite-state-machine models, and detects inconsistencies without access to the underlying source code.

## Overview

ECHO uses black-box testing and state-machine inference to understand how software responds to different inputs. It generates test sequences, predicts expected behavior, and identifies unexpected responses.

The system includes a REST API, an interactive dashboard, persistent experiment history, and automated testing.

## Tech Stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL, Prisma ORM
- **Testing:** Vitest
- **Infrastructure:** Docker, GitHub Actions

## Key Features

- **Black-Box Exploration:** Automatically tests APIs through observable inputs and outputs.
- **State-Machine Learning:** Infers behavioral models and visualizes state transitions.
- **Counterexample Detection:** Identifies execution sequences that contradict learned models.
- **Experiment Management:** Supports asynchronous runs, cancellation, and persistent history.
- **Interactive Dashboard:** Visualizes models, metrics, test results, and failing sequences.

## Getting Started

**Prerequisite:** Docker Desktop with Docker Compose.

```bash
# Start the application
docker compose up --build
```

Open [**http://localhost:3001**](http://localhost:3001) to access the dashboard.

## Testing

```bash
# Run automated tests
docker compose exec app npm test

# Run end-to-end smoke checks
docker compose exec app npm run smoke

# Stop services
docker compose down
```

## Reference Systems

| System         | Test Scenario                                                 |
| -------------- | ------------------------------------------------------------- |
| Rate Limiter   | Detects an undocumented response after repeated API requests. |
| Authentication | Learns login, validation, and logout state transitions.       |

Both systems use deterministic, simulated behavior for repeatable testing.

## Architecture

```text
apps/
├── api/
│   ├── src/       # API, inference engine, jobs
│   ├── prisma/    # Schema and migrations
│   └── test/      # Backend tests
└── web/
    └── src/       # React dashboard

docs/              # Architecture and API documentation
examples/          # External API adapter
scripts/           # Verification utilities
```

## Engineering Considerations

- Isolates test sessions to ensure reproducible results.
- Uses bounded exploration to control execution costs.
- Persists experiments for debugging and analysis.
- Separates the learning engine from target implementations.
- Provides automated CI checks for code quality and correctness.

**Limitations:** Inferred models are approximations, not formal correctness proofs. The application is intended for local development and requires additional security controls before public deployment. Full Docker and integration testing remain pending verification.
