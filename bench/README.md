# Benchmarks

The benchmark suite tracks relative performance trends for `tryharder` without turning noisy microbenchmarks into a required PR gate.

## Commands

```bash
pnpm run bench
pnpm run bench:ci
```

`pnpm run bench` builds the package and prints human-readable `mitata` output.

`pnpm run bench:ci` builds the package, emits structured benchmark JSON, and writes these artifacts:

- `bench-results/latest.json`
- `bench-results/summary.md`

## Benchmark discipline

- Benchmarks import from the typed `src` entrypoint so `check` and `typecheck` do not depend on a prior `build`.
- Cases stay deterministic and timer-free. Do not use `sleep`, real timeout expiry, or cancellation races in this suite.
- Reuse task graphs and builder fixtures where setup can stay outside the measured loop.
- Route results through the shared sink in `bench/shared.ts` so the runtime cannot optimize work away.
- Run on the same Node.js version when comparing history. This repo declares the development version in `.node-version`.
- Treat results as trend signals. Do not infer product-level latency from these microbenchmarks.

## How to read these benchmarks

- Treat the suite as an overhead tracker for `tryharder`, not as an end-to-end application latency test.
- Compare like-for-like cases over time. The most useful regressions are usually `run/function/sync-success`, `runSync/function/success`, `run/object/mapped-error`, `all/two-independent-sync-tasks`, `allSettled/two-successful-tasks`, and `flow/immediate-exit`.
- Use the direct baselines to understand scale, but do not over-index on huge ratios against `baseline/direct-sync-call`. That case is so small that tiny absolute changes can create very large relative multipliers.
- Prefer absolute changes in `ns/iter` or `us/iter` when reading results. A `+200 ns` regression on a hot-path benchmark is usually more meaningful than a percentage quoted without context.
- Read policy benchmarks as incremental overhead on top of execution. `wrap/runSync/success`, `signal/runSync/success`, `timeout/run/success-no-expiry`, and `retry/runSync/succeeds-on-third-attempt` show the cost of enabling those features even when they do not fail. The async control cases `signal/run/async-success-no-abort`, `timeout/run/async-success-no-expiry`, and `signal-timeout/run/async-success-no-abort-no-expiry` are the cases to watch when evaluating `resolveWithAbort()` changes.
- Read orchestration benchmarks as framework cost for very small graphs. `all`, `allSettled`, and `flow` are expected to be much slower than `Promise.all` in these tiny cases because they are doing dependency tracking, cancellation wiring, and result shaping. Compare unused-feature cases with exercised-feature cases like `all/two-independent-sync-tasks-with-signal`, `all/two-independent-sync-tasks-with-disposer`, `allSettled/two-successful-tasks-with-disposer`, and `flow/two-node-dependency-then-exit` to see where fixed setup cost is going.
- Only compare history across runs that use the same Node.js version, machine class, and benchmark suite version. Cross-machine numbers are not reliable enough for regression calls.
