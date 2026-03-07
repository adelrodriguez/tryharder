# Unified Terminal Result Union Plan

Goal: make the terminal APIs behave consistently by resolving typed runtime
failures as values and reserving thrown/rejected outcomes for `Panic` only.

## Context

Current behavior is split:

- `run()` and `runSync()` are result-union APIs.
- `all()`, `allSettled()`, and `flow()` reject on timeout/cancellation.
- `all()` also rejects raw task failures unless the caller supplies `catch`.

Current public types and docs encode that split:

- `src/lib/builder.ts` types `all()` as `Promise<Result | C>`.
- `src/__tests__/types.test.ts` asserts `timeout().signal().all(...)` still
  resolves as `Promise<Result>`, not a control-error union.
- `README.md` documents `run()` as `Promise<value | error>` but keeps `all()`
  and `flow()` as plain success promises.

This is workable, but it makes the API family inconsistent and composes poorly
with `gen()`, because rejected yielded promises are currently wrapped into
`UnhandledException`.

## Chosen Direction

Adopt one rule across terminal APIs:

- runtime failures are returned as values
- `Panic` remains thrown/rejected

Do not take the partial step of changing only `all()` timeout behavior to a
resolved `TimeoutError` value while leaving cancellation and task failures as
rejections. That would make the API harder to reason about, not easier.

## Proposed Public Contract

Keep `run()` and `runSync()` as the reference model, then align the
orchestration APIs to it.

Target shapes:

- `run(tryFn)` stays `Promise<T | UnhandledException | ConfigErrors>`
- `run({ try, catch })` stays `Promise<T | C | ConfigErrors>`
- `runSync(...)` stays value-union based
- `all(tasks, options?)` becomes `Promise<AllValue<T> | C | AllFailure | TimeoutError | CancellationError>`
- `allSettled(tasks)` becomes `Promise<AllSettledResult<T> | TimeoutError | CancellationError>`
- `flow(tasks)` becomes `Promise<FlowResult<T> | UnhandledException | TimeoutError | CancellationError>`

Notes:

- `ConfigErrors` above means the existing builder-driven runtime errors already
  used by `run()`.
- `all()` should use a dedicated `AllFailure` value instead of plain
  `UnhandledException`, so it can preserve:
  - `failedTask`
  - `partial`
  - `cause`
- `flow()` can start with `UnhandledException` for non-control failures unless
  the implementation reveals a strong need for a dedicated failure type there
  too.

## Progress Checklist

- [ ] Step 1 - Freeze the new API contract in type tests and README notes
- [ ] Step 2 - Introduce `AllFailure` and related failure-shaping utilities
- [ ] Step 3 - Convert `all()` from rejecting runtime failures to value unions
- [ ] Step 4 - Convert `allSettled()` control failures to value unions
- [ ] Step 5 - Convert `flow()` runtime/control failures to value unions
- [ ] Step 6 - Revisit `gen()` composition around yielded rejected promises
- [ ] Step 7 - Update docs and examples for the new terminal API rule
- [ ] Step 8 - Validate and add release notes

## Step 1 - Freeze the new API contract in type tests and README notes

Update `src/__tests__/types.test.ts` first so the intended end state is
unambiguous before runtime refactors begin.

Add or update assertions for:

- `timeout(...).all(...)` returning `Promise<Result | TimeoutError>`
- `signal(...).all(...)` returning `Promise<Result | CancellationError>`
- combined builder chains on `all()` returning the expected union
- `allSettled()` control-error unions
- `flow()` control-error unions

Also update `README.md` signatures and the "Core Concepts" section to define one
rule explicitly:

- terminal APIs resolve typed failures as values
- only `Panic` rejects

This step is important because the current docs and tests still codify the old
split behavior.

## Step 2 - Introduce `AllFailure` and related failure-shaping utilities

Add a dedicated failure value for `all()` to preserve the extra context already
available in its catch path.

Recommended shape:

