import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('Expected path to compiled core');
const { analyze } = await import(pathToFileURL(path.join(root, 'engine/learner.js')));
const { compareReports } = await import(pathToFileURL(path.join(root, 'engine/compare.js')));
const { BUILTIN_TARGETS, executeTrace } = await import(pathToFileURL(path.join(root, 'sandbox/targets.js')));
const { DEFAULTS } = await import(pathToFileURL(path.join(root, 'service/defaults.js')));
for (const target of BUILTIN_TARGETS) {
  const report = await analyze(target, { trace: async (actions) => executeTrace(target.id, actions) }, DEFAULTS[target.id]);
  if (target.id === 'rate-limiter') {
    assert.equal(report.machine.states.length, 4);
    assert.equal(report.machine.transitions.length, 8);
    assert.deepEqual(report.findings[0].actions, Array(8).fill('request'));
    assert.equal(report.findings[0].observed[7], 'cooldown');
  } else {
    assert.equal(report.machine.states.length, 5);
    assert.equal(report.machine.transitions.length, 20);
    assert.equal(report.findings.length, 0);
  }
  console.log(`PASS core ${target.id}: ${report.machine.states.length} states, ${report.machine.transitions.length} transitions, ${report.findings.length} findings, ${report.checkedTraces} checked traces`);
}

const rateTarget = BUILTIN_TARGETS.find((item) => item.id === 'rate-limiter');
const reference = await analyze(rateTarget, { trace: async (actions) => executeTrace('rate-limiter', actions, 'reference') }, DEFAULTS['rate-limiter']);
const patched = await analyze(rateTarget, { trace: async (actions) => executeTrace('rate-limiter', actions, 'patched') }, DEFAULTS['rate-limiter']);
const comparison = compareReports('before', reference, 'after', patched);
assert.equal(comparison.modelDifference, null, 'The candidate state machines should match');
assert.deepEqual(comparison.observedDifference?.actions, Array(8).fill('request'));
assert.equal(comparison.observedDifference?.baseline[7], 'cooldown');
assert.equal(comparison.observedDifference?.candidate[7], 'denied');
console.log(`PASS release comparison: saved HTTP observations reveal the eighth-request change (${comparison.comparedSamples} shared samples)`);
