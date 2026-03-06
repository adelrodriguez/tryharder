import { describe, expect, it } from "bun:test"
import * as try$ from "../index"
import { sleep } from "../lib/utils"

class InvalidInputError extends Error {}
class PermissionDeniedError extends Error {}
class NetworkError extends Error {}
class RemoteServiceError extends Error {}

function runCacheFlow(cachedValue: string | null) {
  return try$.flow({
    a() {
      const cached = cachedValue

      if (cached !== null) {
        return this.$exit(cached)
      }

      return null
    },
    async b() {
      await sleep(5)
      return "api-value"
    },
    async c() {
      const apiValue = await this.$result.b
      return this.$exit(`${apiValue}-transformed`)
    },
  })
}
describe("runSync", () => {
  describe("function form", () => {
    it("returns value when function succeeds", () => {
      const value = try$.runSync(() => 42)

      expect(value).toBe(42)
    })

    it("returns UnhandledException in function form", () => {
      const result = try$.runSync(() => {
        throw new Error("boom")
      })

      expect(result).toBeInstanceOf(try$.UnhandledException)
    })

    it("throws Panic when sync run receives a Promise-returning function via unsafe cast", () => {
      const unsafeRun = try$.runSync as unknown as (tryFn: () => number) => number
      const unsafeTry = (() => Promise.resolve(42)) as unknown as () => number

      expect(() => unsafeRun(unsafeTry)).toThrow(try$.Panic)
    })
  })

  describe("object form", () => {
    it("returns mapped value when object form catch handles error", () => {
      const result = try$.runSync({
        catch: () => "mapped",
        try: () => {
          throw new Error("boom")
        },
      })

      expect(result).toBe("mapped")
    })

    it("throws Panic when catch throws", () => {
      expect(() =>
        try$.runSync({
          catch: () => {
            throw new Error("catch failed")
          },
          try: () => {
            throw new Error("boom")
          },
        })
      ).toThrow(try$.Panic)
    })

    it("supports multiple mapped error variants in sync object form", () => {
      const invalidInput = try$.runSync({
        catch: (error) => {
          if (error instanceof SyntaxError) {
            return new InvalidInputError("invalid")
          }

          return new PermissionDeniedError("denied")
        },
        try: () => {
          throw new SyntaxError("bad input")
        },
      })

      const permissionDenied = try$.runSync({
        catch: (error) => {
          if (error instanceof SyntaxError) {
            return new InvalidInputError("invalid")
          }

          return new PermissionDeniedError("denied")
        },
        try: () => {
          throw new Error("no access")
        },
      })

      expect(invalidInput).toBeInstanceOf(InvalidInputError)
      expect(permissionDenied).toBeInstanceOf(PermissionDeniedError)
    })
  })
})

describe("run", () => {
  describe("function form", () => {
    it("returns value when async function resolves", async () => {
      const result = try$.run(async () => {
        await Promise.resolve()

        return 42
      })

      expect(await result).toBe(42)
    })

    it("returns UnhandledException when async function form rejects", async () => {
      const result = try$.run(async () => {
        await Promise.resolve()
        throw new Error("boom")
      })

      expect(await result).toBeInstanceOf(try$.UnhandledException)
    })

    it("returns UnhandledException when sync function form throws", async () => {
      const result = try$.run(() => {
        throw new Error("boom")
      })

      expect(await result).toBeInstanceOf(try$.UnhandledException)
    })
  })

  describe("object form", () => {
    it("returns mapped value when async object form catch handles error", async () => {
      const result = try$.run({
        catch: () => "mapped",
        try: async () => {
          await Promise.resolve()
          throw new Error("boom")
        },
      })

      expect(await result).toBe("mapped")
    })

    it("throws Panic when async catch rejects", async () => {
      const result = try$.run({
        catch: async () => {
          await Promise.resolve()
          throw new Error("catch failed")
        },
        try: async () => {
          await Promise.resolve()
          throw new Error("boom")
        },
      })

      try {
        await result
        throw new Error("Expected Panic rejection")
      } catch (error) {
        expect(error).toBeInstanceOf(try$.Panic)
      }
    })

    it("supports multiple mapped error variants in async object form", async () => {
      const networkError = await try$.run({
        catch: (error): NetworkError | RemoteServiceError => {
          if (error instanceof TypeError) {
            return new NetworkError("network")
          }

          return new RemoteServiceError("remote")
        },
        try: async () => {
          await Promise.resolve()
          throw new TypeError("fetch failed")
        },
      })

      const remoteServiceError = await try$.run({
        catch: (error) => {
          if (error instanceof TypeError) {
            return new NetworkError("network")
          }

          return new RemoteServiceError("remote")
        },
        try: async () => {
          await Promise.resolve()
          throw new Error("500")
        },
      })

      expect(networkError).toBeInstanceOf(NetworkError)
      expect(remoteServiceError).toBeInstanceOf(RemoteServiceError)
    })
  })
})

