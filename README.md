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

`tryharder` is a small execution layer for TypeScript. You write normal functions. `tryharder` runs them, applies your retry, timeout, and cancellation policy, and returns errors as typed values instead of thrown exceptions.

The return type tells you everything that can come back: your value, the failures you map, and the policy failures that your chain can introduce.

```ts
import * as try$ from "tryharder"

class OrderLookupError extends Error {}

const result = await try$
  .retry(3) // Up to 3 attempts total, including the first
  .timeout(5_000) // One total deadline across all attempts
  .run({
    try: async ({ signal }) => {
      const response = await fetch("https://api.example.com/orders/ord_123", {
        signal, // Aborts when the deadline expires
      })

      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`)
      }

      const order = (await response.json()) as { status: "pending" | "shipped" }
      return order.status
    },
    catch: () => new OrderLookupError("could not load the order"),
  })

// result is "pending" | "shipped" | OrderLookupError | TimeoutError
```

<details>
<summary>Table of contents</summary>

- [Why not plain try/catch?](#why-not-plain-trycatch)
- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [How tryharder works](#how-tryharder-works)
- [Errors as values](#errors-as-values)
- [Run one operation](#run-one-operation)
  - [run and runSync](#run-and-runsync)
  - [retry, timeout, and signal](#retry-timeout-and-signal)
  - [wrap](#wrap)
- [Run many tasks](#run-many-tasks)
  - [all](#all)
  - [allSettled](#allsettled)
  - [flow and $exit](#flow-and-exit)
- [More tools](#more-tools)
  - [gen](#gen)
  - [disposer](#disposer)
- [API reference](#api-reference)
- [Recipes](#recipes)
- [When not to use tryharder](#when-not-to-use-tryharder)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

</details>

## Why not plain try/catch?

Plain `try/catch` works well for small, isolated code. It scales poorly when one block must retry, track a deadline, handle cancellation, and map errors at the same time.

Here is one operation with all of that policy written by hand:

```ts
class UserUnavailableError extends Error {}

async function loadUser(signal: AbortSignal) {
  let lastError: unknown

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const timeout = AbortSignal.timeout(1_500)
    const combined = AbortSignal.any([signal, timeout])

    try {
      const response = await fetch("https://api.example.com/users/42", {
        signal: combined,
      })

      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`)
      }

      return (await response.json()) as { id: number; name: string }
    } catch (error) {
      lastError = error

      if (combined.aborted || attempt === 3) {
        break
      }
    }
  }

  return new UserUnavailableError("user service unavailable", {
    cause: lastError,
  })
}
```

With `tryharder`, you declare the policy outside the work. The failure shape becomes part of the return type:

```ts
class UserUnavailableError extends Error {}

const controller = new AbortController()

const result = await try$
  .retry(3)
  .timeout(1_500)
  .signal(controller.signal)
  .run({
    try: async ({ signal }) => {
      const response = await fetch("https://api.example.com/users/42", {
        signal,
      })

      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`)
      }

      return (await response.json()) as { id: number; name: string }
    },
    catch: () => new UserUnavailableError("user service unavailable"),
  })

// result is
// { id: number; name: string }
//   | UserUnavailableError
//   | TimeoutError
//   | CancellationError
```

The rules are simple:

- `run(fn)` returns `T | UnhandledException`.
- `run({ try, catch })` returns `T | C`, where `C` is what your `catch` returns.
- `timeout(...)` adds `TimeoutError` to the result type. `signal(...)` adds `CancellationError`.
- `retry(...)` changes how persistent failure is reported. With `catch`, the last attempt's error goes through `catch`. Without `catch`, you get `RetryExhaustedError` with the last error as `cause`.

You can read the failure behavior of a function from its return type. You do not have to read its body.

## Features

- **Errors as values** — Thrown errors come back as part of the return type, not through a hidden side channel.
- **Execution policies** — Add retries, one total deadline, and cancellation without changing the work itself.
- **Sync and async parity** — `runSync(...)` uses the same mental model as `run(...)`.
- **Named task orchestration** — Run concurrent and ordered workflows as named task objects, not positional arrays.
- **Instrumentation hooks** — Observe execution with `wrap(...)` for logs, traces, and metrics.
- **Resource cleanup** — Register teardown that survives async boundaries with `disposer()` and task disposers.
- **No runtime dependencies** — The published package ships without runtime dependencies.

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

### Requirements

`tryharder` needs Node.js 22 or later (declared via `engines`), or any runtime with `AbortSignal.any` and `Promise.withResolvers`. Recent Bun, Deno, and evergreen browsers qualify.

## Quick start

Run a function. Thrown errors come back as `UnhandledException` values:

```ts
import * as try$ from "tryharder"