- `cause: unknown`
- `failedTask: string | undefined`
- `partial: Partial<AllValue<T>>`

Implementation options:

- add a new error class in `src/lib/errors.ts`
- or add a structured object type if we want to avoid another `Error` subclass

Recommendation: prefer an `Error` subclass so it composes naturally with the
rest of the library and keeps `cause` support standardized.

Add tests for the failure value itself if it becomes a new exported class.

## Step 3 - Convert `all()` from rejecting runtime failures to value unions

In `src/lib/executors/all.ts`:

- stop rejecting `TimeoutError` and `CancellationError`
- return them as resolved values
- stop rejecting ordinary task failures
- convert ordinary task failures into `AllFailure` when no user `catch` maps
  them
- keep `Panic("ALL_CATCH_HANDLER_THROW", ...)` and
  `Panic("ALL_CATCH_HANDLER_REJECT", ...)` as thrown/rejected programmer errors

Expected behavior after this step:

- success returns the result map
- user `catch` can still map failures to `C`
- timeout/cancellation return typed control values
- uncaught task failure returns `AllFailure`
- only `Panic` rejects

Update tests in:

- `src/lib/executors/__tests__/all.test.ts`
- `src/__tests__/index.test.ts`
- `src/__tests__/types.test.ts`

## Step 4 - Convert `allSettled()` control failures to value unions

`allSettled()` already returns values for task-level failures, so only its
outer control behavior needs to change.

In `src/lib/executors/all-settled.ts`:

- return `TimeoutError` instead of throwing it
- return `CancellationError` when builder cancellation wins

Update tests and type assertions so timeout/cancellation are returned values,
not promise rejections.

This keeps `allSettled()` aligned with its "outer promise should not reject for
expected execution outcomes" semantics.

## Step 5 - Convert `flow()` runtime/control failures to value unions

In `src/lib/executors/flow.ts`:

- return `TimeoutError` and `CancellationError` as values
- return `UnhandledException` for non-control terminal failures
- keep `Panic` thrown for programmer-error conditions such as `FLOW_NO_EXIT`

Decide whether `RetryExhaustedError` stays part of `flow()`:

- if `flow()` keeps retry semantics, returning `RetryExhaustedError` as a value
  is the most consistent choice
- if not, document the rationale clearly

Add regression coverage for:

- timeout during a flow attempt
- cancellation during flow execution
- non-control task failure when no task exits
- retry exhaustion if still supported

## Step 6 - Revisit `gen()` composition around yielded rejected promises

Once terminal APIs stop rejecting expected runtime failures, `gen()` will
compose better automatically. Still, it is worth reviewing
`src/lib/executors/gen.ts` to ensure it does not accidentally erase useful error
types from any remaining rejected promises.

Questions to answer:

- should yielded `TimeoutError`/`CancellationError` rejections be preserved if
  they still occur anywhere?
- should `gen()` continue wrapping arbitrary promise rejections in
  `UnhandledException`?

This step may be "no change", but it should be a deliberate decision.

## Step 7 - Update docs and examples for the new terminal API rule

Update `README.md` examples to show the new usage model:

- `const result = await try$.timeout(100).all(...)`
- branch on `result instanceof TimeoutError`
- avoid `try/catch` for expected runtime/control outcomes

Also update any language that still implies only `run()` is result-union based.

## Step 8 - Validate and add release notes

Validation:

- `bun run format`
- `bun run check`
- `bun run typecheck`
- `bun run test`

Release notes:

- add a changeset describing the terminal API semantic shift
- call out the breaking change clearly even though the project is still in v0

## Risks and Open Questions

- The biggest design choice is whether `all()` should use `AllFailure` or plain
  `UnhandledException`. Recommendation: `AllFailure`.
- A half-converted API is worse than the current split. Land this as one
  coherent change set.
- `Panic` needs to stay the only thrown/rejected class for the new rule to be
  easy to explain.
- If `flow()` keeps a different failure surface from `all()`, document why; do
  not let that difference emerge accidentally.
