# PR #18 Follow-up Implementation Plan

Verified against the current workspace on 2026-03-07.

This is no longer a raw review checklist. It is an ordered plan containing only
the items that still appear unresolved after re-checking the current code and
tests.

## Re-verification Results

Still valid:

- Top-level `try$.runSync(...)` still returns `Panic` values through the bound
  builder export instead of throwing them.
- `BaseExecution` still ignores wrap-replaced/cloned context objects and always
  executes terminals with `this.ctx`.
- `retry.shouldRetry` is still trusted as a runtime boolean and can be passed a
  promise-like or other non-boolean value via unsafe casts.
- `executeRun()` object-form overloads still expose a narrower public type than
  the runtime can actually return.
- `GenResult` still omits `UnhandledException` even though `driveGen()` returns
  it.
- `src/lib/executors/__tests__/shared.test.ts` still uses a time-based sleep in
  the fail-fast abort test.
- `src/lib/executors/__tests__/shared.test.ts` still has explicit local
  `Promise<...>` async return annotations that can be inferred.
- The `FlowExecution` / `TaskExecution` duplication still exists as a possible
  refactor.
- The redundant resolver-queue null check in `src/lib/executors/shared.ts`
  still exists as optional cleanup.

Resolved or obsolete:

- Tighten `RunBuilder` state typing: obsolete in the current code; the builder
  no longer stores the reviewed `State`/`BuilderState` shape.
- Standalone `runSync()` wrapping promise-returning `catch` misconfiguration as
  `RUN_SYNC_CATCH_HANDLER_THROW`: fixed; `runSync()` now rethrows
  `RUN_SYNC_CATCH_PROMISE` unchanged.
- `allSettled()` cancellation asymmetry: obsolete for current behavior; current
  code and tests show external cancellation rejects with `CancellationError`.
- `allSettled()` forcing `retryLimit: 1`: obsolete under the current API shape;
  orchestration terminals no longer compose with top-level `retry()`, so wrap
  metadata for `all()` / `allSettled()` / `flow()` now intentionally stays at
  the default `attempt = 1`, `limit = 1`.

## Ordered Implementation Plan

### Step 1 - Restore top-level `runSync` panic semantics

Goal: make `try$.runSync(...)` match standalone `runSync(...)` again for panic
cases.

- Current area: `src/index.ts`, `src/lib/executors/run-sync.ts`
- Current problem: the root-bound export goes through `executeRunSync()`, and a
  thrown `Panic` from user code is treated as a returned control error.
- Expected outcome: top-level `try$.runSync(...)` throws `Panic` instead of
  returning it.
- Add regression coverage for nested/forwarded panic cases in
  `src/__tests__/index.test.ts`.

### Step 2 - Forward wrap-modified context through `BaseExecution`

Goal: make wrap middleware able to replace or clone context and have terminals
actually observe that new context.

- Current area: `src/lib/executors/base.ts`
- Current problem: wrap chains receive `ctx`, but `executeCore()` is called
  without the final wrapped context and terminal executors read `this.ctx`
  directly.
- Expected outcome: terminals run with the final context object produced by the
  wrap chain.
- Add regression coverage in executor or index tests for a wrap that mutates or
  replaces context observed by the terminal executor.

### Step 3 - Validate `retry.shouldRetry` runtime results strictly

Goal: fail fast when `shouldRetry` returns anything other than a boolean.

- Current area: `src/lib/executors/base.ts`, `src/lib/modifiers/retry.ts`
- Current problem: unsafe casts can return promise-like or other truthy values,
  and the executor currently treats them as retry instructions.
- Expected outcome: non-boolean `shouldRetry` results throw a deterministic
  framework error instead of retrying until exhaustion.
- Add regression coverage for promise-like and non-boolean returns.

### Step 4 - Fix `executeRun()` object-form overloads

Goal: align public typing with runtime behavior.

- Current area: `src/lib/executors/run.ts`
- Current problem: object-form overloads can still resolve to `Promise<T | E>`
  even though runtime can also produce `RunnerError` values.
- Expected outcome: object-form callers see the full `Promise<T | E |
RunnerError>` surface.
- Add or update type assertions in `src/__tests__/types.test.ts`.

### Step 5 - Add `UnhandledException` to public `GenResult`

Goal: make `gen()`'s exported type match the values it already returns.

- Current area: `src/lib/gen.ts`
- Current problem: runtime wraps rejected/thrown non-control failures as
  `UnhandledException`, but `GenResult` does not include that case.
- Expected outcome: public `GenResult` includes `UnhandledException`.
- Add/update type tests in `src/__tests__/types.test.ts`.

### Step 6 - Stabilize and simplify shared executor tests

Goal: remove the remaining flaky/time-based assertion pattern and the leftover
style nits from `shared.test.ts`.

- Current area: `src/lib/executors/__tests__/shared.test.ts`
- Replace the fail-fast abort test's `sleep(...)` wait with a readiness barrier
  or explicit abort-observed signal.
- Remove explicit local async `Promise<...>` return annotations where inference
  is already correct.

### Step 7 - Decide whether to keep `FlowExecution` / `TaskExecution`

duplication

Goal: make a deliberate call on whether this refactor is worth doing now.

- Current area: `src/lib/executors/flow.ts`, `src/lib/executors/shared.ts`
- Recommendation: defer unless nearby correctness work is already touching both
  implementations.
- If deferred, note that decision explicitly and leave behavior tests as the
  source of truth.

### Step 8 - Optional cleanup: remove redundant resolver null check

Goal: trim a small unnecessary branch after the more important work is done.

- Current area: `src/lib/executors/shared.ts`
- Recommendation: optional cleanup only.

## Validation

After each implementation step, run the normal quality gates:

- `bun run format`
- `bun run check`
- `bun run typecheck`
- `bun run test`
- `bun run build`
