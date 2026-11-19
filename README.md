# ECHO - API Behavior Lab

**Explore, model, and compare API behavior without access to source code.**

ECHO is a web-based platform for black-box API testing and state-machine learning. It executes sequences of API actions, observes responses, infers approximate behavioral models, and identifies discrepancies between predicted and actual behavior.

The platform provides an interactive workspace to analyze API behavior, investigate counterexamples, and compare results across releases.

## Dashboard

*Interactive dashboard for exploring API behavior, inspecting learned models, and managing experiments.*

## Why ECHO?

APIs often maintain hidden internal state, making their behavior difficult to understand through individual requests.

ECHO addresses this by systematically exploring action sequences and reconstructing observable behavior as an approximate state machine. This helps developers understand state transitions, identify unexpected responses, and detect behavioral regressions.

## Key Features

- **Black-box testing** - Explore APIs without accessing their implementation.
- **State-machine inference** — Generate behavioral models from observed action sequences.
- **Counterexample detection** — Identify mismatches between learned models and actual responses.
- **Release comparison** — Compare saved experiments to detect behavioral changes.
- **Experiment management** — View, search, export, and manage reports.
- **Built-in test APIs** — Explore rate-limiter and authentication behavior.

## Tech Stack

| Layer          | Technologies                  |
| -------------- | ----------------------------- |
| Frontend       | React, TypeScript             |
| Backend        | Node.js, Express, Zod         |
| Database       | PostgreSQL, Prisma            |
| Testing        | Vitest                        |
| Infrastructure | Docker, GitHub Actions, Caddy |

## Getting Started

**Prerequisites:** Git and Docker Desktop with Docker Compose.

**1. Clone the repository**

```bash
git clone <REPOSITORY_URL>
cd <REPOSITORY_DIRECTORY>
```

**2. Start the application**

```bash
docker compose up -d --build
```

**3. Open the dashboard**

Visit [**http://localhost:3001**](http://localhost:3001)

Local mode includes a demo workspace and sample reports. No authentication, API keys, or `.env` configuration are required.

**4. Run tests (optional)**

```bash
docker compose exec app npm test
docker compose exec app npm run smoke
```

**5. Stop the application**

```bash
docker compose down
```

Local database data is preserved across restarts.

## How It Works

```text
Select API
    ↓
Execute Action Sequences
    ↓
Observe Responses
    ↓
Infer State Machine
    ↓
Detect Counterexamples
    ↓
Save & Compare Results
```

ECHO performs bounded experiments against predefined test APIs. Learned models approximate observable behavior and do not guarantee complete API correctness.

## Project Structure

```text
apps/
  api/             Backend, inference engine, tests
  web/             Dashboard and experiment management
scripts/           Utilities and smoke tests
.github/workflows/ CI/CD pipelines
docker-compose.yml Local development environment
```

## License

MIT License.

