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

`tryharder` is a small execution layer for TypeScript. It keeps plain functions, object-shaped task definitions, and familiar control flow, but makes failure and execution policy explicit in the API surface.

Use it when `try/catch` starts absorbing too many concerns at once: retries, deadlines, cancellation, failure mapping, and orchestration. Instead of letting those concerns stay hidden in ambient `throw` paths, `tryharder` returns them as typed values and composes them around a single operation or a task graph.

It is deliberately narrower than a full effect runtime. You keep writing normal functions, but the return type tells you which values, mapped failures, and policy-level failures can come back from execution.

```ts
import * as try$ from "tryharder"

class RequestFailedError extends Error {}

const result = await try$
  .retry(3) // Retry up to 3 times total, including the first attempt
  .timeout(5_000) // Enforce one total deadline across attempts
  .run({
    try: async () => {
      const order = await db.orders.findById("ord_123")

      if (order === null) {
        throw new Error("order not found")
      }

      return order.status
    },
    catch: () => new RequestFailedError("request failed"),
  })

// result is OrderStatus | RequestFailedError | TimeoutError
```

<details>
<summary>Table of Contents</summary>

- [Why not plain try/catch?](#why-not-plain-trycatch)
- [Features](#features)
- [Installation](#installation)
- [Migration from hardtry](#migration-from-hardtry)
- [Execution Model](#execution-model)
- [Type Semantics](#type-semantics)
- [Quick Start](#quick-start)
- [Orchestration Semantics](#orchestration-semantics)
- [Usage](#usage)
  - [run and runSync](#run-and-runsync)
  - [retry, timeout, signal](#retry-timeout-signal)
  - [wrap](#wrap)
  - [all and allSettled](#all-and-allsettled)
  - [flow and $exit](#flow-and-exit)
  - [gen](#gen)
- [disposer](#disposer)
- [API Reference](#api-reference)
- [Common Recipes](#common-recipes)
- [When not to use tryharder](#when-not-to-use-tryharder)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

</details>

## Why not plain try/catch?

Plain `try/catch` works well for isolated code, but it scales poorly when one block starts carrying retry loops, cancellation wiring, timeout tracking, and domain error mapping at the same time.

```ts
class UserUnavailableError extends Error {}

async function loadUser(signal: AbortSignal) {
  let lastError: unknown

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const timeout = AbortSignal.timeout(1_500)
    const combined = AbortSignal.any([signal, timeout])

    try {
      const user = await db.users.findById("user_123", {
        signal: combined,
      })

      if (user === null) {
        throw new Error("user not found")
      }

      return user
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

With `tryharder`, the execution policy is declared outside the work and the failure shape becomes part of the returned type:

```ts
class UserUnavailableError extends Error {}

const controller = new AbortController()

const result = await try$
  .retry(3)
  .timeout(1_500)
  .signal(controller.signal)
  .run({
    try: async ({ signal }) => {
      const user = await db.users.findById("user_123", { signal })

      if (user === null) {
        throw new Error("user not found")
      }

      return user
    },
    catch: () => new UserUnavailableError("user service unavailable"),
  })

// result is
// User | UserUnavailableError | TimeoutError | CancellationError
```

That is the core shift:

- Plain `try/catch` hides control flow and failure policy inside implementation details.
- `tryharder` exposes execution policy in the builder chain and failure shape in the return type.
- `run(fn)` returns `T | UnhandledException`.
- `run({ try, catch })` returns `T | C`.
- Adding `timeout(...)` and `signal(...)` widens the union with `TimeoutError` and `CancellationError`.
- Adding `retry(...)` changes how persistent failure is reported: with `catch`, the last attempt's error is mapped by `catch`; without `catch`, it surfaces as `RetryExhaustedError` (last error as `cause`) instead of `UnhandledException`.

## Features

- **Explicit failure unions** - Model thrown failures as values in the returned type instead of an invisible side channel.
- **Execution policies** - Add retries, total deadlines, and cancellation around a unit of work without rewriting the work itself.
- **Sync and async parity** - Use the same mental model for `runSync(...)` and `run(...)`.
- **Named task orchestration** - Express concurrent and ordered workflows with object-shaped task graphs instead of positional arrays.
- **Observable execution hooks** - Add top-level instrumentation with `wrap(...)` without changing task behavior.
- **Resource cleanup** - Register teardown that survives async boundaries with `disposer()` and task disposers.
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

## Execution Model

`tryharder` has three layers: terminal execution APIs, policy builders, and orchestration APIs.

Terminal execution APIs are `run(...)` and `runSync(...)`. They are the points where work is actually executed and a result union is produced. Function form is the minimal shape and returns `T | UnhandledException`. Object form adds a `catch` mapper and returns `T | C`.

Policy builders decorate terminal execution. `retry(...)`, `timeout(...)`, and `signal(...)` do not run work by themselves; they configure the next terminal call and widen the resulting union with the policy-level failures they can introduce. `retry(limit)` counts the first attempt. `timeout(ms)` applies one total deadline across attempts, delays, and catch handling. `signal(abortSignal)` forwards external cancellation into execution.

Orchestration APIs scale the same model from one operation to a task graph. `all(...)` runs a fail-fast named task map. `allSettled(...)` preserves every settled task outcome. `flow(...)` runs an ordered workflow that must explicitly terminate through `this.$exit(...)`.

`wrap(...)` sits above those execution APIs as observational middleware. It can inspect readonly execution context and surround terminal calls, but it is not available after `retry(...)`, `timeout(...)`, or execution-scoped `signal(...)` chains. `gen(...)` offers a more linear way to compose returned unions. `disposer()` provides cleanup registration for work that spans async boundaries.

| Term                  | Meaning                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `run`                 | Async terminal execution that returns a value, mapped failure, or policy error |
| `runSync`             | Sync terminal execution for synchronous work only                              |
| `retry(limit)`        | Retry policy; `limit` is a positive integer counting the first attempt         |
| `timeout(ms)`         | Total execution timeout across attempts, delays, and catch handling            |
| `signal(abortSignal)` | External cancellation for `run(...)` and root-level orchestration              |
| `wrap(fn)`            | Top-level observational middleware around terminal APIs                        |
| `all(tasks)`          | Fail-fast parallel named task graph                                            |
| `allSettled(tasks)`   | Settled parallel named task graph                                              |
| `flow(tasks)`         | Ordered task workflow with explicit early exit                                 |
| `$exit(value)`        | Stop a `flow(...)` early and return `value`                                    |

Not sure if `tryharder` is a good fit for your project? See [When not to use tryharder](#when-not-to-use-tryharder).

## Type Semantics

`tryharder` treats failure as part of the return type. The important distinction is not just that failures are represented as values, but that builder chains preserve which layer introduced them.

- Domain failures are the values you map yourself with object-form `run({ try, catch })`.
- Runtime policy failures are introduced by `retry(...)`, `timeout(...)`, and `signal(...)`.
- Programmer misuse is represented by `Panic`, which is thrown for invalid API usage and invariant violations rather than returned as a domain result.

```ts
import * as try$ from "tryharder"

class ValidationError extends Error {}

const result = await try$
  .retry(2)
  .timeout(250)
  .run({
    try: async () => {
      throw new Error("boom")
    },
    catch: () => new ValidationError("invalid input"),
  })

// result is
// ValidationError | TimeoutError
```

That inferred union is the contract. A caller can see whether a function returns a domain error and whether a deadline may fire, without reading the implementation body.

The `catch` contract is strict: `catch` maps errors that originated inside `try` — thrown directly, or carried out of the retry loop as the last attempt's error once the retry policy gives up. Policy outcomes (`TimeoutError`, `CancellationError`) never pass through `catch`; they surface typed in the union so you can handle them at the call site:

```ts
if (result instanceof TimeoutError) {
  // deadline expired; map or handle it here
}
```

Without `catch`, unmapped failures are wrapped: `RetryExhaustedError` when a retry policy gave up (for any reason — limit exhausted or `shouldRetry` declining), `UnhandledException` otherwise. The original error is always available as `cause`.

`Panic` is intentionally separate from that model. It signals programmer errors such as invalid builder usage or invalid task graphs, not expected business-domain failures.

One implementation detail worth knowing: `retry(...)` and `timeout(...)` switch the builder onto an execution-only surface. At both the type level and runtime, orchestration methods such as `all(...)`, `allSettled(...)`, `flow(...)`, and `wrap(...)` are not available from those execution-scoped builders. Root-level `signal(...)` still supports orchestration.

## Quick Start

Use function form when thrown failures should be preserved as `UnhandledException` values:

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

In practice, you usually declare policy first and execute last:

```ts
class UpstreamUnavailableError extends Error {}

const result = await try$
  .retry({ backoff: "constant", delayMs: 100, limit: 3 })
  .timeout(1_500)
  .run({
    try: async () => {
      const account = await db.accounts.findById("acct_123")

      if (account === null) {
        throw new Error("account missing")
      }

      return account
    },
    catch: () => new UpstreamUnavailableError("account store unavailable"),
  })
```

## Orchestration Semantics

Use `run(...)` and `runSync(...)` for a single unit of work. Use `all(...)` or `allSettled(...)` when you want a concurrent task map with named dependencies. Use `flow(...)` when you need a stepwise workflow with explicit early return.

`all(...)` runs an object-shaped task graph and resolves to one object of successful results. Named tasks are easier to scan than positional arrays, and tasks can await earlier task results through `this.$result`. Execution is fail-fast: once one task fails, sibling task signals are aborted and the orchestration rejects unless you provide an orchestration-level `catch`.

```ts
const result = await try$.all({
  user() {
    return { id: "1", name: "Ada" }
  },
  async profile() {
    const user = await this.$result.user
    return { userId: user.id, plan: "pro" as const }
  },
})
```

`allSettled(...)` uses the same task-graph shape, but preserves every task outcome as settled data. Use it when failure is expected input to the next decision rather than something that should short-circuit the whole graph.

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

`flow(...)` is for dependent business-process style workflows. Tasks still read through `this.$result`, but completion is explicit: at least one path must call `this.$exit(...)`. That makes early return a visible part of the workflow contract instead of an implicit convention.

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

## Usage

### run and runSync

Use `run(...)` and `runSync(...)` for leaf operations where you want execution and failure semantics attached directly to one function call.

Use function form when `UnhandledException` is an acceptable failure value:

```ts
const syncValue = try$.runSync(() => 42)

const asyncValue = await try$.run(async () => {
  return 42
})
```

Use object form when you want to map failures into domain results yourself:

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

Use these when execution policy belongs around a single unit of work. They decorate `run(...)` or `runSync(...)`, widen the returned union, and keep policy separate from business logic.

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

Apply `signal(...)` on the root builder when you want cancellation to cover `all(...)`, `allSettled(...)`, or `flow(...)`.

### wrap

Use `wrap(...)` for logging, tracing, metrics, or other instrumentation that should observe execution without mutating it.

```ts
const result = await try$
  .wrap((ctx, next) => {
    console.log("starting attempt", ctx.retry.attempt)
    return next()
  })
  .wrap((_ctx, next) => next())
  .run(async () => "ok")
```

`wrap(...)` is top-level only and can be chained as `.wrap().wrap()`. It is not available after `retry(...)`, `timeout(...)`, or execution-scoped `signal(...)`.

### all and allSettled

Use `all(...)` and `allSettled(...)` for concurrent work where named tasks and dependency reads are clearer than positional concurrency helpers.

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

Use `all(...)` when you want one successful combined value or one failure path. Use `allSettled(...)` when every outcome should be preserved for inspection.

### flow and $exit

Use `flow(...)` for procedural workflows where steps depend on prior results and an explicit early return is part of the design.

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

At least one path must call `this.$exit(...)`. If no task exits, `flow(...)` throws `Panic`.

### gen

Use `gen(...)` when the returned unions are correct but nested handling becomes visually noisy and you want a more linear composition style.

```ts
const value = await try$.gen(function* (use) {
  const a = yield* use(try$.run(() => 1))
  const b = yield* use(try$.run(() => a + 1))
  return b
})
```

### disposer

Use `disposer()` when cleanup should stay colocated with the workflow that allocates the resource, even across async boundaries. The returned `AsyncDisposer` gives you three operations:

- `defer(fn)` registers a cleanup callback.
- `use(resource)` tracks a disposable resource.
- `dispose()` runs the registered teardown in reverse order (also triggered by leaving an `await using` scope).

```ts
await using disposer = try$.disposer()

{
  const connection = await db.connect()

  disposer.defer(async () => {
    await connection.close()
  })

  const user = await connection.users.findById("user_123")
}
```

`tryharder` handles the cleanup bookkeeping internally, so native `DisposableStack` or `AsyncDisposableStack` globals are not required.

## API Reference

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
| `Panic`               | Thrown for programmer errors and invalid API usage                                                        |

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

## Common Recipes

### Map infrastructure failure into domain error

Use object-form `run(...)` when transport or infrastructure failures should be normalized into a domain-level result.

```ts
class PaymentUnavailableError extends Error {}

const result = await try$.run({
  try: async () => {
    const payment = await db.payments.findById("pay_123")

    if (payment === null) {
      throw new Error("payment missing")
    }

    return payment
  },
  catch: () => new PaymentUnavailableError("payments unavailable"),
})
```

### Retry only the leaf request inside a flow

`retry(...)` and `timeout(...)` do not apply directly to `flow(...)`. Wrap the leaf work in nested `run(...)` calls when a single step needs its own execution policy.

```ts
const result = await try$.flow({
  async fetchUser() {
    const user = await try$.retry(2).run(async () => {
      const row = await db.users.findById("user_123")

      if (row === null) {
        throw new Error("user missing")
      }

      return row
    })

    return this.$exit(user)
  },
})
```

### Choose all vs allSettled

Use `all(...)` when the workflow should stop on the first failure:

```ts
const strict = await try$.all({
  config() {
    return { region: "us-east-1" as const }
  },
  async client() {
    const config = await this.$result.config
    return connect(config)
  },
})
```

Use `allSettled(...)` when failure is data you want to inspect:

```ts
const observed = await try$.allSettled({
  primary() {
    return db.reports.readFromPrimary("daily-active-users")
  },
  replica() {
    return db.reports.readFromReplica("daily-active-users")
  },
})
```

### Use signal at the root for orchestration cancellation

Root-level `signal(...)` propagates cancellation through orchestration APIs.

```ts
const controller = new AbortController()

const result = await try$.signal(controller.signal).all({
  async a() {
    return db.users.findById("user_123", { signal: this.$signal })
  },
  async b() {
    return db.accounts.findById("acct_123", { signal: this.$signal })
  },
})
```

### Choose object-form run vs function-form run

Use function-form `run(...)` when `UnhandledException` is an acceptable boundary type:

```ts
const value = await try$.run(async () => {
  return JSON.parse('{"ok":true}')
})
```

Use object-form `run(...)` when callers should receive domain-specific failures instead:

```ts
class InvalidPayloadError extends Error {}

const value = await try$.run({
  try: () => JSON.parse("not-json"),
  catch: () => new InvalidPayloadError("payload was invalid"),
})
```

## When not to use

When you can use [`Effect`](https://github.com/Effect-TS/effect) in your codebase.

Seriously, Effect is a much more powerful and complete solution.

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
