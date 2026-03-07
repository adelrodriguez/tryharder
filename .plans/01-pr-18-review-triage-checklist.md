# PR #18 Follow-up Execution Plan

Verified against the current workspace on 2026-03-07.

## Goal

Land the remaining correctness and public-type fixes from PR #18 in one
follow-up pass, while keeping refactors and cleanup work out of scope unless
the correctness changes make them effectively free.

## Recommended Scope

Ship in this pass:

- Step 1: top-level `runSync()` panic semantics
- Step 2: wrap-modified context propagation
- Step 3: strict `shouldRetry` runtime validation
- Step 4: `executeRun()` overload alignment
- Step 5: `GenResult` public type fix
- Step 6: shared executor test stabilization

Defer unless the earlier steps force nearby edits:

- Step 7: `FlowExecution` / `TaskExecution` refactor
- Step 8: resolver queue cleanup

## Working Rules

- Fix runtime behavior before widening or correcting public types.
- Add regression coverage before or with each behavior change.
- Keep the first pass local and explicit; do not extract new abstractions unless
  the implementation becomes harder to read without them.
- Re-run the full quality gates after each completed step.

## Execution Sequence

### Step 1 - Restore top-level `runSync()` panic semantics

Objective:

- Make `try$.runSync(...)` match standalone `runSync(...)` again for panic
  cases.

Current code paths:

- `src/index.ts`
- `src/lib/executors/run-sync.ts`

Implementation approach:

- Treat this as a root-entrypoint issue, not a builder-chain issue.
- Evaluate replacing the root `runSync` binding in `src/index.ts` with the
  standalone `runSync` export from `src/lib/executors/run-sync.ts`, or add a
  small root-only adapter that preserves the same semantics.
- Preserve current builder behavior for `retry(...).runSync(...)`; only the
  top-level namespace should change.

Regression coverage:

- Extend `src/__tests__/index.test.ts` with panic cases that currently differ
  between standalone and bound root `runSync`.
- Include a directly thrown `Panic` and a forwarded panic such as
  `RUN_SYNC_TRY_PROMISE`.

Done when:

- Top-level `try$.runSync(...)` throws `Panic` instead of returning it.
- Builder-chained `runSync()` behavior remains unchanged unless tests show the
  same bug there.

### Step 2 - Forward wrap-modified context through `BaseExecution`

Objective:

- Make wrap middleware able to replace or clone context and have the terminal
  executor observe that final context object.

Current code paths:

- `src/lib/executors/base.ts`
- `src/lib/executors/run.ts`
- `src/lib/executors/run-sync.ts`
- orchestration executors that inherit from `BaseExecution`

Implementation approach:

- Change the `BaseExecution` terminal contract so `executeCore(...)` receives
  the final wrapped `TryCtx` instead of terminals always reading `this.ctx`.
- Update the wrap chain in `BaseExecution.execute()` so it passes the wrapped
  context all the way into the terminal executor.
- Update run and runSync attempt loops to read and write retry state through the
  active context object they receive, not only through the original stored
  context.
- Keep the base context creation in `BaseExecution`, but treat it as the seed
  context that wraps may replace.

Regression coverage:

- Add a wrap test that clones the context and proves the terminal sees the new
  object.
- Add a wrap test that mutates context before the terminal runs and proves the
  mutation is observed.

Dependency note:

- Land this before Step 3 so retry validation and retry metadata use the same
  terminal context shape.

Done when:

- A wrap-produced replacement context is visible inside the terminal executor.
- Retry metadata still advances correctly across attempts.

### Step 3 - Validate `retry.shouldRetry` runtime results strictly

Objective:

- Fail fast when `shouldRetry` returns anything other than a boolean.

Current code paths:

- `src/lib/modifiers/retry.ts`
- `src/lib/executors/base.ts`
- `src/lib/executors/__tests__/retry.test.ts`
- `src/lib/modifiers/__tests__/retry.test.ts`

Implementation approach:

- Keep the validation at the runtime decision point in
  `src/lib/modifiers/retry.ts`, because that is where the `shouldRetry` result
  is currently consumed.
- Add a dedicated `Panic` code for invalid `shouldRetry` return values.
- Reject promise-like values and any non-boolean truthy/falsy value; do not
  coerce them into retry decisions.

Regression coverage:

- Add modifier-level tests for promise-like and non-boolean returns.
- Add executor-level retry tests that use unsafe casts so the runtime guard is
  exercised through actual execution.

Done when:

- Invalid `shouldRetry` results fail deterministically with a framework panic.
- Retry exhaustion is no longer reachable through non-boolean coercion.

### Step 4 - Fix `executeRun()` object-form overloads

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

### Step 5 - Add `UnhandledException` to public `GenResult`

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

### Step 6 - Stabilize and simplify shared executor tests

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

### Step 7 - Decide whether to keep `FlowExecution` / `TaskExecution` duplication

Status:

- Defer by default.

Decision rule:

- If Steps 1-6 do not require touching both implementations, leave the
  duplication alone for now.
- If nearby correctness work exposes the same bug in both paths, capture a
  separate refactor plan or pull the refactor into the same change only if it
  clearly reduces risk.

Expected output:

- Explicitly mark this item as deferred or completed when closing the follow-up
  work.

### Step 8 - Optional cleanup: remove redundant resolver queue null check

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
- wrap-replaced context objects reach terminal execution
- `shouldRetry` rejects non-boolean runtime values
- `executeRun()` object-form typing matches runtime returns
- `GenResult` includes `UnhandledException`
- `shared.test.ts` no longer depends on timing-based abort observation
- Steps 7 and 8 are either explicitly deferred or deliberately completed
