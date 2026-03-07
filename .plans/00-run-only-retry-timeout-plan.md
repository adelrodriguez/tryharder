# Run-Only Retry/Timeout Plan

## Goal

Restrict `retry()` and `timeout()` to `run()` and `runSync()` only.

Keep orchestration APIs focused on coordination:

- `all()`
- `allSettled()`
- `flow()`

Those orchestration APIs should still support `signal()` so a whole graph can be cancelled together, but they should stop participating in top-level retry and timeout policy.

## Target API Model

Execution policy for leaf work:

- `try$.retry(...).run(...)`
- `try$.retry(...).runSync(...)`
- `try$.timeout(...).run(...)`
- `try$.timeout(...).runSync(...)`
- `try$.retry(...).timeout(...).signal(...).run(...)`

Coordination for orchestration:

- `try$.signal(signal).all(...)`
- `try$.signal(signal).allSettled(...)`
- `try$.signal(signal).flow(...)`
- `try$.wrap(...).all(...)`
- `try$.wrap(...).allSettled(...)`
- `try$.wrap(...).flow(...)`

Invalid combinations after the change:

- `try$.retry(3).all(...)`
- `try$.retry(3).allSettled(...)`
- `try$.retry(3).flow(...)`
- `try$.timeout(1000).all(...)`
- `try$.timeout(1000).allSettled(...)`
- `try$.timeout(1000).flow(...)`
- any `retry().timeout()` chain that ends in orchestration instead of `run()` / `runSync()`

## Why This Simplifies The Library

- `run()` and `runSync()` execute one unit of work, so retry and timeout semantics are obvious.
- `all()`, `allSettled()`, and `flow()` already have their own orchestration semantics: dependency resolution, sibling cancellation, partial results, early exit, and catch mapping.
- Stacking top-level retry and timeout on orchestration adds a second policy layer on top of graph behavior, which is where much of the current complexity comes from.
- `signal()` still belongs at the orchestration layer because cancellation across a whole graph is a coordination concern, not a leaf execution concern.

## Implementation Plan

### 1. Narrow the builder surface

Update `RunBuilder` so `retry()` and `timeout()` return a builder shape that no longer exposes orchestration methods:

- omit `all`
- omit `allSettled`
- omit `flow`

Preserve current `runSync()` gating:

- `retry(number)` can still expose `runSync()`
- async-only retry policies should still remove `runSync()`
- `timeout()` should still remove `runSync()`

`signal()` should continue to expose both execution and orchestration methods.

## 2. Remove retry/timeout behavior from orchestration executors

Refactor:

- `src/lib/executors/all.ts`
- `src/lib/executors/all-settled.ts`
- `src/lib/executors/flow.ts`

Specifically remove orchestration-level use of:

- `buildRetryDecision(...)`
- `waitForRetryDelay(...)`
- `RetryExhaustedError` paths caused by orchestration retries
- timeout-control branches that only exist because orchestration participates in top-level timeout

Keep:

- external cancellation via `signal()`
- internal sibling cancellation where orchestration already uses it
- wrap behavior if we still want outer instrumentation around orchestration

## 3. Simplify shared execution infrastructure

After orchestration no longer uses retry/timeout, reassess `BaseExecution`:

- identify which retry/timeout helpers are now only needed by `run()` / `runSync()`
- decide whether to keep them on `BaseExecution` or move more of that logic into the run executors
- keep `signal()` support available where still shared

This step should be driven by the code left after step 2, not by pre-emptive abstraction changes.

## 4. Update types and tests

### Type tests

Update `src/__tests__/types.test.ts` to assert that retry/timeout builders do not expose:

- `all`
- `allSettled`
- `flow`

Keep existing assertions for:

- `retry(number)` preserving `runSync()`
- object retry policies removing `runSync()`
- `signal()` still exposing orchestration methods

### Runtime tests

Remove or rewrite tests that currently assume orchestration-level retry or timeout support, especially in:

- `src/__tests__/index.test.ts`
- `src/lib/executors/__tests__/all.test.ts`
- `src/lib/executors/__tests__/all-settled.test.ts`
- `src/lib/executors/__tests__/flow.test.ts`

Replace them with tests that express the new model:

- orchestration supports `signal()`
- orchestration still supports wraps if intended
- retry/timeout behavior is exercised through nested `run()` calls inside tasks when needed

## 5. Review public API and docs

Update any examples, docs, or plans that still show:

- `timeout(...).all(...)`
- `timeout(...).flow(...)`
- orchestration-level retries

This includes checking:

- root entrypoint examples
- README or docs if present
- `.plans/07-api-proposal.md`

## Expected Cleanup Opportunities

If this change goes through, these are likely follow-up simplifications:

- less control-error branching in orchestration executors
- fewer “timeout during catch during retry” edge cases outside `run()`
- smaller orchestration test matrix
- a sharper conceptual split between “execute one thing” and “coordinate many things”

## Risks

- This is a breaking API change, even in v0.
- Some current users may rely on whole-graph retry/timeout behavior.
- Some tests may reveal hidden coupling between orchestration executors and `BaseExecution` retry/timeout helpers.

## Decision Constraints

- Keep `signal()` available for orchestration.
- Do not reintroduce hidden no-op builder methods. If a chain should not support an operation, remove it from the type surface.
- Prefer deleting orchestration retry/timeout behavior rather than preserving it behind internal flags.

## Suggested Execution Order

1. Narrow builder return types for `retry()` and `timeout()`.
2. Update type tests first so the public API change is explicit.
3. Remove orchestration retry/timeout behavior from `all()`.
4. Remove orchestration retry/timeout behavior from `allSettled()`.
5. Remove orchestration retry/timeout behavior from `flow()`.
6. Simplify shared infrastructure only after the orchestration executors compile in the new shape.
7. Clean up docs and examples.

## Done Criteria

This plan is complete when:

- `retry()` and `timeout()` only compose with `run()` / `runSync()`
- orchestration methods are still available after `signal()`
- orchestration methods are no longer available after `retry()` or `timeout()`
- orchestration executors no longer implement top-level retry/timeout behavior
- the full validation suite passes:
  - `bun run format`
  - `bun run check`
  - `bun run typecheck`
  - `bun run test`
  - `bun run build`
