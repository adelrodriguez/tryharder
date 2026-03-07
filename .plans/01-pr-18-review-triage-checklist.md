# PR #18 Follow-up Execution Plan

Verified against the current workspace on 2026-03-07.

## Goal

Land the remaining correctness and public-type fixes from PR #18 in one
follow-up pass, while keeping refactors and cleanup work out of scope unless
the correctness changes make them effectively free.

## Recommended Scope

Ship in this pass:

- Step 1: top-level `runSync()` panic semantics
- Step 2: observational, read-only wrap semantics
- Step 3: strict `shouldRetry` runtime validation
- Step 4: `executeRun()` overload alignment
- Step 5: remove `Panic` from normal run result semantics
- Step 6: `GenResult` public type fix
- Step 7: shared executor test stabilization

Defer unless the earlier steps force nearby edits:

- Step 8: `FlowExecution` / `TaskExecution` refactor
- Step 9: resolver queue cleanup

## Working Rules

- Fix runtime behavior before widening or correcting public types.
- Add regression coverage before or with each behavior change.
- Keep the first pass local and explicit; do not extract new abstractions unless
  the implementation becomes harder to read without them.
- Re-run the full quality gates after each completed step.

## Execution Sequence

### Step 1 - Restore builder-backed `runSync()` panic semantics

Status:

- Completed on 2026-03-07.

Objective:

- Make builder-backed `try$.runSync(...)` rethrow thrown `Panic` values instead
  of returning them.

Current code paths:

- `src/index.ts`
- `src/lib/executors/run-sync.ts`

Implementation approach:

- Keep the root `runSync` export sourced from `RunBuilder`; the root namespace
  should continue exposing builder-backed functions instead of bypassing the
  builder.
- Treat the bug as an executor issue, not an index-surface issue: the builder
  path was swallowing thrown `Panic` values by treating them as returned
  control errors inside `executeRunSync()`.
- Fix `src/lib/executors/run-sync.ts` so user-thrown `Panic` values are
  rethrown from the sync failure path instead of being returned.
- Do not add a root-only adapter or alternate standalone binding for this
  behavior.
- Backward compatibility does not constrain this change because the project is
  still in v0; preserving incorrect panic behavior is not a goal.

Regression coverage:

- Extend `src/__tests__/index.test.ts` with root-level panic cases that prove
  the builder-backed export rethrows both direct and forwarded panics.
- Add direct executor coverage in
  `src/lib/executors/__tests__/run-sync.test.ts` so `executeRunSync()` itself
  is pinned to the corrected behavior.

Done when:

- Top-level `try$.runSync(...)` rethrows `Panic` instead of returning it.
- The root export remains builder-backed.
- Direct `executeRunSync()` behavior matches the builder-backed root export for
  thrown `Panic` values.

### Step 2 - Make wraps observational and context-read-only

Status:

- Completed on 2026-03-07 after re-scoping wrap semantics.

Objective:

- Make wrap hooks able to observe execution context without mutating or
  replacing it.

Current code paths:

- `src/lib/executors/base.ts`
- `src/lib/executors/run.ts`
- `src/lib/executors/run-sync.ts`
- `src/lib/types/builder.ts`
- orchestration executors that inherit from `BaseExecution`
- wrap-related tests in `src/__tests__` and `src/lib/executors/__tests__`

Implementation approach:

- Change the wrap contract from middleware-style `next(ctx)` to observational
  `next()` so wraps cannot pass a replacement context into execution.
- Make the wrap context type read-only, including nested retry metadata, so
  TypeScript rejects direct mutation in wrap implementations.
- Add a runtime guard around the wrap context so unsafe casts cannot mutate the
  live execution context.
- Keep terminal executors reading the internally owned execution context
  (`this.ctx`) rather than any wrap-provided value.

Regression coverage:

- Add type-level coverage proving wraps cannot assign to `ctx` or pass `ctx`
  into `next(...)`.
- Add runtime coverage proving wrap attempts to mutate context fail and do not
  affect execution state.
- Update existing wrap tests to the `next()` API shape.

Dependency note:

