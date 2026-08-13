# tryharder

A small execution layer for TypeScript: callers keep writing plain functions, while execution policy and failure become explicit, typed parts of the returned value.

## Language

**Terminal execution API**:
The point where work actually runs and a result union is produced (`run`, `runSync`).
_Avoid_: executor (internal directory name), runner

**Policy builder**:
A chainable step (`retry`, `timeout`, `signal`) that runs no work itself; it configures the next terminal call and widens its result union.
_Avoid_: modifier (internal directory name), middleware, decorator

**Result union**:
The return type of a terminal execution: the success value together with every failure that execution can produce.
_Avoid_: Result type, Either, error tuple

**Domain failure**:
A failure the caller maps into their own value with `catch`; an expected outcome of the domain.
_Avoid_: business error

**Policy failure**:
A failure introduced by a policy builder (`TimeoutError`, `CancellationError`, `RetryExhaustedError`). It surfaces typed in the result union and never passes through `catch`.
_Avoid_: system error, infrastructure error

**Panic**:
A thrown signal of programmer misuse (invalid builder chain, invalid task graph). Never part of a result union.
_Avoid_: error, exception (for this concept)

**Attempt**:
One execution of the work under a retry policy. The first execution is an attempt; `retry(limit)` counts it.
_Avoid_: retry (as a noun for the count)

**Total deadline**:
The single time budget `timeout(ms)` enforces — across all attempts for terminal execution, across the whole task graph for orchestration.
_Avoid_: per-attempt timeout

**Task graph**:
An object-shaped map of named tasks handed to orchestration; tasks read earlier results through `this.$result`.
_Avoid_: task list, promise array

**Orchestration**:
Running a task graph through `all`, `allSettled`, or `flow`.

**Settled outcome**:
The per-task fulfilled-or-rejected record preserved by `allSettled` instead of short-circuiting on failure.

**Exit**:
The explicit termination of a `flow` through `$exit`; the only way a flow completes.
_Avoid_: early return, break

**Cooperative cancellation**:
Cancellation that takes effect only when the running work observes its `$signal`. Aborting requests a stop; it does not force one.