const result = await try$.run(async () => {
  const response = await fetch("https://api.example.com/health")
  return response.status
})

// result is number | UnhandledException
```

Use the object form to map thrown errors to your own error types:

```ts
import * as try$ from "tryharder"

class InvalidConfigError extends Error {}

const config = try$.runSync({
  try: () => JSON.parse(process.env.APP_CONFIG ?? "") as { port: number },
  catch: () => new InvalidConfigError("APP_CONFIG is not valid JSON"),
})

// config is { port: number } | InvalidConfigError
```

In real code, you usually declare the policy first, run last, and handle the union where you receive it:

```ts
import * as try$ from "tryharder"
import { isTimeoutError } from "tryharder/errors"

class RateUnavailableError extends Error {}

const rate = await try$
  .retry({ backoff: "exponential", delayMs: 200, maxDelayMs: 2_000, limit: 4 })
  .timeout(10_000)
  .run({
    try: async ({ signal }) => {
      const response = await fetch("https://api.example.com/rates/EUR", {
        signal,
      })

      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`)
      }

      const data = (await response.json()) as { usd: number }
      return data.usd
    },
    catch: () => new RateUnavailableError("exchange rate service unavailable"),
  })

if (isTimeoutError(rate)) {
  // The 10 second deadline expired across all attempts.
}

if (rate instanceof RateUnavailableError) {
  // Every attempt failed. Fall back to the cached rate.
}
```

## How tryharder works

`tryharder` has three layers:

1. **Terminal APIs** run the work. `run(...)` and `runSync(...)` execute a function and produce the result union.
2. **Policy builders** configure the next terminal call. `retry(...)`, `timeout(...)`, and `signal(...)` do not run work by themselves. `timeout(...)` and `signal(...)` widen the result union with their policy failures. `retry(...)` changes the unmapped failure type only when you do not supply `catch`: persistent failure surfaces as `RetryExhaustedError` instead of `UnhandledException`.
3. **Orchestration APIs** scale the same model to a group of tasks. `all(...)` runs a fail-fast task map. `allSettled(...)` keeps every task outcome. `flow(...)` runs an ordered workflow that ends through an explicit `this.$exit(...)`.

Three more tools sit around these layers. `wrap(...)` observes execution without changing it. `gen(...)` composes result unions in a linear style. `disposer()` registers cleanup that runs when the work is done.

| Term                  | Meaning                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `run`                 | Async terminal execution that returns a value, mapped failure, or policy failure |
| `runSync`             | Sync terminal execution for synchronous work only                                |
| `retry(limit)`        | Retry policy; `limit` is a positive integer counting the first attempt           |
| `timeout(ms)`         | Total deadline: across attempts for `run(...)`, whole-graph for orchestration    |
| `signal(abortSignal)` | External cancellation for `run(...)` and root-level orchestration                |
| `wrap(fn)`            | Top-level observational middleware around terminal APIs                          |
| `all(tasks)`          | Fail-fast parallel named task graph                                              |
| `allSettled(tasks)`   | Settled parallel named task graph                                                |
| `flow(tasks)`         | Ordered task workflow with explicit early exit                                   |
| `$exit(value)`        | Stop a `flow(...)` early and return `value`                                      |
| `$race(promise)`      | Race a promise against the task's `$signal` inside orchestration                 |
| `$disposer`           | Register task cleanup that runs when the orchestration settles                   |

The chain has a fixed order. Keep these rules in mind:

- Put `wrap(...)` first. It is not available after `retry(...)`, `timeout(...)`, or an execution-scoped `signal(...)`.
- `retry(...)` removes the orchestration methods, at the type level and at runtime. A retry of a whole task graph is not meaningful. Apply `retry(...)` to `run(...)` calls inside tasks instead.
- `timeout(...)` and a root-level `signal(...)` keep orchestration available.

Not sure if `tryharder` is a good fit for your project? See [When not to use tryharder](#when-not-to-use-tryharder).

## Errors as values

`tryharder` divides failure into three kinds, and treats each one differently:

- **Domain failures** are the values you map into your own types with `catch`. They are expected outcomes of your problem domain, such as `ValidationError`.
- **Policy failures** come from the chain: `TimeoutError`, `CancellationError`, and `RetryExhaustedError`. They appear in the result union when you add the matching policy.
- **Panics** signal programmer misuse, such as an invalid builder chain or an invalid task graph. `tryharder` throws `Panic`; a panic is never part of a result union.

```ts
import * as try$ from "tryharder"

class MetricsRejectedError extends Error {}

const outcome = await try$
  .retry(2)
  .timeout(250)
  .run({
    try: async ({ signal }) => {
      const response = await fetch("https://metrics.example.com/events", {
        method: "POST",
        body: JSON.stringify({ name: "checkout_completed" }),
        signal,
      })

      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`)
      }

      return "delivered" as const
    },
    catch: () => new MetricsRejectedError("metrics endpoint rejected the event"),
  })