- Land this before Step 3 so retry validation and retry metadata continue to use
  a single internal execution context shape.

Done when:

- Wraps can observe retry metadata and signals, but cannot mutate or replace
  context.
- `BaseExecution` and the run executors continue using their internally owned
  context for execution and retry bookkeeping.
- The wrap API surface and tests consistently use `next()` instead of
  `next(ctx)`.

### Step 3 - Validate `retry.shouldRetry` runtime results strictly

Status:

- Completed on 2026-03-07.

Objective:

- Allow async `shouldRetry` for async runs while failing fast on invalid
  resolved values, while keeping `runSync()` limited to sync-safe retry policy
  shapes by rejecting delayed or jittered retry policies.

Current code paths:

- `src/lib/modifiers/retry.ts`
- `src/lib/executors/run.ts`
- `src/lib/executors/run-sync.ts`
- `src/lib/executors/__tests__/retry.test.ts`
- `src/lib/modifiers/__tests__/retry.test.ts`
- `src/__tests__/index.test.ts`
- `src/__tests__/types.test.ts`

Implementation approach:

- Keep the validation at the runtime decision point in
  `src/lib/modifiers/retry.ts`, because that is where the `shouldRetry` result
  is currently consumed.
- Add a dedicated `Panic` code for invalid `shouldRetry` return values.
- Allow `checkShouldAttemptRetry(...)` to return either a boolean or a promise
  of boolean so async execution can await `shouldRetry` without changing the
  builder surface.
- Validate resolved async `shouldRetry` values the same way as sync values:
  any non-boolean result panics with the framework error.
- Keep `runSync()` on the existing invariant model instead of splitting the
  public retry-policy types: direct sync execution rejects any retry config
  that includes `shouldRetry`, delay, or jitter with
  `RUN_SYNC_ASYNC_RETRY_POLICY`.

Regression coverage:

- Add modifier-level tests for async, thenable, and non-boolean `shouldRetry`
  results.
- Add executor-level retry tests that prove async `run()` awaits
  `shouldRetry`, invalid resolved values panic, and timeout still wins during
  async retry-decision evaluation.
- Add sync executor tests that prove any retry policy including `shouldRetry`
  trips the sync invariant.
- Add root-level and type-level coverage for async `shouldRetry` on the async
  retry builder.

Done when:

- Async `run()` may await `retry.shouldRetry`.
- Invalid `shouldRetry` results fail deterministically with a framework panic.
- `runSync()` rejects async-required retry policy shapes such as delayed or
  jittered retry, while leaving sync `shouldRetry` behavior on the existing
  runtime path.
- Retry exhaustion is no longer reachable through non-boolean coercion.

### Step 4 - Fix `executeRun()` object-form overloads

Status:

- Completed on 2026-03-07.

Objective:

- Align direct `executeRun()` typing with the values the runtime can return.

Current code paths:

- `src/lib/executors/run.ts`
- `src/__tests__/types.test.ts`

Implementation approach:

- Adjust the object-form overloads in `src/lib/executors/run.ts` so object-form
  callers see `Promise<T | E | RunnerError>`.
- Re-check whether the function-form overload should stay narrower for direct
  executor callers or whether it has the same mismatch; record that decision in
  the implementation.

Regression coverage:

- Add or update type assertions in `src/__tests__/types.test.ts` so object-form
  callers cannot silently regress back to `Promise<T | E>`.

Done when:

- The overload resolution for object-form `executeRun()` matches runtime
  behavior.

### Step 5 - Remove `Panic` from normal run result semantics

Objective:

- Ensure `Panic` remains an exceptional failure path instead of appearing in
  resolved async run result unions or control-error helpers.

Current code paths:

- `src/lib/executors/base.ts`
- `src/lib/executors/run.ts`
- `src/lib/utils.ts`
- `src/lib/executors/__tests__/run.test.ts`
- `src/lib/__tests__/utils.test.ts`
- `src/__tests__/index.test.ts`

Implementation approach:

- Remove `Panic` from the `RunnerError` alias in `src/lib/executors/base.ts`.
- Stop classifying `Panic` as a control error in `checkIsControlError(...)` so
  async run failure handling does not treat it like cancellation or timeout.
