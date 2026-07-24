# tryharder

## 0.2.1

### Patch Changes

- 4ae6425: Build the package and its declarations with TypeScript 7.

## 0.2.0

### Minor Changes

- a42a4fd: Simplify the disposal API to one name per operation, and require positive integer retry limits.

  **Breaking changes:**

  - The `dispose()` factory export is renamed to `disposer()`.
  - `AsyncDisposer` now exposes exactly three operations: `defer(fn)` (register a cleanup callback, was `add`), `use(resource)` (unchanged), and `dispose()` (run teardown, was `cleanup`/`disposeAsync`). The `add()`, `cleanup()`, and `disposeAsync()` aliases are removed. `await using` support via `Symbol.asyncDispose` is unchanged.

  ```ts
  const d = try$.disposer()
  d.defer(async () => connection.close())
  // ...
  await d.dispose()
  ```

  - `retry()` now requires a positive integer limit. `retry(0)` previously behaved identically to `retry(1)` while contradicting the documented "limit includes the first attempt" semantics, and fractional limits like `retry(2.5)` silently behaved as their ceiling. Both now throw `Panic("RETRY_INVALID_LIMIT")` at `.retry()` call time — and are rejected at compile time when passed as literals (`retry(0)`, `retry(-1)`, `retry(2.5)`, and the object-form `limit` equivalents are now type errors). Non-literal `number` values remain runtime-validated.

- 6beddd6: Add error type guards to `tryharder/errors`: `isCancellationError`, `isTimeoutError`, `isRetryExhaustedError`, `isUnhandledException`, and `isPanic`. The guards match by `error.name` (plus a `code` check for `Panic`) in addition to `instanceof`, so they keep working when duplicate copies of `tryharder` exist in one dependency graph or when errors cross realm boundaries — situations where `instanceof` silently fails. They are the recommended way to identify tryharder errors.
- 414afa2: Align retry give-up semantics with the `catch` contract (modeled on Effect's `retry`/`retryOrElse`): when a retry policy gives up — whether the attempt limit was exhausted or `shouldRetry` declined — the last attempt's error now takes the normal domain-error path instead of short-circuiting.

  **Breaking changes:**

  - `run({ try, catch })` / `runSync({ try, catch })` with retry configured: when retries exhaust, `catch` is now invoked with the last attempt's error and its mapped value is returned. Previously `catch` was bypassed and `RetryExhaustedError` was returned. `RetryExhaustedError` no longer appears in the return type union for the object form.
  - `run(fn)` / `runSync(fn)` with retry configured: when `shouldRetry` declines before the limit, the failure is now reported as `RetryExhaustedError` (with the last error as `cause`) instead of `UnhandledException`. Both give-up reasons are now indistinguishable, matching Effect.
  - Function-form return types with retry configured now infer `T | RetryExhaustedError | ...` instead of `T | UnhandledException | RetryExhaustedError | ...` (`UnhandledException` was unreachable in that configuration).

  **The `catch` contract, now explicit in JSDoc and README:** `catch` maps errors that originated inside `try` — thrown directly, or carried out of the retry loop as the last attempt's error once the retry policy gives up. Policy outcomes (`TimeoutError`, `CancellationError`) and defects (`Panic`) never pass through `catch`.

  Decision table:

  | retry | catch | persistent failure resolves to                   |
  | ----- | ----- | ------------------------------------------------ |
  | no    | no    | `UnhandledException` (cause: error)              |
  | no    | yes   | `catch(error)`                                   |
  | yes   | no    | `RetryExhaustedError` (cause: last error)        |
  | yes   | yes   | `catch(lastError)`                               |
  | any   | any   | timeout/cancel: typed in union, bypasses `catch` |

### Patch Changes

- c9122a3: Deduplicate attempt-failure resolution between `run()` and `runSync()`. The shared logic — defect rethrow, control-error passthrough, retry-directive creation, and unmapped-failure wrapping (`RetryExhaustedError`/`UnhandledException`) — now lives in two `BaseExecution` helpers (`resolveControlOrRetry`, `resolveUnmappedFailure`); each executor keeps only its own catch-mapping behavior. No behavior change.
- 3f060eb: Internal cleanup: timeout validation now has a single source of truth (`assertValidTimeout` in the timeout modifier, used eagerly by the builder and defensively by `TimeoutController`), and the task-graph observation hooks (`onTaskResult`/`onTaskError`) are optional methods instead of no-op bodies filled with lint-appeasing `void` statements. No behavior change.
- 264a99f: Deduplicate the orchestration task-graph lifecycle. The shared skeleton — racing execution against cancellation, waiting for sibling tasks to settle before resolving, and giving cancellation priority over thrown errors — now lives once in `OrchestrationExecution.executeTaskGraph`, used by `all()`, `allSettled()`, and `flow()`. Each executor keeps only its own failure mapping. No behavior change.
- 065127f: Collapse the builder to a single runtime class. The internal `ExecutionBuilder` subclass and its runtime method-hiding (defining `all`/`allSettled`/`flow`/`wrap` as `undefined` after `retry()`/`timeout()`) are removed — the narrowed type surfaces already prevent misuse in TypeScript, orchestration-after-policy from untyped code now fails at execution with a clear `Panic("ORCHESTRATION_UNSUPPORTED_POLICY")` instead of a bare `TypeError: undefined is not a function`, and wrap ordering is behavior-invariant (wraps always cover the full retry scope). This also removes the `instanceof` branching inside `signal()`.

## 0.1.2

### Patch Changes

- 08224eb: Fix `flow` failing to surface tasks that throw `undefined`. The first rejection is now stored as its mapped (non-undefined) value, keeping `firstRejection !== undefined` a sound signal even when a task throws `undefined` (which maps to an `UnhandledException`).
- 1108548: Inline `buildRetryConfig` into `retry` and add clarifying comments to the execution logic. No behavior change; this simplifies the builder internals and documents the timeout/cancellation race, flow first-rejection handling, and the intentionally no-op `SignalController.dispose`.

## 0.1.1

### Patch Changes

- aa8dd93: Replace the native `DisposableStack` and `AsyncDisposableStack` runtime dependency with internal private shims.

  `tryharder` now provides its own cleanup runtime through `dispose()` and task-local `$disposer`, so consumers no longer need native disposable-stack globals or an external polyfill to use the library in unsupported runtimes.

  The public cleanup helper type is now `AsyncDisposer` instead of ambient `AsyncDisposableStack`.

## 0.1.0

### Minor Changes

- b014c61: Launch `tryharder` as the first public minor release.

  `tryharder` is a typed execution layer for TypeScript that makes failure and execution policy explicit in return types and builder chains. This initial release includes:

  - terminal execution APIs with `run()` and `runSync()`
  - execution policies with `retry()`, `timeout()`, and `signal()`
  - observational middleware with `wrap()`
  - orchestration APIs with `all()`, `allSettled()`, and `flow()`
  - generator-style composition with `gen()`
  - cleanup support with `dispose()`
  - dedicated `tryharder/errors` and `tryharder/types` entrypoints

  Migration note: if you were using pre-release or repository-based builds under the old `hardtry` name, update imports from `hardtry` to `tryharder`, `hardtry/errors` to `tryharder/errors`, and `hardtry/types` to `tryharder/types`.
