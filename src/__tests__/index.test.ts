import { describe, expect, it } from "bun:test"
import * as try$ from "../index"

class InvalidInputError extends Error {}
class PermissionDeniedError extends Error {}
class NetworkError extends Error {}
class RemoteServiceError extends Error {}

describe("runSync", () => {
  it("returns value when tryFn succeeds", () => {
    const value = try$.runSync(() => 42)

    expect(value).toBe(42)
  })

  it("returns UnhandledException in function form", () => {
    const result = try$.runSync(() => {
      throw new Error("boom")
    })

    expect(result).toBeInstanceOf(try$.UnhandledException)
  })

  it("maps error when object form includes try and catch", () => {
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

  it("throws Panic when sync run receives a Promise-returning function via unsafe cast", () => {
    const unsafeRun = try$.runSync as unknown as (tryFn: () => number) => number
    const unsafeTry = (() => Promise.resolve(42)) as unknown as () => number

    expect(() => unsafeRun(unsafeTry)).toThrow(try$.Panic)
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

describe("run", () => {
  it("returns promise value when tryFn is async", async () => {
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

  it("maps async object form rejections through catch", async () => {
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

  it("throws for unimplemented all", () => {
    expect(() => try$.all({})).toThrow("all is not implemented yet")
  })

  it("throws for unimplemented allSettled", () => {
    expect(() => try$.allSettled({})).toThrow("allSettled is not implemented yet")
  })

  it("throws for unimplemented flow", () => {
    expect(() => try$.flow({})).toThrow("flow is not implemented yet")
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

describe("full builder chain", () => {
  it("supports retry + timeout + signal + wrap in sync run", async () => {
    const ac = new AbortController()
    let attempts = 0

    const result = await try$
      .retry(3)
      .timeout(100)
      .signal(ac.signal)
      .wrap((ctx, next) => next(ctx))
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

  it("supports full chain in async run with mapped catch", async () => {
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
      .wrap((ctx, next) => next(ctx))
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

  it("combines chained signal calls into a compound ctx.signal", async () => {
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

  it("returns TimeoutError from full chain when deadline is exceeded", async () => {
    const ac = new AbortController()

    const result = await try$
      .retry(3)
      .timeout(5)
      .signal(ac.signal)
      .wrap((ctx, next) => next(ctx))
      .run(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 20)
        })
        return 42
      })

    expect(result).toBeInstanceOf(try$.TimeoutError)
  })

  it("matches root helpers and chained timeout/signal API", async () => {
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
