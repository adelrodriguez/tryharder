<div align="center">
  <h1 align="center">🔁 tryharder</h1>

  <p align="center">
    <strong>A better try/catch for TypeScript</strong>
  </p>

  <p align="center">
    <a href="https://www.npmjs.com/package/tryharder"><img src="https://img.shields.io/npm/v/tryharder" alt="npm version" /></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  </p>
</div>

Run sync and async work with retries, timeouts, cancellation, typed failure mapping, and orchestration. Use `tryharder` when plain `try/catch` starts to sprawl and you want a small execution API that scales from single calls to parallel task maps and early-exit pipelines.

```ts
import * as try$ from "tryharder"

class RequestFailedError extends Error {}

const result = await try$
  .retry(3) // Retry up to 3 times
  .timeout(5_000) // Timeout after 5 seconds
  .run({
    try: async () => {
      const response = await fetch("https://example.com")

      if (!response.ok) {
        throw new Error(`request failed: ${response.status}`)
      }

      return "ok" as const
    },
    catch: () => new RequestFailedError("request failed"),
  })

// result is "ok" | RequestFailedError | RetryExhaustedError | TimeoutError
```

<details>
<summary>Table of Contents</summary>

- [Features](#features)
- [Installation](#installation)
- [Migration from hardtry](#migration-from-hardtry)
- [Core Concepts](#core-concepts)
- [Quick Start](#quick-start)
- [Usage](#usage)
  - [run and runSync](#run-and-runsync)
  - [retry, timeout, signal](#retry-timeout-signal)
  - [wrap](#wrap)
  - [all and allSettled](#all-and-allsettled)
  - [flow and $exit](#flow-and-exit)
  - [gen](#gen)
  - [dispose](#dispose)
- [API Reference](#api-reference)
- [Common Recipes](#common-recipes)
- [When not to use tryharder](#when-not-to-use-tryharder)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

</details>

## Features

- **Composable execution policies** - Chain `retry`, `timeout`, and `signal` around work that may fail or be cancelled.
- **Typed failure mapping** - Use object-form `run({ try, catch })` to map thrown errors into domain-specific results.
- **Sync and async entrypoints** - Use `runSync` for synchronous work and `run` for asynchronous work.
- **Task orchestration** - Coordinate named task maps with `all`, `allSettled`, and `flow`.
- **Early exit control** - Short-circuit pipelines with `this.$exit(...)` in `flow`.
- **Middleware-style wrapping** - Observe execution with top-level `wrap(...).wrap(...)` chains.
- **Generator composition** - Build linear workflows over `run(...)` results with `gen(...)`.
- **Resource cleanup** - Register cleanup with `dispose()` and `AsyncDisposableStack`.
- **No runtime dependencies** - The published package ships without runtime dependencies.

## Installation

```bash
# bun
bun add tryharder

# npm
npm install tryharder

# yarn
yarn add tryharder

# pnpm
pnpm add tryharder
```

## Migration from hardtry

Replace import specifiers only:

- `hardtry` -> `tryharder`
- `hardtry/errors` -> `tryharder/errors`
- `hardtry/types` -> `tryharder/types`

You can keep the same namespace alias in your code:

```ts
import * as try$ from "tryharder"
```

No runtime API names changed.

## Core Concepts

| Term                  | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `run`                 | Async entrypoint that returns a value, a mapped failure, or config error  |
| `runSync`             | Sync entrypoint for synchronous work only                                 |
| `retry(limit)`        | Retry policy where `limit` includes the first attempt                     |
| `timeout(ms)`         | Total execution timeout across attempts, delays, and catch handling       |
| `signal(abortSignal)` | External cancellation for `run` and, from the root builder, orchestration |
| `wrap(fn)`            | Top-level middleware hook around terminal execution APIs                  |
| `all(tasks)`          | Fail-fast parallel named tasks                                            |
| `allSettled(tasks)`   | Settled parallel named tasks                                              |
| `flow(tasks)`         | Ordered task orchestration with early exit                                |
| `$exit(value)`        | Stop a `flow` early and return `value`                                    |

Not sure if `tryharder` is a good fit for your project? See [When not to use tryharder](#when-not-to-use-tryharder).

## Quick Start

Use function form when you want thrown failures normalized to `UnhandledException`:

```ts
import * as try$ from "tryharder"

const result = await try$.run(async () => {
  return "ok" as const
})

// "ok" | UnhandledException
```

Use object form when you want to map failures into domain results:

```ts
import * as try$ from "tryharder"

class ValidationError extends Error {}

const result = await try$.run({
  try: async () => {
    throw new Error("boom")
  },
  catch: () => new ValidationError("invalid input"),
})

// ValidationError
```

In a real application, you usually compose policies before the terminal call:

```ts
class UpstreamUnavailableError extends Error {}

const result = await try$
  .retry({ backoff: "constant", delayMs: 100, limit: 3 })
  .timeout(1_500)
  .run({
    try: async () => {
      const response = await fetch("https://example.com/data")

      if (!response.ok) {
        throw new Error("upstream failed")
      }

      return await response.json()
    },
    catch: () => new UpstreamUnavailableError("data service unavailable"),
  })
```

## Usage

### run and runSync

Use function form when you want thrown failures wrapped as `UnhandledException`.

```ts
const syncValue = try$.runSync(() => 42)

const asyncValue = await try$.run(async () => {
  return 42
})
```

Use object form when you want to map failures yourself.

```ts
class InvalidInputError extends Error {}
class PermissionDeniedError extends Error {}

const result = try$.runSync({
  try: () => {
    throw new SyntaxError("bad input")
  },
  catch: (error) => {
    if (error instanceof SyntaxError) {
      return new InvalidInputError("invalid")
    }

    return new PermissionDeniedError("denied")
  },
})
```

### retry, timeout, signal

Use modifiers to add retry, total timeout, and cancellation around `run(...)`. `signal(...)` can also be applied at the root builder before `all`, `allSettled`, or `flow`.

```ts
const controller = new AbortController()

const result = await try$
  .retry({ backoff: "constant", delayMs: 50, limit: 3 })
  .timeout(1_000)
  .signal(controller.signal)
  .run(async (ctx) => {
    return `attempt-${ctx.retry.attempt}`
  })
```

`timeout(ms)` measures total execution time, not just a single attempt.

### wrap

Use `wrap(...)` for observational middleware around terminal APIs. Wraps are top-level only and can be chained as `.wrap().wrap()`.

```ts
const result = await try$
  .wrap((ctx, next) => {
    console.log("starting attempt", ctx.retry.attempt)
    return next()
  })
  .wrap((_ctx, next) => next())
  .run(async () => "ok")
```

`wrap(...)` is not available after `retry(...)`, `timeout(...)`, or `signal(...)`.

### all and allSettled

Use `all(...)` for fail-fast task maps and `allSettled(...)` when you want every task result.

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

### flow and $exit

Use `flow(...)` for dependent pipelines that may short-circuit early. At least one path must call `this.$exit(...)`.

```ts
const result = await try$.flow({
  cache() {
    const cached: string | null = "cached-value"

    if (cached !== null) {
      return this.$exit(cached)
    }

    return null
  },
  async api() {
    return "api-value"
  },
  async transform() {
    const value = await this.$result.api
    return this.$exit(`${value}-transformed`)
  },
})
```

### gen

Use `gen(...)` when you want a more linear style over `run(...)` results.

```ts
const value = await try$.gen(function* (use) {
  const a = yield* use(try$.run(() => 1))
  const b = yield* use(try$.run(() => a + 1))
  return b
})
```

### dispose

Use `dispose()` to register cleanup for work that spans async boundaries.

```ts
await using disposer = try$.dispose()

disposer.defer(() => {
  console.log("cleanup")
})
```

## API Reference

### Runtime

| Export         | Description                                 |
| -------------- | ------------------------------------------- |
| `run`          | Async execution entrypoint                  |
| `runSync`      | Sync execution entrypoint                   |
| `retry`        | Create a retry policy builder               |
| `retryOptions` | Normalize retry policy input                |
| `timeout`      | Add a total execution timeout               |
| `signal`       | Add external cancellation                   |
| `wrap`         | Add top-level middleware hooks              |
| `all`          | Run fail-fast parallel named tasks          |
| `allSettled`   | Run settled parallel named tasks            |
| `flow`         | Run ordered tasks with early exit           |
| `gen`          | Compose `run(...)` calls through generators |
| `dispose`      | Create an `AsyncDisposableStack` helper     |

### Errors

Exports from `tryharder/errors`:

| Export                | Description                                               |
| --------------------- | --------------------------------------------------------- |
| `CancellationError`   | Returned or thrown when execution is externally cancelled |
| `TimeoutError`        | Returned when timed execution expires                     |
| `RetryExhaustedError` | Returned when retry attempts are exhausted                |
| `UnhandledException`  | Returned when function-form execution throws              |
| `Panic`               | Thrown for programmer errors and invalid API usage        |

### Types

Exports from `tryharder/types`:

| Export             | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `AllSettledResult` | Settled result map returned by `allSettled(...)`     |
| `SettledFulfilled` | Fulfilled branch of a settled task result            |
| `SettledRejected`  | Rejected branch of a settled task result             |
| `SettledResult`    | Union of fulfilled and rejected settled task results |
| `FlowExit`         | Exit marker type used by `flow(...)`                 |

```ts
import * as try$ from "tryharder"
import { Panic, TimeoutError, UnhandledException } from "tryharder/errors"
import type { FlowExit, SettledResult } from "tryharder/types"
```

## Common Recipes

### Retry a flaky request with timeout

```ts
const result = await try$
  .retry({ backoff: "constant", delayMs: 200, limit: 3 })
  .timeout(2_000)
  .run(async () => {
    const response = await fetch("https://example.com")
    return response.text()
  })
```

### Map thrown exceptions into domain results

```ts
class RemoteServiceError extends Error {}

const result = await try$.run({
  try: async () => {
    throw new Error("boom")
  },
  catch: () => new RemoteServiceError("service failed"),
})
```

### Run dependent parallel tasks with all

```ts
const result = await try$.all({
  async user() {
    return { id: "1", name: "Ada" }
  },
  async profile() {
    const user = await this.$result.user
    return { userId: user.id, plan: "pro" as const }
  },
})
```

### Short-circuit a pipeline with flow

```ts
const result = await try$.flow({
  cache() {
    return this.$exit("cached" as const)
  },
  async api() {
    return "remote"
  },
})
```

### Add per-task retry inside orchestration

`retry(...)` and `timeout(...)` apply to `run(...)` and `runSync(...)`, not directly to `all(...)` or `flow(...)`. When you need per-task policies, wrap leaf work in nested `run(...)` calls.

```ts
const result = await try$.flow({
  async fetchUser() {
    const user = await try$.retry(2).run(async () => {
      const response = await fetch("https://example.com/user")
      return await response.json()
    })

    return this.$exit(user)
  },
})
```

## When not to use tryharder

- **Small scripts or one-off tasks** - Plain `try/catch` is often simpler when you do not need retries, cancellation, or orchestration.
- **You already use an effect system or result abstraction** - If your codebase already has a consistent execution model, adding `tryharder` may be redundant.
- **Your workflows are mostly straightforward Promise chains** - `all(...)` and `flow(...)` help when coordination matters; otherwise native composition may be clearer.
- **Your team prefers explicit `Result` values everywhere** - `tryharder` centers execution wrappers, not a dedicated result data type.
- **You do not want policy-driven execution behavior** - If retry and timeout semantics are unnecessary overhead, the abstraction may not pay for itself.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, code quality requirements, testing expectations, and changeset guidance.

## Acknowledgments

- [`better-result`](https://github.com/dmmulroy/better-result) for typed result-oriented error handling in TypeScript.
- [`effect`](https://github.com/Effect-TS/effect) for structured, composable models of execution, failure, and concurrency.
- [`better-all`](https://github.com/shuding/better-all) for task orchestration patterns over object-shaped work graphs.
- [`errore`](https://errore.org/) for modeling errors as unions instead of tuples.

Made with [🥐 `pastry`](https://github.com/adelrodriguez/pastry)

## License

[MIT](LICENSE)
