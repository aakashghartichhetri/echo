#!/usr/bin/env node
// Runs against the actual containerized API and database, not mocks.
import assert from 'node:assert/strict';
const base = process.env.ECHO_API_URL ?? 'http://127.0.0.1:3001';

async function call(path, options = {}) {
  const response = await fetch(`${base}/api/v1${path}`, {
    ...options,
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}
async function verifyTarget(targetId, expectedStates, expectedFindings) {
  const created = await call('/runs', { method: 'POST', body: JSON.stringify({ targetId }) });
  assert.equal(created.status, 'QUEUED');
  for (let i = 0; i < 60; i++) {
    const run = await call(`/runs/${created.id}`);
    if (run.status === 'FAILED' || run.status === 'CANCELLED') throw new Error(`Run ${targetId} stopped: ${run.error}`);
    if (run.status === 'COMPLETED') {
      assert.equal(run.report.machine.states.length, expectedStates);
      assert.equal(run.report.findings.length, expectedFindings);
      if (targetId === 'rate-limiter') assert.equal(run.report.findings[0].observed[7], 'cooldown');
      console.log(`PASS ${targetId}: ${expectedStates} states, ${expectedFindings} findings, ${run.report.uniqueQueries} HTTP queries`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${targetId}`);
}

try {
  assert.equal((await call('/health/ready')).status, 'ready');
  const targets = await call('/targets');
  assert.ok(targets.some((target) => target.id === 'rate-limiter'));
  await verifyTarget('rate-limiter', 4, 1);
  await verifyTarget('authentication', 5, 0);
  console.log('All ECHO end-to-end smoke checks passed');
} catch (error) { console.error('Smoke check FAILED:', error); process.exitCode = 1; }