// outcome is
// "delivered" | MetricsRejectedError | TimeoutError
```

That inferred union is the contract. A caller can see whether a function returns a domain failure and whether a deadline can fire, without reading the implementation.

The `catch` contract is strict. `catch` maps only errors that started inside `try`: errors thrown directly, or the last attempt's error after the retry policy gives up. Policy failures never pass through `catch`. They surface typed in the union, so you handle them at the call site with the exported type guards:

```ts
import { isTimeoutError } from "tryharder/errors"

if (isTimeoutError(outcome)) {
  // The deadline expired. Map or handle it here.
}
```

Without `catch`, unmapped failures are wrapped. You get `RetryExhaustedError` when a retry policy gave up for any reason — the limit ran out or `shouldRetry` declined — and `UnhandledException` otherwise. The original error is always available as `cause`.

## Run one operation

### run and runSync

Use `run(...)` and `runSync(...)` for one operation, when you want the failure semantics attached directly to one function call.

Use the function form when `UnhandledException` is an acceptable failure value:

```ts
const link = "https://example.com/docs"

const url = try$.runSync(() => new URL(link))
// url is URL | UnhandledException

const response = await try$.run(async () => {
  return fetch("https://api.example.com/session", { method: "DELETE" })
})
// response is Response | UnhandledException
```

Use the object form to map failures into domain results yourself. The `catch` callback receives the original error, so you can map different failures to different domain types:

```ts
class MalformedRequestError extends Error {}
class UnsupportedVersionError extends Error {}

const rawBody = '{"version": 1, "items": ["sku_1", "sku_2"]}'

const body = try$.runSync({
  try: () => {
    const parsed = JSON.parse(rawBody) as { version: number; items: string[] }

    if (parsed.version !== 2) {
      throw new RangeError(`unsupported version ${parsed.version}`)
    }

    return parsed
  },
  catch: (error) => {
    if (error instanceof SyntaxError) {
      return new MalformedRequestError("body is not valid JSON")
    }

    return new UnsupportedVersionError("only version 2 is supported")
  },
})

