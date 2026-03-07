# BaseExecution Lazy Control Plan

Goal: remove unnecessary `SignalController` and `TimeoutController`
allocations from `BaseExecution` when an execution has no timeout or signal
configuration, while preserving the current cancellation/timeout semantics
across `run`, `runSync`, `all`, `allSettled`, and `flow`.

## Context

The follow-up concern from
`./05-unify-runsync-gen-builder-exports.md` is that `BaseExecution` eagerly
constructs both control objects in its constructor:

```ts
this.timeout = new TimeoutController(config.timeout)
this.signal = new SignalController([...config.signals, this.timeout.signal])
```

That means even no-config executions now pay for:

- `new TimeoutController(undefined)`
- `new SignalController([])`
- extra disposable bookkeeping

This is most visible after binding `runSync` and `gen` from the root builder,
because calls like `try$.runSync(() => 42)` and `try$.gen(...)` now go through
`BaseExecution` even when there are no wraps, signals, or timeouts configured.

This optimization should live in `BaseExecution`, not in the builder, because:

- `run` also benefits from the same fast path
- `all`, `allSettled`, and `flow` read control state from `BaseExecution`
- one shared implementation keeps behavior more consistent than executor-specific
  short-circuits

## Chosen Direction

Use the `BaseExecution`-level fix:

1. Only create control objects when `config.timeout` and/or `config.signals`
   actually require them.
2. Keep the existing executor structure and shared retry/control helpers.
3. Avoid builder-only fast paths for `runSync` or `gen`.

This is the same design direction as "Option 3" from the previous plan, but
adapted to the current codebase shape.

## Progress Checklist

- [ ] Step 1 - Refactor `BaseExecution` to use optional control objects
- [ ] Step 2 - Update control helpers to fast-path when no control config exists
- [ ] Step 3 - Migrate executor call sites away from direct controller access
- [ ] Step 4 - Add regression coverage for control and no-control paths
- [ ] Step 5 - Validate

## Step 1 - Refactor `BaseExecution` to use optional control objects

In `src/lib/executors/base.ts`:

- Replace the eager `protected readonly signal` and `protected readonly timeout`
  fields with optional internal controller slots.
- Instantiate `TimeoutController` only when `config.timeout` is present.
- Instantiate `SignalController` only when there are external signals or a
  timeout signal to compose into the execution signal.
- Add protected accessors/helpers for:
  - the composed execution signal (`AbortSignal | undefined`)
  - the timeout controller when needed internally
  - the signal controller when needed internally
- Keep `ctx` creation centralized in the constructor, but ensure `ctx.signal`
  stays:
  - `undefined` when there is no timeout/signal config
  - defined when a timeout or signal config exists

This avoids the key pitfall of a fully lazy getter approach: if `ctx.signal`
were populated only after the first control check, try functions would observe
the wrong initial context shape.

## Step 2 - Update control helpers to fast-path when no control config exists

Still in `src/lib/executors/base.ts`:

- Update `checkDidControlFail()` to handle absent controllers without creating
  them.
- Update `race()` so it returns the original promise directly when there is no
  timeout and no signal configured.
- Preserve the current precedence rules:
  - cancellation still wins over timeout when both apply
  - timeout-only and signal-only executions still work as they do today
- Update `[Symbol.dispose]()` so it disposes only the controllers that were
  actually created.

The important invariant is that this refactor changes allocations, not
observable behavior.

## Step 3 - Migrate executor call sites away from direct controller access

Several executors currently reach into `BaseExecution` internals with
`this.signal.signal` and `this.timeout.race(...)`.

Update these call sites to use the new helper surface:

- `src/lib/executors/all.ts`
- `src/lib/executors/all-settled.ts`
- `src/lib/executors/flow.ts`

Concrete adjustments:

- Pass the composed execution signal via a protected accessor instead of
  `this.signal.signal`.
- Prefer `this.race(...)` over direct timeout-controller usage when wrapping
  sub-executions, so the fast path remains centralized in `BaseExecution`.
- Verify that `all`, `allSettled`, and `flow` keep their current behavior when
  external signals abort or timeouts expire.

This step is important because constructor-only changes are not enough while
call sites still assume the controllers always exist.

## Step 4 - Add regression coverage for control and no-control paths

Update or add tests in:

- `src/lib/executors/__tests__/base.test.ts`
- `src/lib/executors/__tests__/run-sync.test.ts`
- any executor test that needs updated cancellation/timeout assertions after the
  internal refactor

Coverage to keep or add:

- retry-only execution still exposes `ctx.retry` with `ctx.signal === undefined`
- timeout-configured execution still exposes a signal and still times out
- signal-configured execution still cancels correctly
- combined signal + timeout still prefers cancellation over timeout when both
  are already tripped
- `all`, `allSettled`, and `flow` still behave correctly when control signals
  are passed through to their child executions

Do not overfit tests to object allocation details unless the refactor adds a
stable seam for that. Behavior-focused regression coverage is enough for CI.

## Step 5 - Validate

- `bun run format`
- `bun run check`
- `bun run typecheck`
- `bun run test`

## Risks and Notes

- `ctx.signal` shape is the main observable contract to protect. It must not
  become "sometimes undefined until first use."
- Refactoring `all`/`allSettled` to use `this.race(...)` slightly changes the
  control flow structure, so cancellation and timeout tests should be watched
  closely.
- This plan intentionally does not introduce microbenchmarks into CI. If we
  want hard numbers, that should be a separate local benchmark task.
