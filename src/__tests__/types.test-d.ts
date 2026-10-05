// Compile-time checks only: `pnpm run check` enforces this file, and Vitest never runs it.
import type {
  CancellationError,
  PanicCode,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../errors"
import type {
  AllSettledResult,
  AsyncDisposer,
  FlowExit,
  SettledFulfilled,
  SettledRejected,
  SettledResult,
} from "../types"
import {
  isCancellationError,
  isPanic,
  isRetryExhaustedError,
  isTimeoutError,
  isUnhandledException,
  Panic,
} from "../errors"
import * as try$ from "../index"

// ── Helpers ──────────────────────────────────────────────────────────────────
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type Expect<T extends true> = T

// ── Test fixtures ────────────────────────────────────────────────────────────
class UserNotFoundError extends Error {
  override name = "UserNotFoundError"
}

class ProjectNotFoundError extends Error {
  override name = "ProjectNotFoundError"
}

class PermissionDeniedError extends Error {
  override name = "PermissionDeniedError"
}

// ── Positive type-level tests ────────────────────────────────────────────────
// Returns T | UnhandledException from runSync() with a sync function.
{
  const result = try$.runSync(() => 42)

  type _RunSyncResult = Expect<Equal<typeof result, number | UnhandledException>>
}

// Returns Promise<T | UnhandledException> from run() with a function.
{
  const result = try$.run(() => 42)

  type _RunResult = Expect<Equal<typeof result, Promise<number | UnhandledException>>>
}

// Returns T | E from runSync() with sync try and catch.
{
  const result = try$.runSync({ catch: () => "err" as const, try: () => 42 })

  type _RunSyncCatchResult = Expect<Equal<typeof result, number | "err">>
}

// Returns Promise<T | E> from run() with async try and sync catch.
{
  const result = try$.run({ catch: () => "err" as const, try: () => Promise.resolve(42) })

  type _RunCatchResult = Expect<Equal<typeof result, Promise<number | "err">>>
}

// Returns AsyncDisposer from disposer().
{
  const disposer = try$.disposer()

  type _Disposer = Expect<Equal<typeof disposer, AsyncDisposer>>
}

// Exposes only defer, use, and dispose on AsyncDisposer.
{
  const disposer = try$.disposer()
  const disposeResult = disposer.dispose()

  type _DisposeResult = Expect<Equal<typeof disposeResult, Promise<void>>>
  type _DeferResult = Expect<Equal<ReturnType<typeof disposer.defer>, void>>
  type _DisposerKeys = Expect<
    Equal<keyof AsyncDisposer, "defer" | "dispose" | "use" | typeof Symbol.asyncDispose>
  >
}

// Keeps runSync() on retry(number) builders and adds RetryExhaustedError.
{
  const retryBuilder = try$.retry(3)
  const result = retryBuilder.run(() => 1)
  const syncResult = retryBuilder.runSync((ctx) => ctx.retry.attempt)

  type _RunResult = Expect<Equal<typeof result, Promise<number | RetryExhaustedError>>>
  type _RunSyncResult = Expect<Equal<typeof syncResult, number | RetryExhaustedError>>
}

// Adds RetryExhaustedError to retry(policy) builder results.
{
  const retryBuilder = try$.retry({ backoff: "constant", delayMs: 1, limit: 3 })
  const result = retryBuilder.run(() => 1)

  type _RunResult = Expect<Equal<typeof result, Promise<number | RetryExhaustedError>>>
}

// Adds TimeoutError to timeout() run results and keeps orchestration results.
{
  const timeoutBuilder = try$.timeout(100)
  const result = timeoutBuilder.run(() => 1)
  const allResult = timeoutBuilder.all({
    a() {
      return 1 as const
    },
    async b() {
      return await this.$result.a
    },
  })
  const settledResult = timeoutBuilder.allSettled({
    a() {
      return "ok" as const
    },
  })
  const flowResult = timeoutBuilder.flow({
    a() {
      return this.$exit("done" as const)
    },
  })

  type _RunResult = Expect<
    Equal<typeof result, Promise<number | UnhandledException | TimeoutError>>
  >
  type _AllResult = Expect<Equal<typeof allResult, Promise<{ a: 1; b: 1 }>>>
  type _SettledResult = Expect<Equal<typeof settledResult, Promise<{ a: SettledResult<"ok"> }>>>
  type _FlowResult = Expect<Equal<typeof flowResult, Promise<"done">>>
}

// Adds CancellationError to signal() run results and keeps orchestration results.
{
  const signalBuilder = try$.signal(new AbortController().signal)
  const result = signalBuilder.run(() => 1)
  const allResult = signalBuilder.all({
    a() {
      return 1 as const
    },
    async b() {
      return await this.$result.a
    },
  })
  const settledResult = signalBuilder.allSettled({
    a() {
      return "ok" as const
    },
  })
  const flowResult = signalBuilder.flow({
    a() {
      return this.$exit("done" as const)
    },
  })

  type _RunResult = Expect<
    Equal<typeof result, Promise<number | UnhandledException | CancellationError>>
  >
  type _AllResult = Expect<Equal<typeof allResult, Promise<{ a: 1; b: 1 }>>>
  type _SettledResult = Expect<Equal<typeof settledResult, Promise<{ a: SettledResult<"ok"> }>>>
  type _FlowResult = Expect<Equal<typeof flowResult, Promise<"done">>>
}

// Exposes AsyncDisposer on orchestration task contexts.
{
  void try$.all({
    a() {
      const disposer = this.$disposer

      type _AllDisposer = Expect<Equal<typeof disposer, AsyncDisposer>>

      return 1
    },
  })

  void try$.allSettled({
    a() {
      const disposer = this.$disposer

      type _AllSettledDisposer = Expect<Equal<typeof disposer, AsyncDisposer>>

      return 1
    },
  })

  void try$.flow({
    a() {
      const disposer = this.$disposer

      type _FlowDisposer = Expect<Equal<typeof disposer, AsyncDisposer>>

      return this.$exit("done" as const)
    },
  })
}

// Keeps runSync() available after wrap().
{
  const wrappedBuilder = try$.wrap((_, next) => next())
  const syncResult = wrappedBuilder.runSync(() => 1)

  type _RunSyncResult = Expect<Equal<typeof syncResult, number | UnhandledException>>
}

// Narrows unknown values through the error type guards.
{
  const value: unknown = new Panic("FLOW_NO_EXIT")

  if (isPanic(value)) {
    type _Panic = Expect<Equal<typeof value, Panic>>
    type _PanicCode = Expect<Equal<typeof value.code, PanicCode>>
  }

  if (isCancellationError(value)) {
    type _CancellationError = Expect<Equal<typeof value, CancellationError>>
  }

  if (isRetryExhaustedError(value)) {
    type _RetryExhaustedError = Expect<Equal<typeof value, RetryExhaustedError>>
  }

  if (isUnhandledException(value)) {
    type _UnhandledException = Expect<Equal<typeof value, UnhandledException>>
  }

  const result = "ok" as string | TimeoutError

  if (isTimeoutError(result)) {
    type _TimeoutError = Expect<Equal<typeof result, TimeoutError>>
  } else {
    type _NotTimeoutError = Expect<Equal<typeof result, string>>
  }
}

// Accepts non-literal retry limits and leaves validation to runtime.
{
  void try$.retry(1 as number)
}

// Accepts union-typed retry policies.
{
  const unionBuilder = try$.retry(
    Math.random() > 0.5 ? 3 : { backoff: "constant" as const, limit: 5 }
  )
  const result = unionBuilder.run(() => 1)

  type _RunResult = Expect<Equal<typeof result, Promise<number | RetryExhaustedError>>>
}

// Unwraps an async retry result into the Promise union.
{
  const result = try$.retry(3).run(() => Promise.resolve(42))

  type _RunResult = Expect<Equal<typeof result, Promise<number | RetryExhaustedError>>>
}

// Exposes retry attempt and limit on ctx when retry config is present.
{
  void try$.retry(3).run((ctx) => {
    const { retry, signal } = ctx

    type _Retry = Expect<Equal<typeof retry, { attempt: number; limit: number }>>
    type _Signal = Expect<Equal<typeof signal, AbortSignal | undefined>>

    return retry.attempt
  })
}

// Returns a Promise union from retry() + timeout() run().
{
  const result = try$
    .retry(3)
    .timeout(5000)
    .run(() => 42)

  type _RunResult = Expect<
    Equal<typeof result, Promise<number | RetryExhaustedError | TimeoutError>>
  >
}

// Returns a Promise union from retry() + timeout() run() with an async function.
{
  const result = try$
    .retry(3)
    .timeout(5000)
    .run(() => Promise.resolve(42))

  type _RunResult = Expect<
    Equal<typeof result, Promise<number | RetryExhaustedError | TimeoutError>>
  >
}

// Replaces RetryExhaustedError with the catch type for retry() + timeout() + signal().
{
  const ac = new AbortController()
  const result = try$
    .retry(3)
    .timeout(5000)
    .signal(ac.signal)
    .run({ catch: () => "err" as const, try: () => 42 as const })

  type _RunResult = Expect<
    Equal<typeof result, Promise<42 | "err" | TimeoutError | CancellationError>>
  >
}

// Returns a Promise union for retry() + timeout() + signal() with async try and catch.
{
  const ac = new AbortController()
  const result = try$
    .retry(3)
    .timeout(5000)
    .signal(ac.signal)
    .run({ catch: () => "err" as const, try: () => Promise.resolve(42) })

  type _RunResult = Expect<
    Equal<typeof result, Promise<number | "err" | TimeoutError | CancellationError>>
  >
}

// Keeps retry metadata available across timeout() and signal() chains.
{
  const result = try$
    .retry(3)
    .timeout(100)
    .signal(new AbortController().signal)
    .run((ctx) => ctx.retry.attempt)

  type _RunResult = Expect<
    Equal<typeof result, Promise<number | RetryExhaustedError | TimeoutError | CancellationError>>
  >
}

// Keeps run() available on wrap() builders.
{
  const result = try$.wrap((_, next) => next()).run(() => 42)

  type _RunResult = Expect<Equal<typeof result, Promise<number | UnhandledException>>>
}

// Exposes retry() on wrap() builders.
{
  const result = try$
    .wrap((_, next) => next())
    .retry(3)
    .run((ctx) => ctx.retry.attempt)

  type _RunResult = Expect<Equal<typeof result, Promise<number | RetryExhaustedError>>>
}

// Exposes timeout() on wrap() builders.
{
  const result = try$
    .wrap((_, next) => next())
    .timeout(100)
    .run(() => 1)

  type _RunResult = Expect<
    Equal<typeof result, Promise<number | UnhandledException | TimeoutError>>
  >
}

// Exposes signal() on wrap() builders.
{
  const result = try$
    .wrap((_, next) => next())
    .signal(new AbortController().signal)
    .run(() => 1)

  type _RunResult = Expect<
    Equal<typeof result, Promise<number | UnhandledException | CancellationError>>
  >
}

// Returns a sync union from gen() for sync yielded values.
{
  const result = try$.gen(function* (use) {
    const value = yield* use(Math.random() > 0.5 ? 1 : new UserNotFoundError("missing"))
    return value
  })

  type _GenResult = Expect<Equal<typeof result, number | UserNotFoundError>>
}

// Returns a Promise union from gen() when yielded values include a Promise.
{
  const result = try$.gen(function* (use) {
    const userId = yield* use(Promise.resolve(Math.random() > 0.5 ? 1 : new UserNotFoundError("u")))
    void userId
    const project = yield* use(
      Promise.resolve(Math.random() > 0.5 ? "project" : new ProjectNotFoundError("p"))
    )

    return project
  })

  type _GenResult = Expect<
    Equal<typeof result, Promise<string | UserNotFoundError | ProjectNotFoundError>>
  >
}

// Keeps explicit returned error values in the gen() result union.
{
  const result = try$.gen(function* (use) {
    void (yield* use(1))
    return Math.random() > 0.5 ? "ok" : new ProjectNotFoundError("missing")
  })

  type _GenResult = Expect<Equal<typeof result, "ok" | ProjectNotFoundError>>
}

// Keeps explicit async returned error values in the gen() result union.
{
  const result = try$.gen(function* (use) {
    void (yield* use(Promise.resolve(1)))
    return Promise.resolve(Math.random() > 0.5 ? "ok" : new ProjectNotFoundError("missing"))
  })

  type _GenResult = Expect<Equal<typeof result, Promise<string | ProjectNotFoundError>>>
}

// Accumulates error unions when gen() composes multiple run() functions.
{
  type User = { id: string }
  type Project = { id: string }

  const getUser = () =>
    try$.run({
      catch: (error): UserNotFoundError | PermissionDeniedError => {
        if (error instanceof TypeError) {
          return new PermissionDeniedError("denied")
        }

        return new UserNotFoundError("missing user")
      },
      try: (): Promise<User> => Promise.resolve({ id: "u_1" }),
    })

  const getProject = (userId: string) =>
    try$.run({
      catch: (): ProjectNotFoundError => new ProjectNotFoundError("missing project"),
      try: (): Promise<Project> => Promise.resolve({ id: `p_${userId}` }),
    })

  const result = try$.gen(function* (use) {
    const user = yield* use(getUser())
    const project = yield* use(getProject(user.id))

    return `${user.id}:${project.id}`
  })

  type _GenResult = Expect<
    Equal<
      typeof result,
      Promise<
        | string
        | UserNotFoundError
        | PermissionDeniedError
        | ProjectNotFoundError
        | UnhandledException
      >
    >
  >
}

// Infers all() result types from task return types.
{
  const result = try$.all({
    a(): number {
      return 42
    },
    b(): Promise<string> {
      return Promise.resolve("hello")
    },
  })

  type _AllResult = Expect<Equal<typeof result, Promise<{ a: number; b: string }>>>
}

// Infers all() $result proxy types from non-self-referencing tasks.
{
  void try$.all({
    a(): number {
      return 42
    },
    async b() {
      const a = this.$result.a
      const resolvedA = await this.$result.a

      type _Proxy = Expect<Equal<typeof a, Promise<number>>>
      type _Resolved = Expect<Equal<typeof resolvedA, number>>

      return "hello"
    },
  })
}

// Exposes $race on orchestration task contexts and maps PromiseLike to Promise.
{
  void try$.all({
    async a() {
      const like: PromiseLike<number> = Promise.resolve(1)
      const raced = this.$race(like)
      const resolved = await raced

      type _AllRaced = Expect<Equal<typeof raced, Promise<number>>>
      type _AllResolved = Expect<Equal<typeof resolved, number>>

      return resolved
    },
  })

  void try$.allSettled({
    async a() {
      const raced = this.$race(Promise.resolve("ok" as const))

      type _AllSettledRaced = Expect<Equal<typeof raced, Promise<"ok">>>

      return await raced
    },
  })

  void try$.flow({
    async a() {
      const raced = this.$race(Promise.resolve(42))

      type _FlowRaced = Expect<Equal<typeof raced, Promise<number>>>

      return this.$exit(await raced)
    },
  })
}

// Returns the success map or the catch type from all() with catch.
{
  const result = try$.all(
    {
      a(): number {
        return 42
      },
      b(): string {
        return "hello"
      },
    },
    {
      catch: () => "mapped" as const,
    }
  )

  type _AllResult = Expect<Equal<typeof result, Promise<{ a: number; b: string } | "mapped">>>
}

// Infers the all() catch context.
{
  void try$.all(
    {
      a(): number {
        return 42
      },
      b(): string {
        return "hello"
      },
    },
    {
      catch: (_error, ctx) => {
        const failedTask = ctx.failedTask
        const partialA = ctx.partial.a
        const signal = ctx.signal

        type _FailedTask = Expect<Equal<typeof failedTask, "a" | "b" | undefined>>
        type _PartialA = Expect<Equal<typeof partialA, number | undefined>>
        type _Signal = Expect<Equal<typeof signal, AbortSignal>>

        return "mapped" as const
      },
    }
  )
}

// Keeps literal task keys through all() result and catch types.
{
  const result = try$.all(
    {
      async "load-profile"() {
        const user = await this.$result["load-user"]

        type _User = Expect<Equal<typeof user, { id: "user_1" }>>

        return { displayName: "Ada" as const, userId: user.id }
      },
      "load-user"() {
        return { id: "user_1" as const }
      },
    },
    {
      catch: (_error, ctx) => {
        const failedTask = ctx.failedTask
        const partialUser = ctx.partial["load-user"]
        const partialProfile = ctx.partial["load-profile"]

        type _FailedTask = Expect<
          Equal<typeof failedTask, "load-user" | "load-profile" | undefined>
        >
        type _PartialUser = Expect<Equal<typeof partialUser, { id: "user_1" } | undefined>>
        type _PartialProfile = Expect<
          Equal<typeof partialProfile, { userId: "user_1"; displayName: "Ada" } | undefined>
        >

        return "fallback" as const
      },
    }
  )

  type _AllResult = Expect<
    Equal<
      typeof result,
      Promise<
        | {
            "load-user": { id: "user_1" }
            "load-profile": { userId: "user_1"; displayName: "Ada" }
          }
        | "fallback"
      >
    >
  >
}

// Exports settled result types from the types entrypoint.
{
  type _Fulfilled = Expect<Equal<SettledFulfilled<"ok">, { status: "fulfilled"; value: "ok" }>>
  type _Rejected = Expect<Equal<SettledRejected, { status: "rejected"; reason: unknown }>>
  type _Settled = Expect<Equal<SettledResult<"ok">, SettledFulfilled<"ok"> | SettledRejected>>
  type _AllSettled = Expect<
    Equal<
      AllSettledResult<{ a: () => Promise<number>; b: () => "ok" }>,
      { a: SettledResult<number>; b: SettledResult<"ok"> }
    >
  >
}

// Infers allSettled() result types.
{
  const result = try$.allSettled({
    a(): number {
      return 42
    },
    b(): string {
      return "hello"
    },
  })

  type _AllSettledResult = Expect<
    Equal<
      typeof result,
      Promise<{
        a: SettledResult<number>
        b: SettledResult<string>
      }>
    >
  >
}

// Keeps allSettled() $result property types when awaited.
{
  void try$.allSettled({
    a() {
      return 42
    },
    async b() {
      const a = this.$result.a
      const resolvedA = await this.$result.a

      type _Proxy = Expect<Equal<typeof a, Promise<42>>>
      type _Resolved = Expect<Equal<typeof resolvedA, 42>>

      return "hello"
    },
  })
}

// Returns FlowExit from $exit().
{
  void try$.flow({
    a() {
      const exit = this.$exit("done" as const)

      type _Exit = Expect<Equal<typeof exit, FlowExit<"done">>>

      return exit
    },
  })
}

// Infers the union of $exit() values from flow().
{
  const result = try$.flow({
    a() {
      return this.$exit(42 as const)
    },
    b() {
      if (Math.random() > 0.5) {
        return this.$exit("stop" as const)
      }

      return null
    },
  })

  type _FlowResult = Expect<Equal<typeof result, Promise<42 | "stop">>>
}

// Infers never from flow() when no task calls $exit().
{
  const result = try$.flow({
    a() {
      return 1
    },
    async b() {
      return (await this.$result.a) + 1
    },
  })

  type _FlowResult = Expect<Equal<typeof result, Promise<never>>>
}

// Keeps the task result map for signal() + all().
{
  const result = try$.signal(new AbortController().signal).all({
    a() {
      return 1
    },
    async b() {
      return (await this.$result.a) + 1
    },
  })

  type _AllResult = Expect<Equal<typeof result, Promise<{ a: 1; b: number }>>>
}

// Keeps the settled map for signal() + allSettled().
{
  const result = try$.signal(new AbortController().signal).allSettled({
    a() {
      return 1
    },
    b() {
      return "ok"
    },
  })

  type _AllSettledResult = Expect<
    Equal<
      typeof result,
      Promise<{
        a: SettledResult<1>
        b: SettledResult<"ok">
      }>
    >
  >
}

// Keeps orchestration available on timeout() + signal() chains.
{
  const signal = new AbortController().signal

  void try$.timeout(1000).signal(signal).allSettled
}

// ── Negative type tests ──────────────────────────────────────────────────────
// These verify that invalid usage produces compile-time errors.
// The function bodies never execute — only the type checker matters.

function _negativeTypeTests() {
  // Rejects non-callable values in disposer.defer().
  {
    const disposer = try$.disposer()

    // @ts-expect-error -- defer() only accepts cleanup callbacks
    disposer.defer(123)
  }

  // Hides ctx.retry without retry config.
  {
    void try$.run((ctx) => {
      // @ts-expect-error -- retry metadata is only available after calling retry()
      void ctx.retry.attempt
      return 42
    })
  }

  // Hides ctx.retry with timeout(), signal(), or wrap() alone.
  {
    void try$.timeout(100).run((ctx) => {
      // @ts-expect-error -- retry metadata is only available after retry()
      void ctx.retry.attempt
      return 1
    })

    void try$.signal(new AbortController().signal).run((ctx) => {
      // @ts-expect-error -- retry metadata is only available after retry()
      void ctx.retry.attempt
      return 1
    })

    void try$
      .wrap((_, next) => next())
      .run((ctx) => {
        // @ts-expect-error -- retry metadata is only available after retry()
        void ctx.retry.attempt
        return 1
      })
  }

  // Makes wrap ctx read-only and rejects ctx in next().
  {
    void try$.wrap((ctx, next) => {
      const wrapCtx = ctx
      // @ts-expect-error -- wrap ctx is read-only
      wrapCtx.signal = undefined
      // @ts-expect-error -- wrap retry metadata is read-only
      wrapCtx.retry.attempt = 2
      // @ts-expect-error -- wraps cannot pass ctx into next()
      return next(wrapCtx)
    })
  }

  // Hides orchestration, wrap(), and gen() after retry(number).
  {
    const retryBuilder = try$.retry(3)

    // @ts-expect-error -- orchestration is unavailable after retry()
    void retryBuilder.all
    // @ts-expect-error -- orchestration is unavailable after retry()
    void retryBuilder.allSettled
    // @ts-expect-error -- orchestration is unavailable after retry()
    void retryBuilder.flow
    // @ts-expect-error -- wrap() is unavailable after retry()
    void retryBuilder.wrap
    // @ts-expect-error -- gen() is unavailable after retry()
    void retryBuilder.gen
  }

  // Hides orchestration, wrap(), runSync(), and gen() after retry(policy).
  {
    const retryBuilder = try$.retry({ backoff: "constant", delayMs: 1, limit: 3 })

    // @ts-expect-error -- orchestration is unavailable after retry()
    void retryBuilder.all
    // @ts-expect-error -- orchestration is unavailable after retry()
    void retryBuilder.allSettled
    // @ts-expect-error -- orchestration is unavailable after retry()
    void retryBuilder.flow
    // @ts-expect-error -- wrap() is unavailable after retry()
    void retryBuilder.wrap
    // @ts-expect-error -- runSync() is unavailable after object retry()
    void retryBuilder.runSync
    // @ts-expect-error -- gen() is unavailable after retry()
    void retryBuilder.gen
  }

  // Hides wrap() after timeout().
  {
    const timeoutBuilder = try$.timeout(100)

    // @ts-expect-error -- wrap() is unavailable after retry(), timeout(), or signal()
    void timeoutBuilder.wrap
  }

  // Hides wrap() after signal().
  {
    const signalBuilder = try$.signal(new AbortController().signal)

    // @ts-expect-error -- wrap() is unavailable after retry(), timeout(), or signal()
    void signalBuilder.wrap
  }

  // Hides gen() after wrap().
  {
    const wrappedBuilder = try$.wrap((_, next) => next())

    // @ts-expect-error -- gen() is unavailable after wrap()
    void wrappedBuilder.gen
  }

  // Hides runSync() and gen() on timeout() and signal() builders.
  {
    const timeoutBuilder = try$.timeout(100)
    const signalBuilder = try$.signal(new AbortController().signal)

    // @ts-expect-error -- runSync() is unavailable after retry(), timeout(), or signal()
    void timeoutBuilder.runSync
    // @ts-expect-error -- gen() is unavailable after retry(), timeout(), or signal()
    void timeoutBuilder.gen

    // @ts-expect-error -- runSync() is unavailable after retry(), timeout(), or signal()
    void signalBuilder.runSync
    // @ts-expect-error -- gen() is unavailable after retry(), timeout(), or signal()
    void signalBuilder.gen
  }

  // Rejects invalid literal retry limits.
  {
    // @ts-expect-error -- zero is not a valid retry limit
    void try$.retry(0)

    // @ts-expect-error -- negative limits are invalid
    void try$.retry(-1)

    // @ts-expect-error -- fractional limits are invalid
    void try$.retry(2.5)

    // @ts-expect-error -- zero is not a valid retry limit in policy form
    void try$.retry({ backoff: "constant", limit: 0 })

    // @ts-expect-error -- fractional limits are invalid in policy form
    void try$.retry({ backoff: "exponential", limit: 1.5 })
  }

  // Hides runSync() for union-typed retry policies and rejects invalid union members.
  {
    const unionBuilder = try$.retry(
      Math.random() > 0.5 ? 3 : { backoff: "constant" as const, limit: 5 }
    )

    // @ts-expect-error -- runSync is unavailable when the policy may be async
    void unionBuilder.runSync

    // @ts-expect-error -- a union member with an invalid literal limit is rejected
    void try$.retry(Math.random() > 0.5 ? 0 : { backoff: "constant" as const, limit: 5 })
  }

  // Rejects unknown all() $result keys.
  {
    void try$.all({
      a() {
        return 1
      },
      b() {
        // @ts-expect-error -- unknown task key is not available on $result
        void this.$result.missing
        return 2
      },
    })
  }

  // Rejects non-function all() task entries.
  {
    void try$.all({
      // @ts-expect-error -- all() tasks must be functions
      a: 1,
      b() {
        return 2
      },
    })
  }

  // Rejects unknown allSettled() $result keys.
  {
    void try$.allSettled({
      a() {
        return 1
      },
      b() {
        // @ts-expect-error -- unknown task key is not available on $result
        void this.$result.missing
        return 2
      },
    })
  }

  // Rejects non-function allSettled() task entries.
  {
    void try$.allSettled({
      // @ts-expect-error -- allSettled() tasks must be functions
      a: 1,
      b() {
        return 2
      },
    })
  }

  // Rejects catch options in allSettled().
  {
    // @ts-expect-error -- catch is only available for fail-fast all()
    void try$.allSettled({ a: () => 42 }, { catch: () => "mapped" as const })
  }

  // Hides orchestration on retry() chains even after timeout() or signal().
  {
    const signal = new AbortController().signal

    // @ts-expect-error -- orchestration remains unavailable after retry().signal()
    void try$.retry(3).signal(signal).all
    // @ts-expect-error -- orchestration remains unavailable after retry().timeout().signal()
    void try$.retry(3).timeout(1000).signal(signal).flow
  }

  // Does not export public types from the runtime entrypoint.
  {
    // @ts-expect-error -- settled result types moved to ../types
    type _Settled = try$.SettledResult<"ok">
    // @ts-expect-error -- flow exit types moved to ../types
    type _Flow = try$.FlowExit<"done">
    // @ts-expect-error -- disposer types moved to ../types
    type _Disposer = try$.AsyncDisposer
  }
}

// Suppress unused function warning — this exists only for type checking
void _negativeTypeTests