// body is
// { version: number; items: string[] }
//   | MalformedRequestError
//   | UnsupportedVersionError
```

### retry, timeout, and signal

Use these builders to put execution policy around one unit of work. They decorate `run(...)` or `runSync(...)` and keep policy separate from business logic. `timeout(...)` and `signal(...)` widen the result union; `retry(...)` changes how persistent failure is reported.

The full retry policy controls backoff, jitter, and which errors are worth another attempt. `shouldRetry` lets the policy give up early on errors that a retry cannot fix:

```ts
class RejectedUploadError extends Error {}

const controller = new AbortController()
const backupData = JSON.stringify({ createdAt: "2026-08-12" })

const etag = await try$
  .retry({
    backoff: "exponential",
    delayMs: 100,
    maxDelayMs: 5_000,
    jitter: true,
    limit: 5,
    // Retry server errors; give up immediately when the request is rejected
    shouldRetry: (error) => !(error instanceof RejectedUploadError),
  })
  .timeout(30_000)
  .signal(controller.signal)
  .run(async ({ signal, retry }) => {
    console.log(`upload attempt ${retry.attempt} of ${retry.limit}`)

    const response = await fetch("https://api.example.com/backups", {
      method: "PUT",
      body: backupData,
      signal,
    })

    if (response.status >= 500) {
      throw new Error(`server error ${response.status}`)
    }

    if (!response.ok) {
      throw new RejectedUploadError(`rejected with status ${response.status}`)
    }

    return response.headers.get("etag")
  })
```

The function receives a context object. `signal` combines your external signal with the deadline, so one `fetch` option covers both. `retry.attempt` and `retry.limit` describe the current attempt.

`timeout(ms)` measures total execution time — attempts, delays, and `catch` handling together — not one attempt.

`runSync(...)` stays available after the numeric retry shorthand (`retry(3)`). It is not available after the object form (`retry({ ... })`) or after `timeout(...)`, because those policies can wait or interrupt, and synchronous execution cannot. This restriction is intentionally conservative: the types also block object policies that would be sync-safe at runtime. If you need retries with `runSync(...)`, use the numeric shorthand.

### wrap

Use `wrap(...)` for logging, tracing, metrics, or other instrumentation that observes execution without changing it. A wrap surrounds the whole terminal call, retries included. The context is a readonly view, and `ctx.retry.attempt` is live: after `next()` settles, it shows the final attempt count.

```ts
const results = await try$
  .wrap(async (ctx, next) => {
    const start = performance.now()

    try {
      return await next()
    } finally {
      const elapsed = Math.round(performance.now() - start)
      console.log(`settled after ${ctx.retry.attempt} attempt(s) in ${elapsed}ms`)
    }
  })
  .retry(3)
  .run(async () => {
    const response = await fetch("https://api.example.com/search?q=shoes")
    return (await response.json()) as Array<{ id: string }>
  })