describe("retry execution flow", () => {
  it("handles many zero-delay sync retries without stack overflow", async () => {
    const limit = 20_000

    const result = await try$.retry(limit).run((ctx) => {
      if (ctx.retry.attempt < limit) {
        throw new Error("retry")
      }

      return ctx.retry.attempt
    })

    expect(result).toBe(limit)
  })

  it("does not double-call shouldRetry when switching from sync to async retry path", async () => {
    let shouldRetryCalls = 0

    const result = await try$
      .retry({
        backoff: "constant",
        delayMs: 1,
        limit: 3,
        shouldRetry: () => {
          shouldRetryCalls += 1
          return true
        },
      })
      .run(() => {
        throw new Error("boom")
      })

    expect(result).toBeInstanceOf(try$.RetryExhaustedError)
    expect(shouldRetryCalls).toBe(2)
  })
})

describe("builder helpers", () => {
  it("supports wrap builder step", async () => {
    const result = await try$.wrap((ctx, next) => next(ctx)).run(() => 42)

    expect(result).toBe(42)
  })

  it("supports wrap builder runSync", () => {
    const result = try$.wrap((ctx, next) => next(ctx)).runSync(() => 42)

    expect(result).toBe(42)
  })

  it("supports multiple wraps in top-level wrap chain", async () => {
    const events: string[] = []

    const result = await try$
      .wrap((ctx, next) => {
        events.push("outer-before")
        const value = next(ctx)
        events.push("outer-after")
        return value
      })
      .wrap((ctx, next) => {
        events.push("inner-before")
        const value = next(ctx)
        events.push("inner-after")
        return value
      })
      .run(() => 42)

    expect(result).toBe(42)
    expect(events).toEqual(["outer-before", "inner-before", "inner-after", "outer-after"])
  })

  it("applies wrap around all", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        return next(ctx)
      })
      .all({
        a() {
          return 1
        },
        async b() {
          return (await this.$result.a) + 1
        },
      })

    expect(result).toEqual({ a: 1, b: 2 })
    expect(wrapCalls).toBe(1)
  })

  it("applies wrap around failing all and preserves rejection", async () => {
    let wrapCalls = 0

    try {
      await try$
        .wrap((ctx, next) => {
          wrapCalls += 1
          return next(ctx)
        })
        .all({
          a() {
            throw new Error("boom")
          },
        })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("boom")
      expect(wrapCalls).toBe(1)
    }
  })

  it("applies wrap around flow", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        return next(ctx)
      })
      .flow({
        a() {
          return this.$exit("done" as const)
        },
      })

    expect(result).toBe("done")
    expect(wrapCalls).toBe(1)
  })

  it("applies wrap around flow failure", async () => {
    let wrapCalls = 0

    try {
      await try$
        .wrap((ctx, next) => {
          wrapCalls += 1
          return next(ctx)
        })
        .flow({
          a() {
            return 1
          },
        })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("Flow completed without exit")
      expect(wrapCalls).toBe(1)
    }
  })

  it("applies wrap around gen", () => {
    let wrapCalls = 0

    const result = try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        return next(ctx)
      })
      .gen(function* (use) {
        const value = yield* use(1)
        return value + 1
      })

    expect(result).toBe(2)
    expect(wrapCalls).toBe(1)
  })

  it("applies wrap around gen rejection path", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        return next(ctx)
      })
      .gen(function* (use) {
        const value = yield* use(Promise.reject<number>(new Error("boom")))
        return value
      })

    expect(result).toBeInstanceOf(Error)
    expect(wrapCalls).toBe(1)
  })

  it("keeps root run isolated from retry chains", async () => {
    const retried = await try$.retry(2).run(() => {
      throw new Error("boom")
    })

    const rooted = await try$.run(() => {
      throw new Error("boom")
    })

    expect(retried).toBeInstanceOf(try$.RetryExhaustedError)
    expect(rooted).toBeInstanceOf(try$.UnhandledException)
  })

  it("keeps root run isolated from wrap chains", async () => {
    let wrapCalls = 0

    await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        return next(ctx)
      })
      .run(() => 1)

    await try$.run(() => 2)

    expect(wrapCalls).toBe(1)
  })

  it("exposes dispose from root namespace", async () => {
    const calls: string[] = []
    const disposer = try$.dispose()

    disposer.defer(() => {
      calls.push("cleanup")
    })

    await disposer[Symbol.asyncDispose]()

    expect(calls).toEqual(["cleanup"])
  })
})

