# hardtry Implementation Plan (v1)

Goal: implement `hardtry` incrementally with behavior locked by
`.context/design.md`, validating each method before moving forward.

## Progress Checklist

- [x] Phase 0 - Foundation
- [x] Phase 1 - `run` (sync)
- [x] Phase 2 - `run` (async)
- [x] Phase 3 - `retryOptions` + `retry`
- [x] Phase 4 - `timeout` (v1 total scope only)
- [x] Phase 5 - `.signal(...)` cancellation
- [x] Phase 6 - `wrap` middleware (full-run scope)
- [x] Phase 7 - Builder API + root namespace exports
- [ ] Phase 8 - `dispose` with `AsyncDisposableStack`
- [ ] Phase 9 - `gen`
- [ ] Phase 10 - `all` and `allSettled`
- [ ] Phase 11 - `flow` + `$exit`
- [ ] Phase 12 - Hardening + release readiness

## Principles

- Build the smallest working slice first, then add one capability at a time.
- Add runtime tests and type tests at each step.
- Keep API surface stable (`try$`, `run`, `retryOptions`, etc.).
- Avoid behavior drift once a phase is marked complete.

## Phase 0 - Foundation

1. Create base files and exports
   - `src/lib/types.ts`
   - `src/lib/errors.ts`
   - `src/lib/context.ts`
   - `src/lib/runner.ts`
   - `src/lib/builder.ts`
   - wire minimal `src/index.ts`
2. Define core types
   - `MaybePromise<T>`
   - `TryCtx`
   - `RunOptions` and `RunTryFn`
   - shared config types used by builder
3. Define error classes and codes
   - `CancellationError` (`EXEC_CANCELLED`)
   - `TimeoutError` (`EXEC_TIMEOUT`)
   - `RetryExhaustedError` (`EXEC_RETRY_EXHAUSTED`)
   - `UnhandledException` (`EXEC_UNHANDLED_EXCEPTION`)
   - `Panic` (`EXEC_PANIC`)
   - all include `cause`

Exit criteria:

- project compiles with basic stubs in place.

## Phase 1 - `run` (sync)

1. Implement `run(tryFn)` sync path
   - if `tryFn` returns sync value, return sync value
   - on throw without catch, return `UnhandledException`
2. Implement `run({ try, catch })` sync path
   - `run({ ... })` requires both `try` and `catch`
   - if `try` throws, call `catch` and return mapped error
   - if `catch` throws, throw `Panic`
3. Add tests
   - success sync
   - throw to `UnhandledException`
   - throw plus catch mapping
   - catch throws `Panic`

Exit criteria:

- sync contract is stable and covered.

## Phase 2 - `run` (async)

1. Add async-aware execution
   - if `try` returns a Promise, return a Promise
   - if `catch` returns a Promise, return a Promise
   - preserve sync return when both are sync
   - object form still requires both `try` and `catch`
2. Keep same semantics as sync
   - no behavior drift between sync and async
   - `Panic` remains highest precedence for catch-throw path and is thrown
3. Add tests
   - async success
   - async reject to mapped catch
   - async catch reject throws `Panic`
   - mixed sync and async combinations

Exit criteria:

- overload behavior is deterministic and typed.

## Phase 3 - `retryOptions` + `retry`

1. Implement `retryOptions(policy)` helper
   - normalize `{ limit, delayMs, backoff, shouldRetry?, maxDelayMs?, jitter? }`
2. Implement `.retry(...)` on builder
   - `limit` includes first attempt
   - explicit backoff formulas
   - support `shouldRetry(error, ctx)`
3. Retry rules
   - do not retry control errors (`Panic`, `CancellationError`, `TimeoutError`)
4. Add tests
   - attempt counting
   - linear and exponential formula correctness
   - predicate-gated retry

Exit criteria:

- retry behavior matches docs.

## Phase 4 - `timeout` (v1 total scope only)

1. Implement `.timeout(ms | { ms, scope: "total" })`
2. Total scope includes
   - all attempts
   - backoff waits
   - catch execution
3. Timeout maps to `TimeoutError` with cause
4. Add tests
   - timeout during try
   - timeout during backoff
   - timeout during catch

Exit criteria:

- total-timeout semantics are locked.

Future follow-up (post-v1 experiment):

- evaluate `scope: "attempt"` timeout semantics and interaction with retry/backoff.

## Phase 5 - `.signal(...)` cancellation

1. Implement external signal integration
   - compose external `AbortSignal` into internal execution
   - map to `CancellationError` with cause
2. Add precedence handling
   - `Panic > CancellationError > TimeoutError > catch-mapped > UnhandledException`
3. Add tests
   - pre-aborted signal
   - mid-flight abort
   - abort + timeout race

Exit criteria:

- cancellation semantics are stable and typed.

## Phase 6 - `wrap` middleware (full-run scope)

1. Implement `.wrap(fn)` additive chain
2. Wrap applies around full run execution (not per attempt)
3. Ensure context includes retry metadata
4. Add tests
   - wrap order
   - runs once per `run`
   - interaction with retry, timeout, and signal

Exit criteria:

- wrap scope and ordering are fixed.

## Phase 7 - Builder API + root namespace exports

1. Finalize immutable `TryBuilder`
2. Finalize `src/index.ts` with one `root` builder instance
   - bound exports: `retry`, `timeout`, `signal`, `wrap`, `run`, `all`,
     `allSettled`, `flow`
   - standalone exports: `gen`, `dispose`, `retryOptions`
3. Add API-level tests for namespace behavior

Exit criteria:

- public API is stable and consistent with docs.

## Phase 8 - `dispose` with `AsyncDisposableStack`

1. Implement `try$.dispose()`
2. Support `.use(resource)` and `.defer(fn)`
3. Reverse-order cleanup
4. Continue cleanups if one fails and aggregate cleanup failures
5. Add tests including early-exit and abort scenarios

Exit criteria:

- deterministic cleanup guarantees are enforced.

## Phase 9 - `gen`

1. Implement generator helper for result unwrapping
2. Preserve union typing for accumulated error types
3. Add runtime and type tests

Exit criteria:

- `gen` ergonomics and typing are stable.

## Phase 10 - `all` and `allSettled`

1. Implement `all(tasks)` with named task map
2. Implement `allSettled(tasks)` with native-like settled typing
3. Provide `this.$result`, `this.$signal`, and `this.$disposer`
4. Add tests
   - dependency access via `$result`
   - mixed outcomes
   - cancellation mid-flight

Exit criteria:

- task APIs behave consistently and inference is acceptable.

## Phase 11 - `flow` + `$exit`

1. Implement `flow(tasks)` orchestration
2. Implement `$exit(value)` early-return mechanism
3. Ensure early exit still triggers disposer cleanup
4. Add tests
   - early exit with pending tasks
   - cleanup on exit
   - typed `FlowExit` extraction

Exit criteria:

- flow control and cleanup semantics are deterministic.

## Phase 12 - Hardening + release readiness

1. Add race-condition matrix tests
   - retry + timeout + abort races
   - catch throwing, async catch, timeout during catch
   - backoff interrupted by abort
2. Add public type tests for all APIs
3. Final docs consistency pass (`design.md` + `api-proposal.md`)
4. Run quality gates
   - `bun run format`
   - `bun run check`
   - `bun run typecheck`
   - `bun run test`

Exit criteria:

- v1 implementation complete and doc-aligned.