```

`wrap(...)` is top-level only. You can chain it as `.wrap().wrap()`, but it is not available after `retry(...)`, `timeout(...)`, or an execution-scoped `signal(...)`.

## Run many tasks

The orchestration APIs run a group of named tasks with one policy:

- Use `all(...)` when the group should stop at the first failure.
- Use `allSettled(...)` when you want every task outcome, including failures.
- Use `flow(...)` when steps depend on earlier steps and one of them must end the workflow with `this.$exit(...)`.

Tasks are object properties, so each task has a name. A task can await an earlier task's result through `this.$result`. Each task also receives `this.$signal` for cooperative cancellation and `this.$disposer` to register cleanup that runs when the orchestration settles. Named tasks are easier to scan than positional arrays.

Orchestration supports `timeout(...)` and root-level `signal(...)`. `timeout(ms)` sets one deadline for the whole graph. When it fires, each task's `this.$signal` aborts, and the call rejects with `TimeoutError` (cancellation wins if both fire). Policy failures are thrown; an orchestration-level `catch` never maps them. `retry(...)` is not available for orchestration — apply it to `run(...)` calls inside tasks.

Cancellation is cooperative, like all cancellation in JavaScript. An aborted signal does not stop a task by itself. All three orchestration APIs wait for every in-flight task to settle before they reject. This is a structural guarantee: no task code still runs after the call returns, so a caller can safely retry after a `TimeoutError`. The same holds for `signal(...)`: the call rejects with `CancellationError` only after every in-flight task has settled. For a deadline to bound wall-clock time in practice, your tasks must observe `this.$signal` — check it between steps, pass it to signal-aware I/O such as `fetch`, or wrap an await in `this.$race(...)`. `$race` races a promise against `$signal` and rejects with the abort reason when the signal fires first.

### all

`all(...)` runs the tasks concurrently and resolves to one object of successful results. Execution is fail-fast: when one task fails, the sibling task signals abort, and the call rejects unless you provide an orchestration-level `catch`.

```ts
const page = await try$.all({
  async user() {
    const response = await fetch("https://api.example.com/me", {
      signal: this.$signal,
    })
    return (await response.json()) as { id: string; name: string }
  },
  async invoices() {
    const user = await this.$result.user

    const response = await fetch(`https://api.example.com/users/${user.id}/invoices`, {
      signal: this.$signal,
    })
    return (await response.json()) as Array<{ total: number }>
  },
})

// page is { user: { id: string; name: string }; invoices: Array<{ total: number }> }
```

### allSettled

`allSettled(...)` uses the same task-graph shape, but keeps every task outcome as settled data, in the same shape as `Promise.allSettled`. Use it when a failure is input to the next decision, not a reason to stop the whole graph.

```ts
const checks = await try$.allSettled({
  async api() {
    const response = await fetch("https://api.example.com/health")
    return response.status
  },
  async cdn() {
    const response = await fetch("https://cdn.example.com/health")
    return response.status
  },
})

if (checks.api.status === "rejected") {
  console.error("api is down:", checks.api.reason)
}

// checks.api is
// { status: "fulfilled"; value: number } | { status: "rejected"; reason: unknown }
```

### flow and $exit

Use `flow(...)` for stepwise, business-process workflows. Tasks still read earlier results through `this.$result`, but completion is explicit: at least one path must call `this.$exit(...)`. The exit is a visible part of the workflow contract, not an implicit convention.

```ts
const cache = new Map<string, string>()

const avatar = await try$.flow({
  cached() {
    const hit = cache.get("user_42")

    if (hit !== undefined) {
      return this.$exit(hit) // Cache hit: skip the remaining steps
    }

    return null
  },
  async fetched() {
    const response = await fetch("https://api.example.com/users/42", {
      signal: this.$signal,
    })

    const user = (await response.json()) as { avatarUrl: string }
    return user.avatarUrl
  },
  async stored() {
    const avatarUrl = await this.$result.fetched
    cache.set("user_42", avatarUrl)
    return this.$exit(avatarUrl)
  },
})

// avatar is string
```

If no task exits, `flow(...)` throws `Panic`.

## More tools

### gen

Use `gen(...)` when the returned unions are correct, but nested handling becomes noisy and you want a more linear composition style. `yield* use(...)` unwraps a success value and short-circuits on any error in the union:

```ts
const summary = await try$.gen(function* (use) {
  const response = yield* use(try$.run(() => fetch("https://api.example.com/orders")))
  const orders = yield* use(try$.run(() => response.json() as Promise<Array<{ total: number }>>))

  const revenue = orders.reduce((sum, order) => sum + order.total, 0)
  return `${orders.length} orders, ${revenue} total`
})

// summary is string | UnhandledException
```

### disposer

Use `disposer()` when cleanup should stay next to the workflow that allocates the resource, even across async boundaries. The returned `AsyncDisposer` gives you three operations:

- `defer(fn)` registers a cleanup callback.
- `use(resource)` tracks a disposable resource.
- `dispose()` runs the registered teardown in reverse order. Leaving an `await using` scope also triggers it.

```ts
await using disposer = try$.disposer()