describe("flow", () => {
  it("throws when no task exits", async () => {
    try {
      await try$.flow({
        a() {
          return 1
        },
        async b() {
          return (await this.$result.a) + 1
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("Flow completed without exit")
    }
  })

  it("returns value from $exit", async () => {
    const result = await try$.flow({
      async api() {
        await sleep(50)
        return "remote"
      },
      cache() {
        return this.$exit("cached" as const)
      },
    })

    expect(result).toBe("cached")
  })

  it("runs cleanup on early exit", async () => {
    let cleaned = false

    const result = await try$.flow({
      first() {
        this.$disposer.defer(() => {
          cleaned = true
        })

        return this.$exit(42)
      },
      async second() {
        if (!this.$signal.aborted) {
          await new Promise<void>((resolve) => {
            this.$signal.addEventListener(
              "abort",
              () => {
                resolve()
              },
              { once: true }
            )
          })
        }

        return 0
      },
    })

    expect(result).toBe(42)
    expect(cleaned).toBe(true)
  })

  it("keeps dependency flow order from a to b to c", async () => {
    const order: string[] = []

    const result = await try$.flow({
      a() {
        order.push("a")
        return 1
      },
      async b() {
        const a = await this.$result.a
        order.push("b")
        return a + 1
      },
      async c() {
        const b = await this.$result.b
        order.push("c")
        return this.$exit(b + 1)
      },
    })

    expect(order).toEqual(["a", "b", "c"])
    expect(result).toBe(3)
  })

  it("returns cached value with early exit when cache has data", async () => {
    const result = await runCacheFlow("cached-value")

    expect(result).toBe("cached-value")
  })

  it("fetches and transforms api value when cache is empty", async () => {
    const result = await runCacheFlow(null)

    expect(result).toBe("api-value-transformed")
  })

  it("applies wrap middleware in chained flow execution", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        expect(ctx.retry.attempt).toBe(1)
        return next(ctx)
      })
      .flow({
        a() {
          return this.$exit("done")
        },
      })

    expect(result).toBe("done")
    expect(wrapCalls).toBe(1)
  })

  it("applies retry policy in chained flow execution", async () => {
    let attempts = 0

    const result = await try$.retry(2).flow({
      a() {
        attempts += 1

        if (attempts === 1) {
          throw new Error("boom")
        }

        return this.$exit("ok")
      },
    })

    expect(result).toBe("ok")
    expect(attempts).toBe(2)
  })

  it("applies timeout policy in chained flow execution", async () => {
    try {
      await try$.timeout(5).flow({
        async a() {
          await sleep(20)
          return this.$exit("late")
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(try$.TimeoutError)
    }
  })

  it("rejects when a flow task awaits its own result", async () => {
    try {
      await try$.flow({
        async a() {
          return await (this.$result as Record<string, Promise<unknown>>).a
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toContain("cannot await its own result")
    }
  })

  it("rejects inherited dependency keys on $result", async () => {
    try {
      await try$.flow({
        async a() {
          const key = "toString"
          const value = (this.$result as Record<string, Promise<unknown>>)[key]
          return await value
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toContain("Unknown task")
    }
  })
})

describe("all", () => {
  it("returns empty object when task map is empty", async () => {
    const result = await try$.all({})

    expect(result).toEqual({})
  })

  it("runs tasks in parallel and returns resolved values", async () => {
    const started: string[] = []

    const result = await try$.all({
      async a() {
        started.push("a")
        await sleep(10)
        return 1
      },
      async b() {
        started.push("b")
        await sleep(10)
        return "ok"
      },
    })

    expect(started).toEqual(["a", "b"])
    expect(result).toEqual({ a: 1, b: "ok" })
  })

  it("supports dependency reads through this.$result", async () => {
    const result = await try$.all({
      a() {
        return 10
      },
      async b() {
        const a = await this.$result.a
        return a + 5
      },
    })

    expect(result).toEqual({ a: 10, b: 15 })
  })

  it("rejects on first task failure", async () => {
    try {
      await try$.all({
        a() {
          throw new Error("boom")
        },
        async b() {
          await sleep(20)
          return 2
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("boom")
    }
  })

  it("returns mapped value when catch handles failure", async () => {
    const result = await try$.all(
      {
        a() {
          throw new Error("boom")
        },
        b() {
          return 2
        },
      },
      {
        catch: () => "mapped" as const,
      }
    )

    expect(result).toBe("mapped")
  })

  it("passes failed task and partial results to catch", async () => {
    const result = await try$.all(
      {
        async a() {
          await sleep(5)
          return 1
        },
        b() {
          throw new Error("boom")
        },
      },
      {
        catch: (_error, ctx) => ({
          failedTask: ctx.failedTask,
          hasSignal: ctx.signal instanceof AbortSignal,
          partialA: ctx.partial.a,
        }),
      }
    )

    expect(result).toEqual({
      failedTask: "b",
      hasSignal: true,
      partialA: undefined,
    })
  })

  it("throws Panic when all catch throws", async () => {
    try {
      await try$.all(
        {
          a() {
            throw new Error("boom")
          },
        },
        {
          catch: () => {
            throw new Error("catch failed")
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(try$.Panic)
    }
  })

  it("throws Panic when all catch rejects", async () => {
    try {
      await try$.all(
        {
          a() {
            throw new Error("boom")
          },
        },
        {
          catch: async () => {
            await Promise.resolve()
            throw new Error("catch failed")
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(try$.Panic)
    }
  })

  it("returns resolved values with retry and timeout builder options", async () => {
    const result = await try$
      .retry(3)
      .timeout(100)
      .all({
        a() {
          return 1
        },
        async b() {
          await sleep(5)
          return 2
        },
      })

    expect(result).toEqual({ a: 1, b: 2 })
  })

  it("applies wrap middleware around all execution", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        expect(ctx.retry.attempt).toBe(1)
        return next(ctx)
      })
      .all({
        a() {
          return 1
        },
      })

    expect(result).toEqual({ a: 1 })
    expect(wrapCalls).toBe(1)
  })

  it("honors cancellation signal from builder options", async () => {
    const controller = new AbortController()

    const pending = try$
      .retry(3)
      .timeout(100)
      .signal(controller.signal)
      .all({
        async a() {
          await sleep(20)

          if (this.$signal.aborted) {
            throw this.$signal.reason
          }

          return 1
        },
        async b() {
          await sleep(20)
          return 2
        },
      })

    setTimeout(() => {
      controller.abort(new Error("stop"))
    }, 5)

    try {
      await pending
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("stop")
    }
  })
})

describe("full builder chain", () => {
  it("supports retry + timeout + signal in sync run", async () => {
    const ac = new AbortController()
    let attempts = 0

    const result = await try$
      .retry(3)
      .timeout(100)
      .signal(ac.signal)
      .run((ctx) => {
        attempts += 1
        expect(ctx.signal).toBeDefined()
        expect(ctx.signal).not.toBe(ac.signal)
        expect(ctx.retry.limit).toBe(3)

        if (attempts === 1) {
          throw new Error("boom")
        }

        return ctx.retry.attempt
      })

    expect(result).toBe(2)
  })

  it("supports retry + timeout + signal in async run with mapped catch", async () => {
    const ac = new AbortController()

    const result = await try$
      .retry({
        backoff: "constant",
        delayMs: 1,
        limit: 3,
        shouldRetry: () => false,
      })
      .timeout(100)
      .signal(ac.signal)
      .run({
        catch: () => "mapped" as const,
        try: async (ctx) => {
          expect(ctx.signal).toBeDefined()
          expect(ctx.signal).not.toBe(ac.signal)
          await Promise.resolve()
          throw new Error("boom")
        },
      })

    expect(result).toBe("mapped")
  })

  it("returns CancellationError when one chained signal aborts", async () => {
    const first = new AbortController()
    const second = new AbortController()

    const pending = try$
      .signal(first.signal)
      .signal(second.signal)
      .run(async (ctx) => {
        expect(ctx.signal).toBeDefined()
        expect(ctx.signal).not.toBe(first.signal)
        expect(ctx.signal).not.toBe(second.signal)

        await new Promise((resolve) => {
          setTimeout(resolve, 25)
        })

        return 42
      })

    setTimeout(() => {
      second.abort(new Error("stop"))
    }, 5)

    const result = await pending

    expect(result).toBeInstanceOf(try$.CancellationError)
  })

  it("returns TimeoutError from retry + timeout + signal when deadline is exceeded", async () => {
    const ac = new AbortController()

    const result = await try$
      .retry(3)
      .timeout(5)
      .signal(ac.signal)
      .run(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 20)
        })
        return 42
      })

    expect(result).toBeInstanceOf(try$.TimeoutError)
  })

  it("returns same value for timeout().signal() and signal().timeout() chains", async () => {
    const ac = new AbortController()

    const directResult = await try$
      .timeout(50)
      .signal(ac.signal)
      .run((ctx) => {
        expect(ctx.signal).toBeDefined()
        expect(ctx.signal).not.toBe(ac.signal)
        return 7
      })

    const rootedResult = await try$
      .signal(ac.signal)
      .timeout(50)
      .run((ctx) => {
        expect(ctx.signal).toBeDefined()
        expect(ctx.signal).not.toBe(ac.signal)
        return 7
      })

    expect(directResult).toBe(7)
    expect(rootedResult).toBe(7)
  })

  it("supports wrap + run together", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        return next(ctx)
      })
      .run(async () => {
        await sleep(5)
        return 6
      })

    expect(result).toBe(6)
    expect(wrapCalls).toBe(1)
  })

  it("supports signal + allSettled with mixed outcomes", async () => {
    const ac = new AbortController()

    const result = await try$.signal(ac.signal).allSettled({
      fail() {
        throw new Error("boom")
      },
      ok() {
        return 1
      },
    })

    expect(result.ok).toEqual({ status: "fulfilled", value: 1 })
    expect(result.fail.status).toBe("rejected")
  })
})

describe("gen integration", () => {
  class UserNotFound extends Error {}
  class PermissionDenied extends Error {}
  class ProjectNotFound extends Error {}

  it("short-circuits with error from try$.runSync inside gen", () => {
    const result = try$.gen(function* (use) {
      const value = yield* use(
        try$.runSync((): number => {
          throw new Error("boom")
        })
      )

      return value
    })

    expect(result).toBeInstanceOf(try$.UnhandledException)
  })

  it("short-circuits with error from try$.run inside gen", async () => {
    const result = await try$.gen(function* (use) {
      const value = yield* use(
        try$.run(async (): Promise<number> => {
          await Promise.resolve()
          throw new Error("boom")
        })
      )

      return value
    })

    expect(result).toBeInstanceOf(try$.UnhandledException)
  })

  it("composes multiple try$ calls and returns success or mapped errors", async () => {
    const runFlow = (mode: "ok" | "user-not-found" | "permission-denied" | "project-not-found") => {
      const getUser = () =>
        try$.run({
          catch: (error): UserNotFound | PermissionDenied => {
            if (error instanceof TypeError) {
              return new PermissionDenied("denied")
            }

            return new UserNotFound("missing user")
          },
          try: async () => {
            await Promise.resolve()

            if (mode === "permission-denied") {
              throw new TypeError("denied")
            }

            if (mode === "user-not-found") {
              throw new Error("missing")
            }

            return { id: "u_1" }
          },
        })

      const getProject = (userId: string) =>
        try$.run({
          catch: (): ProjectNotFound => new ProjectNotFound("missing project"),
          try: async () => {
            await Promise.resolve()

            if (mode === "project-not-found") {
              throw new Error("missing")
            }

            return { id: `p_${userId}` }
          },
        })

      return try$.gen(function* (use) {
        const user = yield* use(getUser())
        const project = yield* use(getProject(user.id))
        return `${user.id}:${project.id}`
      })
    }

    const ok = await runFlow("ok")
    const userNotFound = await runFlow("user-not-found")
    const permissionDenied = await runFlow("permission-denied")
    const projectNotFound = await runFlow("project-not-found")

    expect(ok).toBe("u_1:p_u_1")
    expect(userNotFound).toBeInstanceOf(UserNotFound)
    expect(permissionDenied).toBeInstanceOf(PermissionDenied)
    expect(projectNotFound).toBeInstanceOf(ProjectNotFound)
  })
})
