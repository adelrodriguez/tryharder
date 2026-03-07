# Executors Base Class Refactor Plan

Goal: consolidate shared executor logic (wraps, retry/control helpers, context setup) under a base execution class, remove shared implementation files, and keep behavior identical.

## Progress Checklist

- [x] Step 1 - Freeze behavior contract from tests
- [x] Step 2 - Introduce `BaseExecution` shared layer
- [x] Step 3 - Consolidate runner-shared primitives into base (no `.shared` files)
- [x] Step 4 - Refactor async `run` executor to use base
- [x] Step 5 - Refactor sync `run-sync` executor to use base
- [x] Step 6 - Refactor `flow` outer retry/wrap/control runner to use base
- [x] Step 7 - Migrate `all`/`allSettled` outer runner to base and replace `all.shared.ts`
- [x] Step 8 - Delete legacy shared files (`all.shared.ts`, `execution-shared.ts`) and rewire imports
- [x] Step 9 - Add/adjust regression tests for migrated behavior gaps
- [x] Step 10 - Re-evaluate wrap placement (base vs modifier)
- [x] Step 11 - Rename `base-execution.ts` to `base.ts` and add base tests
- [x] Step 12 - Final validation and cleanup

## Completed Steps

### Step 1 - Freeze behavior contract from tests

- Re-ran full suite after local refactors.
- Current baseline: `bun run test` passes (`246` passing, `0` failing).
- Contract sources now concentrated in:
  - `src/__tests__/index.test.ts`
  - `src/__tests__/types.test.ts`

### Step 2 - Introduce `BaseExecution` shared layer

- Added `src/lib/executors/base-execution.ts`.
- Included shared setup and helpers:
  - context creation (`TryCtx`)
  - wrap execution (`withWraps`)
  - signal/timeout controllers and control checks
  - race + retry delay helpers
  - retry decision builder

### Step 3 - Consolidate runner-shared primitives into base (no `.shared` files)

- Kept everything in `base-execution.ts` instead of creating `run.shared.ts`.
- Shared runner pieces now in base:
  - `RunnerError`
  - `RetryDecision`
  - `RetryDirective`
  - `extractControlResult`

### Step 4 - Refactor async `run` executor to use base

- `RunExecution` now extends `BaseExecution` in `src/lib/executors/run.ts`.
- Removed duplicated setup/control/retry plumbing from `run.ts`.
- Streamlined naming and async-only internals:
  - `executeAsync()` -> `execute()`
  - `#runAttemptLoopAsync(...)` -> `#runAttemptLoop(...)`
  - removed extra async result helper by inlining race/resolve
  - simplified mixed sync/async union return paths in private helpers

### Step 5 - Refactor sync `run-sync` executor to use base

- `RunSyncExecution` now extends `BaseExecution` in `src/lib/executors/run-sync.ts`.
- Replaced duplicated setup/control/retry logic with base helpers:
  - `withWraps(...)`
  - `checkBeforeAttempt()` / `checkDidControlFail(...)`
  - `buildRetryDecision(...)`
  - shared `ctx` lifecycle from base
- Simplified sync runner contract and naming:
  - `executeSync()` -> `execute()`
  - `#runAttemptLoopSync(...)` -> `#runAttemptLoop(...)`
- Tightened sync-only enforcement:
  - Promise-like return from wrapped execution throws `ConfigurationError`
  - Promise-like `try` return throws `ConfigurationError` immediately
  - Promise-like `catch` return throws `ConfigurationError` immediately
  - sync-only retry policy guard remains in `executeRunSync(...)`
- Added base template-method wrapping flow:
  - `BaseExecution.execute()` now applies wraps centrally
  - subclasses implement `executeCore()` only
  - `RunExecution` and `RunSyncExecution` now use `executeCore()`
- Moved wrap composition helper to modifier layer:
  - `src/lib/executors/wrap.ts` -> `src/lib/modifiers/wrap.ts`
  - updated imports in builder/base/flow
- Narrowed base exports to keep internals local:
  - `extractControlResult` is now file-local
  - `BaseExecutionOptions` is now file-local

### Step 6 - Refactor `flow` outer runner to use base

- Kept `FlowExecution` task-graph engine unchanged in `src/lib/executors/flow.ts`.
- Added `FlowRunnerExecution` extending `BaseExecution` for outer lifecycle:
  - wrap application via base template method (`execute()`)
  - retry loop + backoff delay via base helpers
  - signal/timeout control checks and race behavior via base helpers
- Preserved behavior contracts:
  - throws when no task exits
  - retry and retry-exhaustion semantics unchanged
  - cancellation/timeout handling unchanged

### Step 7 - Migrate `all`/`allSettled` outer runner to base

- Added shared executor-only task graph runtime in `src/lib/executors/shared.ts`:
  - `TaskExecution` supports `"fail-fast"` and `"settled"` modes
  - reused by `src/lib/executors/all.ts` and `src/lib/executors/all-settled.ts`
- Kept outer lifecycle in each executor via base-derived runners (`BaseExecution`).
- Preserved behavior contracts:
  - fail-fast mode for `all`
  - non-fail-fast settled mode for `allSettled`
  - task context (`$result`, `$signal`, `$disposer`) semantics.

### Step 8 - Delete legacy shared files

- Deleted:
  - `src/lib/all.ts`
  - `src/lib/all-settled.ts`
  - `src/lib/all.shared.ts`
  - `src/lib/execution-shared.ts`
- Verified imports now point to active modules only.

### Step 9 - Add regression coverage

- Added settled-wrap regression tests in `src/lib/executors/__tests__/all-settled.test.ts`:
  - wrap middleware runs once around full `allSettled` execution
  - wrap retry metadata remains fixed at one attempt (`attempt = 1`, `limit = 1`)
- Added direct task-runtime tests in `src/lib/executors/__tests__/shared.test.ts`:
  - fail-fast mode result + failure/abort behavior
  - settled mode non-fail-fast aggregation and result-shaping
  - invalid `$result` reference handling

### Step 10 - Re-evaluate wrap placement (base vs modifier)

- Decision: keep wrap composition helper in `src/lib/modifiers/wrap.ts` for now.
- Rationale:
  - current call sites are `BaseExecution` and builder `gen()` path
  - keeping it in modifiers avoids coupling non-executor helper paths to base classes.
- Decision: keep `gen` outside base for now.
- Rationale:
  - `gen` remains a pure helper without timeout/signal/retry lifecycle ownership
  - preserves current sync/async return-shape behavior without introducing execution wrapper complexity.

### Step 11 - Rename `base-execution.ts` to `base.ts` and add base tests

- Renamed:
  - `src/lib/executors/base-execution.ts` -> `src/lib/executors/base.ts`
- Updated all executor imports to the new path.
- Added focused base tests in `src/lib/executors/__tests__/base.test.ts` covering:
  - template-method wrap behavior (`execute()` around `executeCore()`)
  - wrap order and single execution scope
  - base control/retry helper behavior (control precedence, retry decisions, delay control)

### Step 12 - Final validation and cleanup

- Ran quality gates successfully:
  - `bun run format`
  - `bun run check`
  - `bun run typecheck`
  - `bun run test`
- Verified deleted-file references are removed from source:
  - `all.shared`
  - `execution-shared`
  - `base-execution`
- Confirmed public API entrypoint remains stable in `src/index.ts`.

## Next Steps (Open)

- All planned steps complete.
