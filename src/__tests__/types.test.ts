import { describe, it } from "bun:test"
import * as try$ from "../index"

type Expect<T extends true> = T
type Equal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false
const typecheckOnly = (): boolean => false

describe("type inference", () => {
  describe("no config", () => {
    it("runSync sync function returns T | UnhandledException", () => {
      const result = try$.runSync(() => 42)
      type _assert = Expect<Equal<typeof result, number | try$.UnhandledException>>
    })

    it("run function returns Promise<T | UnhandledException>", () => {
      const result = try$.run(() => 42)
      type _assert = Expect<Equal<typeof result, Promise<number | try$.UnhandledException>>>
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
          // @ts-expect-error retry metadata is only available after calling retry()
          void ctx.retry.attempt
          return 42
        })
      }
    })

    it("ctx.retry is not available with timeout/signal/wrap alone", () => {
      if (typecheckOnly()) {
        void try$.timeout(100).run((ctx) => {
          // @ts-expect-error retry metadata is only available after retry()
          void ctx.retry.attempt
          return 1
        })

        void try$.signal(new AbortController().signal).run((ctx) => {
          // @ts-expect-error retry metadata is only available after retry()
          void ctx.retry.attempt
          return 1
        })

        void try$
          .wrap((ctx, next) => next(ctx))
          .run((ctx) => {
            // @ts-expect-error retry metadata is only available after retry()
            void ctx.retry.attempt
            return 1
          })
      }
    })
  })

  describe("with retry", () => {
    it("constant zero-delay retry run returns Promise union", () => {
      const result = try$.retry(3).run(() => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.RetryExhaustedError>>
      >
    })

    it("retry run returns Promise union", () => {
      const result = try$.retry(3).run(() => Promise.resolve(42))
      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.RetryExhaustedError>>
      >
    })

    it("ctx.retry is available when retry config is present", () => {
      const result = try$.retry(3).run((ctx) => ctx.retry.attempt)
      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.RetryExhaustedError>>
      >
    })

    it("ctx.retry supports async usage when retry config is present", () => {
      const result = try$.retry(3).run((ctx) => Promise.resolve(ctx.retry.limit))
      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.RetryExhaustedError>>
      >
    })
  })

  describe("with timeout", () => {
    it("run function returns Promise<T | UnhandledException | TimeoutError>", () => {
      const result = try$.timeout(5000).run(() => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.TimeoutError>>
      >
    })
  })

  describe("with signal", () => {
    it("run function returns Promise<T | UnhandledException | CancellationError>", () => {
      const ac = new AbortController()
      const result = try$.signal(ac.signal).run(() => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.CancellationError>>
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
          Promise<number | try$.UnhandledException | try$.RetryExhaustedError | try$.TimeoutError>
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
          Promise<number | try$.UnhandledException | try$.RetryExhaustedError | try$.TimeoutError>
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
          Promise<
            42 | "err" | try$.RetryExhaustedError | try$.TimeoutError | try$.CancellationError
          >
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
          Promise<
            number | "err" | try$.RetryExhaustedError | try$.TimeoutError | try$.CancellationError
          >
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
            | number
            | try$.UnhandledException
            | try$.RetryExhaustedError
            | try$.TimeoutError
            | try$.CancellationError
          >
        >
      >
    })
  })

  describe("wrap capabilities", () => {
    it("wrap builder exposes runSync", () => {
      const result = try$.wrap((ctx, next) => next(ctx)).runSync(() => 42)
      type _assert = Expect<Equal<typeof result, number | try$.UnhandledException>>
    })

    it("wrap builder still exposes run", () => {
      const result = try$.wrap((ctx, next) => next(ctx)).run(() => 42)
      type _assert = Expect<Equal<typeof result, Promise<number | try$.UnhandledException>>>
    })

    it("wrap builder exposes retry", () => {
      if (typecheckOnly()) return

      const result = try$
        .wrap((ctx, next) => next(ctx))
        .retry(3)
        .run((ctx) => ctx.retry.attempt)

      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.RetryExhaustedError>>
      >
    })

    it("wrap builder exposes timeout", () => {
      if (typecheckOnly()) return

      const result = try$
        .wrap((ctx, next) => next(ctx))
        .timeout(100)
        .run(() => 1)

      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.TimeoutError>>
      >
    })

    it("wrap builder exposes signal", () => {
      if (typecheckOnly()) return

      const result = try$
        .wrap((ctx, next) => next(ctx))
        .signal(new AbortController().signal)
        .run(() => 1)

      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.CancellationError>>
      >
    })

    it("retry chain exposes wrap", () => {
      if (typecheckOnly()) return

      const result = try$
        .retry(3)
        .wrap((ctx, next) => next(ctx))
        .run((ctx) => ctx.retry.attempt)

      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.RetryExhaustedError>>
      >
    })

    it("wrap builder exposes gen", () => {
      const result = try$
        .wrap((ctx, next) => next(ctx))
        .gen(function* (use) {
          const value = yield* use(1)
          return value + 1
        })

      type _assert = Expect<Equal<typeof result, number>>
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
            // @ts-expect-error unknown task key is not available on $result
            void this.$result.missing
            return 2
          },
        })
      }
    })

    it("rejects non-function task entries", () => {
      if (typecheckOnly()) {
        void try$.all({
          // @ts-expect-error all() tasks must be functions
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
            // @ts-expect-error unknown task key is not available on $result
            void this.$result.missing
            return 2
          },
        })
      }
    })

    it("rejects non-function task entries in settled mode", () => {
      if (typecheckOnly()) {
        void try$.allSettled({
          // @ts-expect-error allSettled() tasks must be functions
          a: 1,
          b() {
            return 2
          },
        })
      }
    })

    it("does not accept catch options in settled mode", () => {
      if (typecheckOnly()) {
        // @ts-expect-error catch is only available for fail-fast all()
        void try$.allSettled({ a: () => 42 }, { catch: () => "mapped" as const })
      }
    })

    it("removes settled mode selector from namespace and chains", () => {
      if (typecheckOnly()) {
        // @ts-expect-error settled() was removed in favor of allSettled()
        void try$.settled

        // @ts-expect-error settled() was removed in favor of allSettled()
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
    it("retry + timeout + signal + all preserves task result map", () => {
      if (typecheckOnly()) return

      const ac = new AbortController()

      const result = try$
        .retry(3)
        .timeout(1000)
        .signal(ac.signal)
        .all({
          a() {
            return 1
          },
          async b() {
            return (await this.$result.a) + 1
          },
        })

      type _assert = Expect<Equal<typeof result, Promise<{ a: 1; b: number }>>>
    })

    it("timeout + signal + allSettled preserves settled map", () => {
      if (typecheckOnly()) return

      const ac = new AbortController()

      const result = try$
        .timeout(1000)
        .signal(ac.signal)
        .allSettled({
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
  })
})
