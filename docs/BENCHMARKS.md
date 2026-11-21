# Reproducible core benchmark

These are measured **in-memory algorithm timings**, not HTTP latency, request throughput, database performance, browser rendering, or multi-user capacity.

Run `npm run benchmark:core` from the repository root. The script compiles only the dependency-free learning engine with `tsc`, warms up each reference target three times, and performs 30 measured explorations. It prints min/max, p50 and p95 wall-clock times, full-process peak RSS, and the number of unique oracle queries/traces per exploration. It makes no network or database requests.

## Measurement recorded in the review environment

- Runtime: Node.js v22.16.0, Linux, AMD EPYC 9V74 virtual CPU.
- Repetitions: 30 per target after 3 warmups.
- Rate limiter: **p50 1.26 ms**, **p95 1.85 ms**, 255 unique queries and 255 verification traces per run.
- Authentication: **p50 1.51 ms**, **p95 2.53 ms**, 532 unique queries and 340 verification traces per run.
- Peak observed process RSS during each series: 37.8 MiB (rate limiter), 43.3 MiB (authentication). This is whole-process memory, **not incremental memory per experiment**.

No production concurrency or resource-saturation benchmark was run. The live API does at least one HTTP request per unique trace, so end-to-end latency will be much higher. A real capacity test should measure p50/p95 completion time, concurrent users, CPU, memory, PostgreSQL connections, queue length, timeouts, and failure rate on the intended deployment profile.

The algorithm's depth and alphabet size are critical workload inputs; different settings can change query counts exponentially. Do not extrapolate the numbers above to arbitrary real APIs.

## Additional local measurement — 2026-11-21

Repeated 30 in-memory runs of the unchanged core on Node.js 22.16.0, AMD EPYC 9V74 CPU, with no network or database:

| Target | Median | P95 | Peak process RSS | Queries/run |
|---|---:|---:|---:|---:|
| Rate limiter | 1.03 ms | 7.07 ms | 38.0 MiB | 255 |
| Authentication | 1.45 ms | 2.22 ms | 44.5 MiB | 532 |

Executed with `npm run benchmark:core`. These timings do **not** measure production API latency, throughput, TLS, multi-user concurrency or recovery time.