const worker = new Worker("./video-encoder.js")
disposer.defer(() => worker.terminate())

const heartbeat = setInterval(() => worker.postMessage("ping"), 1_000)
disposer.defer(() => clearInterval(heartbeat))

// ... send encoding work to the worker ...

// When this scope ends — normally or through an error — the heartbeat
// stops first, then the worker terminates (reverse order).
```

`tryharder` handles the cleanup bookkeeping internally, so the native `DisposableStack` and `AsyncDisposableStack` globals are not required.

## API reference

### Runtime

| Export         | Description                                                               |
| -------------- | ------------------------------------------------------------------------- |
| `run`          | Async terminal execution API                                              |
| `runSync`      | Sync terminal execution API                                               |
| `retry`        | Create an execution-scoped retry builder                                  |
| `retryOptions` | Normalize retry policy input                                              |
| `timeout`      | Add a total execution timeout                                             |
| `signal`       | Add external cancellation to execution or root-level orchestration        |
| `wrap`         | Add top-level observational middleware                                    |
| `all`          | Run a fail-fast parallel named task graph                                 |
| `allSettled`   | Run a settled parallel named task graph                                   |
| `flow`         | Run an ordered workflow with explicit early exit                          |
| `gen`          | Compose `run(...)` results through generators                             |
| `disposer`     | Create an `AsyncDisposer` helper with `defer()`, `use()`, and `dispose()` |

### Errors

Exports from `tryharder/errors`:

| Export                | Description                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `CancellationError`   | Returned or thrown when execution is externally cancelled                                                 |
| `TimeoutError`        | Returned when timed execution expires                                                                     |
| `RetryExhaustedError` | Returned when a retry policy gives up and no `catch` is provided; the last attempt's error is the `cause` |
| `UnhandledException`  | Returned when function-form execution throws                                                              |
| `Panic`               | Thrown for programmer misuse and invalid API usage                                                        |

Each error class has a matching type guard: `isCancellationError`, `isTimeoutError`, `isRetryExhaustedError`, `isUnhandledException`, and `isPanic`. Prefer the guards over `instanceof` — they also match by `error.name`, so they keep working when two copies of `tryharder` end up in one dependency graph, or when errors cross realm boundaries, where `instanceof` silently fails.

```ts
import { isTimeoutError } from "tryharder/errors"

const result = await try$.timeout(1_000).run(async () => {
  const response = await fetch("https://api.example.com/me")
  return (await response.json()) as { name: string }
})

if (isTimeoutError(result)) {
  // handle the deadline here
}
```

### Types

Exports from `tryharder/types`:

| Export             | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `AllSettledResult` | Settled result map returned by `allSettled(...)`     |
| `AsyncDisposer`    | Async cleanup helper returned by `disposer()`        |
| `SettledFulfilled` | Fulfilled branch of a settled task result            |
| `SettledRejected`  | Rejected branch of a settled task result             |
| `SettledResult`    | Union of fulfilled and rejected settled task results |
| `FlowExit`         | Exit marker type used by `flow(...)`                 |

```ts
import * as try$ from "tryharder"
import { Panic, TimeoutError, UnhandledException } from "tryharder/errors"
import type { AsyncDisposer, FlowExit, SettledResult } from "tryharder/types"
```

## Recipes

### Map infrastructure failure into a domain failure

Use the object form of `run(...)` when transport or infrastructure failures should reach callers as one domain-level result:

```ts
class PaymentUnavailableError extends Error {}

const payment = await try$.run({
  try: async () => {
    const response = await fetch("https://payments.example.com/charges/ch_123")

    if (!response.ok) {
      throw new Error(`unexpected status ${response.status}`)
    }

    return (await response.json()) as { amount: number; captured: boolean }
  },
  catch: () => new PaymentUnavailableError("payment provider unavailable"),
})

