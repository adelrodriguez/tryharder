A better try for your functions

```ts
import * as try$ from "hardtry"

const signal = new AbortController().signal
const myFn = () => "value"
class MyErr extends Error {}

const value = try$
  .retry(3) // provide a retry policy
  .timeout(1000) // timeout for full execution scope
  .signal(signal) // cancel with an abort signal
  .run({
    try: () => myFn(), // run the function
    catch: (_e) => new MyErr(), // map the error
  })

// You can also do
const result = try$.run(() => myFn())
```

Retries can be very specific:

```ts
try$.retry(3) // Retry a specific number of times with linear backoff
try$.retry({ limit: 3, delayMs: 1000, backoff: "exponential" }) // Specific policy
try$.retry({
  limit: 3,
  delayMs: 250,
  backoff: "exponential",
  shouldRetry: (error) => !(error instanceof try$.TimeoutError),
}) // Predicate-based retryability

// Create reusable policies

const retryPolicy = try$.retryOptions({
  limit: 3,
  delayMs: 300,
  backoff: "exponential",
})

const value = try$.retry(retryPolicy).run({
  try: () => myFn(),
  catch: (_e) => new MyErr(),
})
```

Timeouts are total-scoped in v1:

```ts
try$.timeout(1000) // Scope covers all attempts, backoff delays, and catch execution
try$.timeout({ ms: 1000, scope: "total" })
```

Provide an abort controller signal to the execution:

```ts
const abortController = new AbortController()

try$.signal(abortController.signal).run({
  try: (ctx) => fetchUser(user.id),
  catch: (error) => error,
})
```

Or pass the abort signal from the internal function:

```ts
try$.timeout(3000).run({
  try: (ctx) => fetchUser(user.id, { signal: ctx.signal }),
  catch: (error) => error,
})
```

## Generator

```ts
const getUser = (id: string): Promise<User | UserNotFound> =>
  Promise.resolve(
    try$.run({
      try: () => fetchUser(id),
      catch: () => new UserNotFound(id),
    })
  )

const getProject = (id: string): Promise<Project | ProjectNotFound> =>
  Promise.resolve(
    try$.run({
      try: () => fetchProject(id),
      catch: () => new ProjectNotFound(id),
    })
  )

const value = try$.gen(function* (use) {
  // Use "use" to unwrap the return value
  const user = yield* use(getUser("123"))
  const project = yield* use(getProject(user.id))

  return project
})

// value is Project | UserNotFound | ProjectNotFound
```

## Disposer

```ts
await using disposer = try$.dispose()
const conn = await connectDb()
// Pass the disposer to the resource
disposer.use(conn)
// Defer functionality for disposal
disposer.defer(() => console.log("cleanup"))
```

## `Promise.all` alternatives

```ts
import * as try$ from "hardtry"

const result = try$.all({
  async a() {
    return getA()
  },
  async b() {
    return getB()
  },
  async c() {
    return getC(await this.$result.a)
  },
})
```

Access abort signal and disposer:

```ts
import * as try$ from "hardtry"

const result = try$
  .timeout(5000)
  .signal(signal)
  .all({
    async a() {
      return getA({ signal: this.$signal })
    },
    async b() {
      const conn = await getDbConnection()
      this.$disposer.defer(() => conn.close())
      return getB(conn)
    },
    async c() {
      return getC(await this.$result.a)
    },
  })
```

Use `Promise.allSettled`:

```ts
const result = try$
  .timeout(5000)
  .signal(signal)
  .allSettled({
    async a() {
      return getA({ signal: this.$signal })
    },
    async b() {
      const conn = await getDbConnection()
      this.$disposer.defer(() => conn.close())
      return getB(conn)
    },
    async c() {
      return getC(await this.$result.a)
    },
  })
```

## Task Orchestration

```ts
const value = try$.flow({
  async cache() {
    const data = await cache.get(key)

    if (data) return this.$exit(data)

    return null
  },
  async api() {
    await this.$result.cache // Await cache to resolve

    const res = await fetch("...", { signal: this.$signal }) // Access to abort signal

    return res
  },
  async process() {
    const rawData = await this.$result.api

    return this.$exit(transformData(rawData))
  },
})

// The type of value is a union of the return types of all returns with $this.exit()
```

Internally, `this.$exit()` throws so we interrupt the flow.

We type values return by `this.$exit` with `FlowExit<T>` so we can extract them from the union.

## Extensibility

Wrap runner execution with custom functions. Wrap is only intended to wrap logic around your function execution:

```ts
try$
  .wrap(span("fetchUser")) // Add a telemetry span trace
  .run({
    try: () => fetchUser("1"),
    catch: (error) => error,
  })

try$
  .wrap(logTiming()) // Add logs for function execution
  .run({
    try: () => fetchUser("1"),
    catch: (error) => error,
  })
```

Wrap has access to the `TryCtx` so you are able to access information about your function run:

```ts
try$
  .retry(3)
  .wrap((ctx) => logAttempts(ctx.retry.attempt))
  .run({
    try: () => fetchUser("1"),
    catch: (error) => error,
  })
```
