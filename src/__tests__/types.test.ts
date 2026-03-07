import { describe, it } from "bun:test"
import type {
  CancellationError,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../errors"
import type { RetryOptions, RetryPolicy } from "../lib/types/retry"
import * as try$ from "../index"

type Expect<T extends true> = T
type Equal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false
const typecheckOnly = (): boolean => false

describe("type inference", () => {
  describe("no config", () => {
    it("runSync sync function returns T | UnhandledException", () => {
      const result = try$.runSync(() => 42)
      type _assert = Expect<Equal<typeof result, number | UnhandledException>>
    })

    it("run function returns Promise<T | UnhandledException>", () => {
      const result = try$.run(() => 42)
      type _assert = Expect<Equal<typeof result, Promise<number | UnhandledException>>>
    })

    it("runSync sync try/catch returns T | E", () => {
      const result = try$.runSync({ catch: () => "err" as const, try: () => 42 })
      type _assert = Expect<Equal<typeof result, number | "err">>
    })

    it("run async try with sync catch returns Promise<T | E>", () => {
      const result = try$.run({ catch: () => "err" as const, try: () => Promise.resolve(42) })
      type _assert = Expect<Equal<typeof result, Promise<number | "err">>>
    })

    it("ctx.retry is not available without retry config", () => {
      if (typecheckOnly()) {
        void try$.run((ctx) => {
          // @ts-expect-error -- retry metadata is only available after calling retry()
          void ctx.retry.attempt
          return 42
        })
      }
    })

    it("ctx.retry is not available with timeout/signal/wrap alone", () => {
      if (typecheckOnly()) {
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
          .wrap((ctx, next) => next())
          .run((ctx) => {
            // @ts-expect-error -- retry metadata is only available after retry()
            void ctx.retry.attempt
            return 1
          })
      }
    })

    it("wrap ctx is read-only and next does not accept ctx", () => {
      if (typecheckOnly()) {
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
    })
  })

  describe("builder entrypoints", () => {
    it("retryOptions is exposed from the root entrypoint", () => {
      const normalizeRetry = try$.retryOptions

      type _assert = Expect<Equal<typeof normalizeRetry, (policy: RetryOptions) => RetryPolicy>>
    })

    it("retry(number) preserves runSync() with retry error union", () => {
      const retryBuilder = try$.retry(3)
      const result = retryBuilder.run(() => 1)
      const syncResult = retryBuilder.runSync((ctx) => ctx.retry.attempt)

      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >
      type _assertSync = Expect<
        Equal<typeof syncResult, number | UnhandledException | RetryExhaustedError>
      >

      if (typecheckOnly()) {
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
    })

    it("retry(policy) returns an async-only builder with retry error union", () => {
      const retryBuilder = try$.retry({ backoff: "constant", delayMs: 1, limit: 3 })
      const result = retryBuilder.run(() => 1)

      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >

      if (typecheckOnly()) {
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
    })

    it("timeout() returns an async-only builder with timeout error union", () => {
      const timeoutBuilder = try$.timeout(100)
      const result = timeoutBuilder.run(() => 1)

      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | TimeoutError>>
      >

      if (typecheckOnly()) {
        // @ts-expect-error -- orchestration is unavailable after timeout()
        void timeoutBuilder.all
        // @ts-expect-error -- orchestration is unavailable after timeout()
        void timeoutBuilder.allSettled
        // @ts-expect-error -- orchestration is unavailable after timeout()
        void timeoutBuilder.flow
        // @ts-expect-error -- wrap() is unavailable after retry(), timeout(), or signal()
        void timeoutBuilder.wrap
      }
    })

    it("signal() returns an async-only builder with cancellation error union", () => {
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

      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | CancellationError>>
      >
      type _assertAll = Expect<Equal<typeof allResult, Promise<{ a: 1; b: 1 }>>>
      type _assertSettled = Expect<
        Equal<typeof settledResult, Promise<{ a: try$.SettledResult<"ok"> }>>
      >
      type _assertFlow = Expect<Equal<typeof flowResult, Promise<"done">>>

      if (typecheckOnly()) {
        // @ts-expect-error -- wrap() is unavailable after retry(), timeout(), or signal()
        void signalBuilder.wrap
      }
    })

    it("wrap() preserves runSync() availability", () => {
      const wrappedBuilder = try$.wrap((ctx, next) => next())
      const syncResult = wrappedBuilder.runSync(() => 1)

      type _assertSync = Expect<Equal<typeof syncResult, number | UnhandledException>>

      if (typecheckOnly()) {
        // @ts-expect-error -- gen() is unavailable after wrap()
        void wrappedBuilder.gen
      }
    })

    it("timeout()/signal() builders do not expose runSync()", () => {
      if (typecheckOnly()) {
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
    })
  })

  describe("with retry", () => {
    it("constant zero-delay retry run returns Promise union", () => {
      const result = try$.retry(3).run(() => 42)

      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >
    })

    it("retry run returns Promise union", () => {
      const result = try$.retry(3).run(() => Promise.resolve(42))

      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >
    })

    it("ctx.retry is available when retry config is present", () => {
      const result = try$.retry(3).run((ctx) => ctx.retry.attempt)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >
    })

    it("ctx.retry supports async usage when retry config is present", () => {
      const result = try$.retry(3).run((ctx) => Promise.resolve(ctx.retry.limit))
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >
    })
  })

  describe("with timeout", () => {
    it("run function returns Promise<T | UnhandledException | TimeoutError>", () => {
      const result = try$.timeout(5000).run(() => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | TimeoutError>>
      >
    })
  })

  describe("with signal", () => {
    it("run function returns Promise<T | UnhandledException | CancellationError>", () => {
      const ac = new AbortController()
      const result = try$.signal(ac.signal).run(() => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | CancellationError>>
      >
    })
  })

  describe("combined configs", () => {
    it("retry + timeout run returns Promise union", () => {
      const result = try$
        .retry(3)
        .timeout(5000)
        .run(() => 42)
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<number | UnhandledException | RetryExhaustedError | TimeoutError>
        >
      >
    })

    it("retry + timeout async returns Promise union via run", () => {
      const result = try$
        .retry(3)
        .timeout(5000)
        .run(() => Promise.resolve(42))
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<number | UnhandledException | RetryExhaustedError | TimeoutError>
        >
      >
    })

    it("all three with run keeps Promise union when retry is sync-safe", () => {
      const ac = new AbortController()
      const result = try$
        .retry(3)
        .timeout(5000)
        .signal(ac.signal)
        .run({ catch: () => "err" as const, try: () => 42 as const })
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<42 | "err" | RetryExhaustedError | TimeoutError | CancellationError>
        >
      >
    })

    it("all three with async catch uses run and returns Promise union", () => {
      const ac = new AbortController()
      const result = try$
        .retry(3)
        .timeout(5000)
        .signal(ac.signal)
        .run({ catch: () => "err" as const, try: () => Promise.resolve(42) })
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<number | "err" | RetryExhaustedError | TimeoutError | CancellationError>
        >
      >
    })

    it("retry metadata remains available across timeout/signal chain", () => {
      const result = try$
        .retry(3)
        .timeout(100)
        .signal(new AbortController().signal)
        .run((ctx) => ctx.retry.attempt)

      type _assert = Expect<
        Equal<
          typeof result,
          Promise<
            number | UnhandledException | RetryExhaustedError | TimeoutError | CancellationError
          >
        >
      >
    })
  })

  describe("builder chaining", () => {
    it("wrap builder exposes runSync", () => {
      const result = try$.wrap((ctx, next) => next()).runSync(() => 42)
      type _assert = Expect<Equal<typeof result, number | UnhandledException>>
    })

    it("wrap builder still exposes run", () => {
      const result = try$.wrap((ctx, next) => next()).run(() => 42)
      type _assert = Expect<Equal<typeof result, Promise<number | UnhandledException>>>
    })

    it("wrap builder exposes retry", () => {
      if (typecheckOnly()) return

      const result = try$
        .wrap((ctx, next) => next())
        .retry(3)
        .run((ctx) => ctx.retry.attempt)

      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >
    })

    it("wrap builder exposes timeout", () => {
      if (typecheckOnly()) return

      const result = try$
        .wrap((ctx, next) => next())
        .timeout(100)
        .run(() => 1)

      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | TimeoutError>>
      >
    })

    it("wrap builder exposes signal", () => {
      if (typecheckOnly()) return

      const result = try$
        .wrap((ctx, next) => next())
        .signal(new AbortController().signal)
        .run(() => 1)

      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | CancellationError>>
      >
    })

    it("retry chain does not expose wrap", () => {
      if (typecheckOnly()) {
        // @ts-expect-error -- wrap is top-level only and not available after retry()
        void try$.retry(3).wrap
      }
    })

    it("wrap builder does not expose gen", () => {
      if (typecheckOnly()) {
        // @ts-expect-error -- gen is unavailable after wrap()
        void try$.wrap((ctx, next) => next()).gen
      }
    })
  })

  describe("gen", () => {
    class UserNotFound extends Error {}
    class ProjectNotFound extends Error {}
    class PermissionDenied extends Error {}

    it("returns sync union for sync yielded values", () => {
      const result = try$.gen(function* (use) {
        const value = yield* use(Math.random() > 0.5 ? 1 : new UserNotFound("missing"))
        return value
      })

      type _assert = Expect<Equal<typeof result, number | UserNotFound>>
    })

    it("returns Promise union when yielded values include Promise", () => {
      const result = try$.gen(function* (use) {
        const userId = yield* use(Promise.resolve(Math.random() > 0.5 ? 1 : new UserNotFound("u")))
        void userId
        const project = yield* use(
          Promise.resolve(Math.random() > 0.5 ? "project" : new ProjectNotFound("p"))
        )

        return project
      })

      type _assert = Expect<Equal<typeof result, Promise<string | UserNotFound | ProjectNotFound>>>
    })

    it("preserves explicit returned error values in result union", () => {
      const result = try$.gen(function* (use) {
        void (yield* use(1))
        return Math.random() > 0.5 ? "ok" : new ProjectNotFound("missing")
      })

      type _assert = Expect<Equal<typeof result, "ok" | ProjectNotFound>>
    })

    it("preserves explicit async returned error values in result union", () => {
      const result = try$.gen(function* (use) {
        void (yield* use(Promise.resolve(1)))
        return Promise.resolve(Math.random() > 0.5 ? "ok" : new ProjectNotFound("missing"))
      })

      type _assert = Expect<Equal<typeof result, Promise<string | ProjectNotFound>>>
    })

    it("composes multiple try$ run functions and accumulates their error unions", () => {
      type User = { id: string }
      type Project = { id: string }

      const getUser = () =>
        try$.run({
          catch: (error): UserNotFound | PermissionDenied => {
            if (error instanceof TypeError) {
              return new PermissionDenied("denied")
            }

            return new UserNotFound("missing user")
          },
          try: (): Promise<User> => Promise.resolve({ id: "u_1" }),
        })

      const getProject = (userId: string) =>
        try$.run({
          catch: (): ProjectNotFound => new ProjectNotFound("missing project"),
          try: (): Promise<Project> => Promise.resolve({ id: `p_${userId}` }),
        })

      const result = try$.gen(function* (use) {
        const user = yield* use(getUser())
        const project = yield* use(getProject(user.id))

        return `${user.id}:${project.id}`
      })

      type _assert = Expect<
        Equal<typeof result, Promise<string | UserNotFound | PermissionDenied | ProjectNotFound>>
      >
    })
  })

  describe("all", () => {
    it("infers result types from task return types", () => {
      if (typecheckOnly()) return

      const result = try$.all({
        a(): number {
          return 42
        },
        b(): Promise<string> {
          return Promise.resolve("hello")
        },
      })

      type _assert = Expect<Equal<typeof result, Promise<{ a: number; b: string }>>>
    })

    it("infers $result proxy types from non-self-referencing tasks", () => {
      if (typecheckOnly()) return

      void try$.all({
        a(): number {
          return 42
        },
        async b() {
          const a = this.$result.a
          const resolvedA = await this.$result.a

          type _assertProxy = Expect<Equal<typeof a, Promise<number>>>
          type _assertResolved = Expect<Equal<typeof resolvedA, number>>
          return "hello"
        },
      })
    })

    it("rejects unknown $result keys", () => {
      if (typecheckOnly()) {
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
    })

    it("rejects non-function task entries", () => {
      if (typecheckOnly()) {
        void try$.all({
          // @ts-expect-error -- all() tasks must be functions
          a: 1,
          b() {
            return 2
          },
        })
      }
    })

    it("returns success or mapped catch type when catch is provided", () => {
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

      type _assert = Expect<Equal<typeof result, Promise<{ a: number; b: string } | "mapped">>>
    })

    it("infers catch context for all", () => {
      if (typecheckOnly()) return

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

            type _assertFailedTask = Expect<Equal<typeof failedTask, "a" | "b" | undefined>>
            type _assertPartialA = Expect<Equal<typeof partialA, number | undefined>>
            type _assertSignal = Expect<Equal<typeof signal, AbortSignal>>

            return "mapped" as const
          },
        }
      )
    })
  })

  describe("allSettled", () => {
    it("infers settled result types", () => {
      if (typecheckOnly()) return

      const result = try$.allSettled({
        a(): number {
          return 42
        },
        b(): string {
          return "hello"
        },
      })

      type _assert = Expect<
        Equal<
          typeof result,
          Promise<{
            a: try$.SettledResult<number>
            b: try$.SettledResult<string>
          }>
        >
      >
    })

    it("keeps $result property types when awaited", () => {
      if (typecheckOnly()) return

      void try$.allSettled({
        a() {
          return 42
        },
        async b() {
          const a = this.$result.a
          const resolvedA = await this.$result.a

          type _assertProxy = Expect<Equal<typeof a, Promise<42>>>
          type _assertResolved = Expect<Equal<typeof resolvedA, 42>>
          return "hello"
        },
      })
    })

    it("rejects unknown $result keys in settled mode", () => {
      if (typecheckOnly()) {
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
    })

    it("rejects non-function task entries in settled mode", () => {
      if (typecheckOnly()) {
        void try$.allSettled({
          // @ts-expect-error -- allSettled() tasks must be functions
          a: 1,
          b() {
            return 2
          },
        })
      }
    })

    it("does not accept catch options in settled mode", () => {
      if (typecheckOnly()) {
        // @ts-expect-error -- catch is only available for fail-fast all()
        void try$.allSettled({ a: () => 42 }, { catch: () => "mapped" as const })
      }
    })

    it("removes settled mode selector from namespace and chains", () => {
      if (typecheckOnly()) {
        // @ts-expect-error -- settled() was removed in favor of allSettled()
        void try$.settled

        // @ts-expect-error -- settled() was removed in favor of allSettled()
        void try$.retry(3).settled
      }
    })
  })

  describe("flow", () => {
    it("infers union of $exit values", () => {
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

      type _assert = Expect<Equal<typeof result, Promise<42 | "stop">>>
    })

    it("infers never when no task uses $exit", () => {
      if (typecheckOnly()) {
        const result = try$.flow({
          a() {
            return 1
          },
          async b() {
            return (await this.$result.a) + 1
          },
        })

        type _assert = Expect<Equal<typeof result, Promise<never>>>
      }
    })
  })

  describe("combined api chains", () => {
    it("signal + all preserves task result map", () => {
      if (typecheckOnly()) return

      const result = try$.signal(new AbortController().signal).all({
        a() {
          return 1
        },
        async b() {
          return (await this.$result.a) + 1
        },
      })

      type _assert = Expect<Equal<typeof result, Promise<{ a: 1; b: number }>>>
    })

    it("signal + allSettled preserves settled map", () => {
      if (typecheckOnly()) return

      const result = try$.signal(new AbortController().signal).allSettled({
        a() {
          return 1
        },
        b() {
          return "ok"
        },
      })

      type _assert = Expect<
        Equal<
          typeof result,
          Promise<{
            a: try$.SettledResult<1>
            b: try$.SettledResult<"ok">
          }>
        >
      >
    })

    it("retry/timeout chains do not expose orchestration even after signal()", () => {
      if (typecheckOnly()) {
        const signal = new AbortController().signal

        // @ts-expect-error -- orchestration remains unavailable after retry().signal()
        void try$.retry(3).signal(signal).all
        // @ts-expect-error -- orchestration remains unavailable after timeout().signal()
        void try$.timeout(1000).signal(signal).allSettled
        // @ts-expect-error -- orchestration remains unavailable after retry().timeout().signal()
        void try$.retry(3).timeout(1000).signal(signal).flow
      }
    })
  })
})
