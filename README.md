<div align="center">
    <h1 align="center">🔁 <code>hardtry</code></h1>
  <p align="center">
    <strong>Structured, composable execution for TypeScript with retry, timeout, cancellation, and task orchestration.</strong>
  </p>
</div>

`hardtry` gives you a small fluent API for failure-aware execution. You can run sync/async work, map failures, compose retries and timeouts, orchestrate task maps, and early-exit flow pipelines.

```ts
import * as try$ from "hardtry"

const result = await try$
  .retry(3)
  .timeout(1_000)
  .run({
    try: async () => fetch("https://example.com"),
    catch: () => new Error("request failed"),
  })
```

<details>
<summary>Table of Contents</summary>

- [Features](#features)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Quick Start](#quick-start)
- [Usage](#usage)
  - [run and runSync](#run-and-runsync)
  - [retry timeout signal wrap](#retry-timeout-signal-wrap)
  - [all and allSettled](#all-and-allsettled)
  - [flow and exit](#flow-and-exit)
  - [gen](#gen)
  - [dispose](#dispose)
- [API Reference](#api-reference)
- [Notes](#notes)
- [Contributing](#contributing)
- [License](#license)

</details>

## Features

- Immutable fluent builder (`retry`, `timeout`, `signal`)
- Top-level wrap builder (`wrap().wrap()`) for terminal APIs
- Sync and async execution (`runSync`, `run`)
- Typed failure mapping in object-form `run({ try, catch })`
- Parallel task execution with dependency access via `this.$result`
- Flow orchestration with early-exit via `this.$exit(value)`
- Resource cleanup with `AsyncDisposableStack`
- Typed generator composition through `gen`

## Installation

```bash
# bun
bun add hardtry

# npm
npm install hardtry

# pnpm
pnpm add hardtry

# yarn
yarn add hardtry
```

## Core Concepts

| Term                  | Meaning                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| `run`                 | Async entrypoint that returns `Promise<value \| error>`                            |
| `runSync`             | Sync entrypoint for sync-only execution                                            |
| `retry(limit)`        | Retry policy, where `limit` includes the first attempt                             |
| `timeout(ms)`         | Total execution timeout (attempts + delays + catch)                                |
| `signal(abortSignal)` | External cancellation integration                                                  |
| `wrap(fn)`            | Top-level middleware builder for `run`, `runSync`, `all`, `allSettled`, and `flow` |
| `all(tasks)`          | Fail-fast parallel named tasks                                                     |
| `allSettled(tasks)`   | Settled parallel named tasks                                                       |
| `flow(tasks)`         | Task orchestration with early exit                                                 |

## Quick Start

```ts
import * as try$ from "hardtry"

const value = await try$.run({
  try: async () => {
    return "ok"
  },
  catch: () => "mapped-error",
})

// value: "ok" | "mapped-error"
```

## Usage

### run and runSync

Function form maps thrown errors to `UnhandledException`.

```ts
const syncValue = try$.runSync(() => 42)

const asyncValue = await try$.run(async () => 42)
```

Object form lets you map failures with `catch`.

```ts
const result = await try$.run({
  try: async () => {
    throw new Error("boom")
  },
  catch: () => "fallback" as const,
})

// "fallback"
```

### retry timeout signal wrap

```ts
const controller = new AbortController()

const result = await try$
  .retry({ backoff: "constant", delayMs: 50, limit: 3 })
  .timeout(1_000)
  .signal(controller.signal)
  .run(async (ctx) => {
    return `attempt-${ctx.retry.attempt}`
  })

const wrapped = await try$.wrap((ctx, next) => next(ctx)).run(async () => "ok")

// wrap is top-level only
// valid: try$.wrap(w1).wrap(w2).all(...)
// invalid: try$.retry(3).wrap(w1)
// retry/timeout apply to run()/runSync() only
// valid: try$.signal(controller.signal).all(...)
// invalid: try$.timeout(1_000).all(...)
```

### all and allSettled

Fail-fast parallel tasks:

```ts
const values = await try$.all({
  a() {
    return 1
  },
  async b() {
    const a = await this.$result.a
    return a + 1
  },
})

// { a: 1, b: 2 }
```

Settled mode:

```ts
const settled = await try$.allSettled({
  fail() {
    throw new Error("boom")
  },
  ok() {
    return 1
  },
})
```

### flow and exit

`flow` is ideal for dependent pipeline steps where you may short-circuit early.

Cache hit (early exit in task `a`):

```ts
const cacheHit = await try$.flow({
  a() {
    const cached: string | null = "cached-value"

    if (cached !== null) {
      return this.$exit(cached)
    }

    return null
  },
  async b() {
    return "api-value"
  },
  async c() {
    const apiValue = await this.$result.b
    return this.$exit(`${apiValue}-transformed`)
  },
})

// "cached-value"
```

Cache miss (continue to API + transform):

```ts
const cacheMiss = await try$.flow({
  a() {
    const cached: string | null = null

    if (cached !== null) {
      return this.$exit(cached)
    }

    return null
  },
  async b() {
    return "api-value"
  },
  async c() {
    const apiValue = await this.$result.b
    return this.$exit(`${apiValue}-transformed`)
  },
})

// "api-value-transformed"
```

### gen

```ts
const value = await try$.gen(function* (use) {
  const a = yield* use(try$.run(() => 1))
  const b = yield* use(try$.run(() => a + 1))
  return b
})
```

### dispose

```ts
await using disposer = try$.dispose()

disposer.defer(() => {
  // cleanup
})
```

## API Reference

### Runtime exports

From `hardtry`:

- `retry`
- `allSettled`
- `timeout`
- `signal`
- `wrap`
- `run`
- `runSync`
- `all`
- `flow`
- `dispose`
- `gen`
- `retryOptions`

From `hardtry/errors`:

- `CancellationError`
- `TimeoutError`
- `RetryExhaustedError`
- `UnhandledException`
- `Panic`

```ts
import * as try$ from "hardtry"
import { Panic, TimeoutError, UnhandledException } from "hardtry/errors"
```

### Common signatures

- `run(tryFn)` -> `Promise<T | UnhandledException | ConfigErrors>`
- `run({ try, catch })` -> `Promise<T | C | ConfigErrors>`
- `runSync(tryFn)` -> `T | UnhandledException`
- `all(tasks)` -> `Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>`
- `allSettled(tasks)` -> settled result map
- `flow(tasks)` -> `Promise<FlowExitUnion>`

## Notes

- Retry `limit` includes the first attempt.
- Timeout scope is total execution.
- `retry()` and `timeout()` only compose with `run()` / `runSync()`. Use nested `run()` calls inside orchestration tasks for leaf policies.
- Error classes and `PanicCode` are exported from `hardtry/errors`.
- `flow` requires at least one `$exit(...)` path; otherwise it throws.
- Control outcomes have precedence over mapped catch results in racing scenarios.
- `wrap` is only available from `try$.wrap(...)` and can be chained as `.wrap().wrap()`.
- Programmer-error paths throw `Panic`, not a returned error value.
- `Panic` exposes a `code` for machine-readable diagnostics.

### Panic codes

- `WRAP_UNAVAILABLE`
- `WRAP_INVALID_HANDLER`
- `RUN_SYNC_UNAVAILABLE`
- `RUN_SYNC_INVALID_INPUT`
- `FLOW_NO_EXIT`
- `GEN_UNAVAILABLE`
- `GEN_INVALID_FACTORY`
- `RUN_SYNC_WRAPPED_RESULT_PROMISE`
- `RUN_SYNC_TRY_PROMISE`
- `RUN_SYNC_CATCH_PROMISE`
- `RUN_SYNC_ASYNC_RETRY_POLICY`
- `RUN_CATCH_HANDLER_THROW`
- `RUN_CATCH_HANDLER_REJECT`
- `RUN_SYNC_CATCH_HANDLER_THROW`
- `ALL_CATCH_HANDLER_THROW`
- `ALL_CATCH_HANDLER_REJECT`
- `TASK_INVALID_HANDLER`
- `TASK_SELF_REFERENCE`
- `TASK_UNKNOWN_REFERENCE`
- `UNREACHABLE_RETRY_POLICY_BACKOFF`

## Contributing

Contributions are welcome. Please run:

```bash
bun run format
bun run check
bun run typecheck
bun run test
```

## License

[MIT](LICENSE)

Made with [pastry](https://github.com/adelrodriguez/pastry)
