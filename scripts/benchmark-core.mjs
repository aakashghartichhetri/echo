import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = process.argv[2];
if (!root) throw new Error('Expected compiled core directory');
const { analyze } = await import(pathToFileURL(path.join(root, 'engine/learner.js')));
const { BUILTIN_TARGETS, executeTrace } = await import(pathToFileURL(path.join(root, 'sandbox/targets.js')));
const { DEFAULTS } = await import(pathToFileURL(path.join(root, 'service/defaults.js')));
const RUNS = 30;
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

console.log(JSON.stringify({
  kind: 'in-process core only', node: process.version, cpu: os.cpus()[0]?.model,
  iterations: RUNS, network: false, database: false,
}));
for (const target of BUILTIN_TARGETS) {
  const oracle = { trace: async (actions) => executeTrace(target.id, actions) };
  for (let i = 0; i < 3; i++) await analyze(target, oracle, DEFAULTS[target.id]);
  const times = [];
  let peakRss = 0;
  let report;
  for (let i = 0; i < RUNS; i++) {
    const begin = performance.now();
    report = await analyze(target, oracle, DEFAULTS[target.id]);
    times.push(performance.now() - begin);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  console.log(JSON.stringify({
    target: target.id, p50Ms: Number(percentile(times, 0.5).toFixed(2)),
    p95Ms: Number(percentile(times, 0.95).toFixed(2)),
    minMs: Number(Math.min(...times).toFixed(2)),
    maxMs: Number(Math.max(...times).toFixed(2)),
    peakProcessRssMiB: Number((peakRss / 1024 / 1024).toFixed(1)),
    queriesPerRun: report.uniqueQueries, checkedTracesPerRun: report.checkedTraces,
  }));
}
