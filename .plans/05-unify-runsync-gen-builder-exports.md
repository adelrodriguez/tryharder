# Unify `runSync` and `gen` as Builder Exports

Goal: make `runSync` and `gen` work the same way as `run`, `all`, `allSettled`, and `flow` — bound from the root `RunBuilder` instance and usable without `wrap()`.

## Background

Currently `runSync` and `gen` are exported as standalone functions that bypass the builder entirely:

```ts
// src/index.ts
export { runSync } from "./lib/executors/run-sync"
export { executeGen as gen } from "./lib/executors/gen"
```

All other executors are bound from the root builder:

```ts
const root: RunBuilder = new RunBuilder()
export const run: RunBuilder["run"] = root.run.bind(root)
export const all: RunBuilder["all"] = root.all.bind(root)
```

The builder versions of `runSync` and `gen` require `wrap()` first (`isWrapped: true`), which is why they couldn't be bound from the root. This plan removes that gate so they can be used uniformly.

## Progress Checklist

- [x] Step 1 — Remove `isWrapped` gate from `RunBuilder.runSync`
- [x] Step 2 — Remove `isWrapped` gate from `RunBuilder.gen`
- [x] Step 3 — Remove dead `BuilderErrors` constants
- [x] Step 4 — Bind `runSync` and `gen` from root in `src/index.ts`
- [x] Step 5 — Update type tests
- [x] Step 6 — Update integration tests
- [x] Step 7 — Validation and cleanup

## Step Details

### Step 1 — Remove `isWrapped` gate from `RunBuilder.runSync`

In `src/lib/builder.ts`:

- Remove the `isWrapped` constraint from the type-level gate for `runSync()`.
- Keep the `canSync` restriction enforced through conditional parameter typing so bound root exports still typecheck cleanly.
- Remove the runtime `if (!this.#state.isWrapped)` check (lines 164-168).
- Keep the `canSync: true` constraint and runtime check — `runSync` is still incompatible with `retry()`, `timeout()`, and `signal()`.

### Step 2 — Remove `isWrapped` gate from `RunBuilder.gen`

In `src/lib/builder.ts`:

- Remove the `isWrapped` constraint from the type-level gate for `gen()`.
- Keep the `canSync` restriction enforced through conditional parameter typing so bound root exports still typecheck cleanly.
- Remove the runtime `if (!this.#state.isWrapped)` check (lines 202-206).
- Keep the `canSync: true` constraint and runtime check.

### Step 3 — Remove dead `BuilderErrors` constants

In `src/lib/types/builder.ts`:

- Remove `GEN_REQUIRES_WRAP` and `RUN_SYNC_REQUIRES_WRAP` from `BuilderErrors` — they are no longer referenced.
- Update `GEN_UNAVAILABLE` and `RUN_SYNC_UNAVAILABLE` messages if the "start a new wrap() chain" wording no longer makes sense.

### Step 4 — Bind `runSync` and `gen` from root in `src/index.ts`

Replace standalone re-exports:

```ts
// Before
export { runSync } from "./lib/executors/run-sync"
export { executeGen as gen } from "./lib/executors/gen"

// After
export const runSync: RunBuilder["runSync"] = root.runSync.bind(root)
export const gen: RunBuilder["gen"] = root.gen.bind(root)
```

The standalone `runSync` function in `run-sync.ts` and `executeGen` in `gen.ts` remain — they're still used internally by `executeRunSync` and the builder's `gen` implementation.

### Step 5 — Update type tests

In `src/__tests__/types.test.ts`:

- The "wrap() returns a builder that exposes runSync() and gen()" test (lines 109-118) should be updated — these are no longer wrap-exclusive capabilities.
- Consider renaming or restructuring tests that assert `runSync`/`gen` are only available after `wrap()`.

### Step 6 — Update integration tests

In `src/__tests__/index.test.ts`:

- Existing `try$.runSync(...)` tests (lines 31-111) should pass as-is — they now go through the builder but behavior is identical when no wraps are configured.
- Existing `try$.gen(...)` tests (lines 1109-1199) should also pass as-is.
- The `try$.wrap(...).runSync(...)` and `try$.wrap(...).gen(...)` tests should remain unchanged.

### Step 7 — Validation and cleanup

- `bun run format`
- `bun run check`
- `bun run typecheck`
- `bun run test`

## Completion Notes

- Completed on March 6, 2026.
- Root `runSync` and `gen` now bind from `RunBuilder` in `src/index.ts`.
- Async-only chains created by `retry()`, `timeout()`, and `signal()` still reject `runSync()` and `gen()` at both the type level and runtime.
- Validation passed with `bun run format`, `bun run check`, `bun run typecheck`, and `bun run test`.

## Open Concern: BaseExecution Overhead for No-Config Calls

The builder's `runSync` goes through `RunSyncExecution` which extends `BaseExecution`. The `BaseExecution` constructor always creates a `SignalController` and `TimeoutController`, even when no signals/timeout are configured. The current standalone `runSync` has zero overhead — it's just a plain try/catch.

After this change, `try$.runSync(() => 42)` would create those controller objects (plus a disposable scope) on every call, even though they're unused. Same applies to `gen`.

**Options to address later:**

1. **Accept the overhead** — It's trivial object allocation. Simplicity wins.
2. **Short-circuit in the builder** — When `config` has no wraps, retry, timeout, or signals, delegate directly to the standalone implementations (skip `BaseExecution` entirely). This preserves the zero-overhead fast path for the common case.
3. **Lazy controller creation in `BaseExecution`** — Only create `SignalController`/`TimeoutController` when the config actually has signals or timeout. This benefits all executors, not just `runSync`/`gen`.

Option 3 is probably the best long-term fix. It could be addressed as part of a `BaseExecution` optimization pass.
