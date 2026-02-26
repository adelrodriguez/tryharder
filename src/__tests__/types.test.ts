/* oxlint-disable typescript/no-unnecessary-type-parameters, typescript/require-await */
import { describe, it } from "bun:test"
import * as try$ from "../index"

type Expect<T extends true> = T
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
const typecheckOnly = (): boolean => false

describe("type inference", () => {
  describe("no config", () => {
    it("runSync sync function returns T | UnhandledException", () => {
      const result = try$.runSync(() => 42)
      type _assert = Expect<Equal<typeof result, number | try$.UnhandledException>>
    })

    it("run function returns Promise<T | UnhandledException>", () => {
      const result = try$.run(async () => 42)
      type _assert = Expect<Equal<typeof result, Promise<number | try$.UnhandledException>>>
    })

    it("runSync sync try/catch returns T | E", () => {
      const result = try$.runSync({ catch: () => "err" as const, try: () => 42 })
      type _assert = Expect<Equal<typeof result, number | "err">>
    })

    it("run async try with sync catch returns Promise<T | E>", () => {
      const result = try$.run({ catch: () => "err" as const, try: async () => 42 })
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
  })

  describe("with retry", () => {
    it("constant zero-delay retry run returns Promise union", () => {
      const result = try$.retry(3).run(() => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | try$.UnhandledException | try$.RetryExhaustedError>>
      >
    })

    it("retry run returns Promise union", () => {
      const result = try$.retry(3).run(async () => 42)
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
        .run(async () => 42)
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
        .run({ catch: () => "err" as const, try: async () => 42 })
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<
            number | "err" | try$.RetryExhaustedError | try$.TimeoutError | try$.CancellationError
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

    it("retry after wrap removes runSync", () => {
      if (typecheckOnly()) {
        const afterRetry = try$.wrap((ctx, next) => next(ctx)).retry(3)
        // @ts-expect-error runSync is not available after retry()
        void afterRetry.runSync
      }
    })

    it("timeout after wrap removes runSync", () => {
      if (typecheckOnly()) {
        const afterTimeout = try$.wrap((ctx, next) => next(ctx)).timeout(100)
        // @ts-expect-error runSync is not available after timeout()
        void afterTimeout.runSync
      }
    })

    it("signal after wrap removes runSync", () => {
      if (typecheckOnly()) {
        const afterSignal = try$.wrap((ctx, next) => next(ctx)).signal(new AbortController().signal)
        // @ts-expect-error runSync is not available after signal()
        void afterSignal.runSync
      }
    })

    it("wrap after retry does not expose runSync", () => {
      if (typecheckOnly()) {
        const wrappedRetry = try$.retry(3).wrap((ctx, next) => next(ctx))
        // @ts-expect-error runSync is not available when retry is configured
        void wrappedRetry.runSync
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
          try: async (): Promise<User> => ({ id: "u_1" }),
        })

      const getProject = (userId: string) =>
        try$.run({
          catch: (): ProjectNotFound => new ProjectNotFound("missing project"),
          try: async (): Promise<Project> => ({ id: `p_${userId}` }),
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
})