- Update async `executeRun()` failure handling in `src/lib/executors/run.ts`
  so user-thrown or forwarded `Panic` values are rethrown instead of being
  returned as resolved results, matching the sync executor behavior from
  Step 1.
- Keep catch-handler panics as exceptional rejections; this step is about
  making direct or forwarded `Panic` values behave consistently, not about
  converting thrown panics into mapped results.

Regression coverage:

- Add direct async executor tests proving function-form and object-form
  execution rethrow `Panic` values unchanged.
- Add root-level `try$.run(...)` coverage proving async entrypoints rethrow
  direct and forwarded `Panic` values.
- Update utility tests so `checkIsControlError(new Panic(...))` no longer
  returns `true`.

Done when:

- `RunnerError` no longer includes `Panic`.
- Async `executeRun()` and `try$.run(...)` rethrow direct and forwarded
  `Panic` values.
- `checkIsControlError(...)` only treats cancellation and timeout as control
  errors.

Dependency note:

- Land this before widening any additional public async result types so
  `Panic` does not leak into exported unions as a normal return case.

### Step 6 - Add `UnhandledException` to public `GenResult`

Objective:

- Make `gen()`'s exported type match the values that `driveGen()` already
  returns.

Current code paths:

- `src/lib/gen.ts`
- `src/__tests__/types.test.ts`

Implementation approach:

- Update `GenResult` so non-control thrown/rejected failures are represented as
  `UnhandledException`.
- Keep the existing control-error behavior unchanged.

Regression coverage:

- Add type tests for sync and async `gen()` paths that currently produce
  `UnhandledException`.
- Only add new runtime tests if the existing `gen` runtime coverage does not
  already exercise the relevant path.

Done when:

- Public `GenResult` includes `UnhandledException` in both sync and async
  variants where appropriate.

### Step 7 - Stabilize and simplify shared executor tests

Objective:

- Remove the last time-based assertion pattern and the remaining style-only
  noise from `shared.test.ts`.

Current code paths:

- `src/lib/executors/__tests__/shared.test.ts`

Implementation approach:

- Replace the fail-fast abort test's `sleep(...)` post-check with an explicit
  readiness barrier or abort-observed promise.
- Remove explicit local `Promise<...>` async return annotations where inference
  already produces the right type.
- Keep this step test-only; do not change executor behavior here unless the
  test rewrite exposes a real bug.

Done when:

- `shared.test.ts` no longer depends on timing to observe fail-fast abort.
- The file no longer carries unnecessary local async return annotations.

### Step 8 - Decide whether to keep `FlowExecution` / `TaskExecution` duplication

Status:

- Defer by default.

Decision rule:

- If Steps 1-7 do not require touching both implementations, leave the
  duplication alone for now.
- If nearby correctness work exposes the same bug in both paths, capture a
  separate refactor plan or pull the refactor into the same change only if it
  clearly reduces risk.

Expected output:

- Explicitly mark this item as deferred or completed when closing the follow-up
  work.

### Step 9 - Optional cleanup: remove redundant resolver queue null check

Status:

- Optional cleanup only.

Current code path:

- `src/lib/executors/shared.ts`

Implementation approach:

- Only remove the redundant branch if `shared.ts` is already open for other
  reasons.
- Do not take this as a standalone step if it adds churn without improving the
  correctness work.

## Validation Cadence

After each step:

- `bun run format`
- `bun run check`
- `bun run typecheck`
- `bun run test`
- `bun run build`

## Done Criteria

This follow-up is complete when:

- top-level `try$.runSync(...)` matches standalone panic behavior
- wrap hooks are observational and context-read-only
- `shouldRetry` rejects non-boolean runtime values
- `runSync()` rejects delayed or jittered retry policy shapes
- `executeRun()` object-form typing matches runtime returns
- async run paths rethrow `Panic` instead of returning it
- `GenResult` includes `UnhandledException`
- `shared.test.ts` no longer depends on timing-based abort observation
- Steps 8 and 9 are either explicitly deferred or deliberately completed