// Callers see one domain failure, not fetch internals:
// { amount: number; captured: boolean } | PaymentUnavailableError
```

### Retry only the leaf request inside a flow

`retry(...)` does not apply to `flow(...)`, and `timeout(...)` applies to the whole graph, not one step. When one step needs its own policy, wrap the leaf work in a nested `run(...)`:

```ts
const result = await try$.flow({
  async shipment() {
    const label = await try$.retry(2).run(async () => {
      const response = await fetch("https://api.example.com/labels", {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`)
      }

      return (await response.json()) as { trackingNumber: string }
    })

    return this.$exit(label)
  },
})
```

### Choose all vs allSettled

Use `all(...)` when the result is useless unless every task succeeds:

```ts
const checkout = await try$.all({
  async cart() {
    const response = await fetch("https://api.example.com/cart")
    return (await response.json()) as { items: string[] }
  },
  async shipping() {
    const response = await fetch("https://api.example.com/shipping-options")
    return (await response.json()) as Array<{ carrier: string }>
  },
})
```

Use `allSettled(...)` when failure is data you want to inspect:

```ts
const report = await try$.allSettled({
  async primary() {
    const response = await fetch("https://db-1.example.com/reports/daily")
    return response.json()
  },
  async replica() {
    const response = await fetch("https://db-2.example.com/reports/daily")
    return response.json()
  },
})

// Serve from whichever source responded.
```

### Cancel a whole orchestration from the root

A root-level `signal(...)` propagates cancellation through the orchestration APIs. Abort one controller to stop every task:

```ts
const controller = new AbortController()

// Cancel the whole page load when the user navigates away
window.addEventListener("popstate", () => controller.abort())

const data = await try$.signal(controller.signal).all({
  async posts() {
    const response = await fetch("https://api.example.com/posts", {
      signal: this.$signal,
    })
    return response.json()
  },
  async comments() {
    const response = await fetch("https://api.example.com/comments", {
      signal: this.$signal,
    })
    return response.json()
  },
})
```

### Wrap signal-unaware work in $race

Some work cannot take an `AbortSignal`, such as a legacy client or driver. Wrap the await in `this.$race(...)` so graph deadlines and cancellation still bound how long the task runs. Note that `$race` hands control back to the orchestration; it cannot stop the underlying work, so the abandoned promise keeps running in the background.

```ts
async function buildReport(legacy: { generateReport(): Promise<{ rows: number }> }) {
  return try$.timeout(5_000).all({
    async report() {
      // generateReport() cannot take a signal, so race it against the deadline
      return await this.$race(legacy.generateReport())
    },
  })
}
```

### Choose object-form run vs function-form run

Use the function form when `UnhandledException` is an acceptable boundary type:

```ts
const value = await try$.run(async () => {
  return JSON.parse('{"ok":true}')
})
```

Use the object form when callers should receive domain-specific failures instead:

```ts
class InvalidPayloadError extends Error {}

const value = await try$.run({
  try: () => JSON.parse("not-json"),
  catch: () => new InvalidPayloadError("payload was invalid"),
})
```

## When not to use tryharder

When you can use [`Effect`](https://github.com/Effect-TS/effect) in your codebase.

Seriously, Effect is a much more powerful and complete solution.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, code quality requirements, testing expectations, and changeset guidance.

## Acknowledgments

- [`better-result`](https://github.com/dmmulroy/better-result) for typed result-oriented error handling in TypeScript.
- [`effect`](https://github.com/Effect-TS/effect) for structured, composable models of execution, failure, and concurrency.
- [`better-all`](https://github.com/shuding/better-all) for task orchestration patterns over object-shaped work graphs.
- [`errore`](https://errore.org/) for modeling errors as unions instead of tuples.

Made with [🥐 `pastry`](https://github.com/adelrodriguez/pastry)

## License

[MIT](LICENSE)
