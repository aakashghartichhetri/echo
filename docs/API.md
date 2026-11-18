# REST API guide

Base URL: `http://localhost:3001/api/v1`

Requests and successful responses use JSON. Invalid requests return `{ "error": "..." }` with 400/404/409/429 as appropriate. All target actions are symbolic names; no password or token is ever sent by the built-in examples.

## Health and discovery

```bash
curl http://localhost:3001/api/v1/health/live
curl http://localhost:3001/api/v1/health/ready
curl http://localhost:3001/api/v1/targets
```

`GET /targets` gives `id`, `name`, `summary`, `contract`, `actions`, and `expectedAnomaly` (true/false/null).

## Execute an isolated trace

```bash
curl -sS -X POST http://localhost:3001/api/v1/sandbox/execute \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"rate-limiter","actions":["request","request","request","request"]}'
```

Expected:

```json
{"outputs":["allowed","allowed","allowed","denied"]}
```

All traces start from fresh state; maximum 12 actions. Only built-in targets are supported by this endpoint. Use the external target configuration to probe an operator-managed remote trace endpoint.

## Stateful sandbox sessions (for manual experiments)

```bash
# Create a session
curl -sS -X POST http://localhost:3001/api/v1/sandbox/sessions \
  -H 'Content-Type: application/json' -d '{"targetId":"authentication"}'
# Save sessionId from the result. Then step the session:
curl -sS -X POST http://localhost:3001/api/v1/sandbox/sessions/SESSION_ID/actions \
  -H 'Content-Type: application/json' -d '{"action":"begin"}'
# Delete when done:
curl -X DELETE http://localhost:3001/api/v1/sandbox/sessions/SESSION_ID
```

Sessions expire after 10 minutes of inactivity; maximum 100 live sessions.

## Explore, poll, cancel and delete a run

```bash
curl -sS -X POST http://localhost:3001/api/v1/runs \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"rate-limiter"}'
```

Returns **202** with `{ "id": "<uuid>", "status": "QUEUED" }`.

```bash
curl http://localhost:3001/api/v1/runs?limit=25
curl http://localhost:3001/api/v1/runs/RUN_ID
curl -X POST http://localhost:3001/api/v1/runs/RUN_ID/cancel
curl -X DELETE http://localhost:3001/api/v1/runs/RUN_ID
```

`GET /runs/:id` includes the saved analysis report once completed. You may override every exploration setting:

```json
{
  "targetId":"rate-limiter",
  "settings":{
    "accessDepth":3,
    "suffixDepth":3,
    "verifyDepth":8,
    "queryLimit":2500,
    "findingLimit":1
  }
}
```

## External trace endpoint

Set `ECHO_EXTERNAL_URL` to an **operator-approved** HTTP(S) endpoint and `ECHO_EXTERNAL_ACTIONS` to 2–5 unique action labels. ECHO sends the same `POST` JSON shape as above with `targetId:"external"` and expects `{ "outputs": ["string", ...] }` (exactly one string output per action, maximum 100 characters each). Your external endpoint must reset its logical state for every trace. Only the server operator can set the URL; API callers cannot supply URLs.

Example adapter for an unknown program: write a separate HTTP wrapper that accepts traces, starts a fresh process/transaction/sandbox for each trace, applies actions sequentially, maps responses to stable symbolic labels, and returns the outputs array. Do not point this configuration at production services.

### Working external example (native development)

In a separate terminal, run `node examples/external-counter.mjs` to start a small two-slot counter at `127.0.0.1:3999`. Before starting the API server, export:

```bash
export ECHO_EXTERNAL_URL=http://127.0.0.1:3999/trace
export ECHO_EXTERNAL_ACTIONS=push,pop
npm run dev:api
```

The dashboard will show **Configured external API** with `push` and `pop` actions. Its inference uses exactly the same HTTP `TraceOracle` as the built-in targets; no changes to the core learner are needed. The example is intentionally tiny, so you can replace its implementation with a wrapper around any sandboxed deterministic program that follows the same trace contract. To call a host process from Docker, you must configure a network-reachable hostname explicitly; `127.0.0.1` inside Docker refers to the container itself.
