import { describe, expect, it } from "bun:test"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../errors"
import * as try$ from "../index"
import { createRandomGenerator, expectPanic, sleep } from "./test-utils"

class InvalidInputError extends Error {}
class PermissionDeniedError extends Error {}
class NetworkError extends Error {}
class RemoteServiceError extends Error {}

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

      expect(result).toBeInstanceOf(UnhandledException)
    })

    it("throws Panic when sync run receives a Promise-returning function via unsafe cast", () => {
      const unsafeRun = try$.runSync as unknown as (tryFn: () => number) => number
      const unsafeTry = (() => Promise.resolve(42)) as unknown as () => number

      try {
        unsafeRun(unsafeTry)
        expect.unreachable("should have thrown")
      } catch (error) {
        expectPanic(error, "RUN_SYNC_TRY_PROMISE")
      }
    })

    it("rethrows user-thrown Panic in function form", () => {
      const panic = new Panic("FLOW_NO_EXIT")
      let thrown: unknown

      try {
        try$.runSync(() => {
          throw panic
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBe(panic)
    })

    it("rethrows forwarded Panic from nested try$.runSync", () => {
      const unsafeCatch = (() => Promise.resolve("mapped")) as unknown as (error: unknown) => string
      let thrown: unknown

      try {
        try$.runSync(() =>
          try$.runSync({
            catch: unsafeCatch,
            try: () => {
              throw new Error("boom")
            },
          })
        )
      } catch (error) {
        thrown = error
      }

      expectPanic(thrown, "RUN_SYNC_CATCH_PROMISE")
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
      try {
        try$.runSync({
          catch: () => {
            throw new Error("catch failed")
          },
          try: () => {
            throw new Error("boom")
          },
        })
        expect.unreachable("should have thrown")
      } catch (error) {
        expectPanic(error, "RUN_SYNC_CATCH_HANDLER_THROW")
      }
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

    it("rethrows RUN_SYNC_CATCH_PROMISE unchanged when catch returns a promise", () => {
      const unsafeCatch = (() => Promise.resolve("mapped")) as unknown as (error: unknown) => string

      try {
        try$.runSync({
          catch: unsafeCatch,
          try: () => {
            throw new Error("boom")
          },
        })
        expect.unreachable("should have thrown")
      } catch (error) {
        expectPanic(error, "RUN_SYNC_CATCH_PROMISE")
      }
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

      expect(await result).toBeInstanceOf(UnhandledException)
    })

    it("rethrows user-thrown Panic in function form", async () => {
      const panic = new Panic("FLOW_NO_EXIT")
      let thrown: unknown

      try {
        await try$.run(() => {
          throw panic
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBe(panic)
    })

    it("returns UnhandledException when sync function form throws", async () => {
      const result = try$.run(() => {
        throw new Error("boom")
      })

      expect(await result).toBeInstanceOf(UnhandledException)
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
        expectPanic(error, "RUN_CATCH_HANDLER_REJECT")
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

describe("retry behavior", () => {
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

  it("supports runSync after numeric retry shorthand", () => {
    const target = 7
    const succeedsOnThirdTry = createRandomGenerator(target)

    const result = try$.retry(3).runSync(() => {
      const value = succeedsOnThirdTry.next()

      if (value !== target) {
        throw new Error("try again")
      }

      return value
    })

    expect(result).toBe(target)
    expect(succeedsOnThirdTry.attempts).toBe(3)

    const failsAfterTwoTries = createRandomGenerator(target)
    const exhausted = try$.retry(2).runSync(() => {
      const value = failsAfterTwoTries.next()

      if (value !== target) {
        throw new Error("try again")
      }

      return value
    })

    expect(exhausted).toBeInstanceOf(RetryExhaustedError)
    expect(failsAfterTwoTries.attempts).toBe(2)
  })

  it("stops retrying when shouldRetry returns false", async () => {
    let attempts = 0

    const result = await try$
      .retry({
        backoff: "constant",
        limit: 5,
        shouldRetry: () => false,
      })
      .run({
        catch: () => "mapped" as const,
        try: () => {
          attempts += 1
          throw new Error("boom")
        },
      })

    expect(result).toBe("mapped")
    expect(attempts).toBe(1)
  })

  it("does not retry control errors", () => {
    let attempts = 0
    let mapped = false

    const result = try$.retry(3).runSync({
      catch: () => {
        mapped = true
        return "mapped"
      },
      try: () => {
        attempts += 1
        throw new TimeoutError()
      },
    })

    expect(result).toBeInstanceOf(TimeoutError)
    expect(attempts).toBe(1)
    expect(mapped).toBe(false)
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

    expect(result).toBeInstanceOf(RetryExhaustedError)
    expect(shouldRetryCalls).toBe(2)
  })

  it("keeps ctx.signal undefined for retry-only executions", async () => {
    const result = await try$.retry(2).run((ctx) => {
      expect(ctx.signal).toBeUndefined()

      if (ctx.retry.attempt === 1) {
        throw new Error("boom")
      }

      return ctx.retry.attempt
    })

    expect(result).toBe(2)
  })
})

describe("timeout and cancellation behavior", () => {
  it("returns TimeoutError when timeout expires during try execution", async () => {
    const result = await try$.timeout(5).run(async (ctx) => {
      expect(ctx.signal).toBeDefined()
      await sleep(20)
      return "never"
    })

    expect(result).toBeInstanceOf(TimeoutError)
  })

  it("returns TimeoutError when timeout expires during retry backoff", async () => {
    const result = await try$
      .retry({ backoff: "constant", delayMs: 50, limit: 3 })
      .timeout(5)
      .run(() => {
        throw new Error("boom")
      })

    expect(result).toBeInstanceOf(TimeoutError)
  })

  it("returns TimeoutError when timeout expires during catch execution", async () => {
    const result = await try$.timeout(5).run({
      catch: async () => {
        await sleep(20)
        return "mapped"
      },
      try: () => {
        throw new Error("boom")
      },
    })

    expect(result).toBeInstanceOf(TimeoutError)
  })

  it("returns CancellationError when signal aborts during async try", async () => {
    const controller = new AbortController()
    const pending = try$.signal(controller.signal).run(async (ctx) => {
      expect(ctx.signal).toBeDefined()
      expect(ctx.signal).not.toBe(controller.signal)
      await sleep(25)
      return "ok"
    })

    setTimeout(() => {
      controller.abort(new Error("stop"))
    }, 5)

    const result = await pending

    expect(result).toBeInstanceOf(CancellationError)
  })

  it("prefers cancellation over timeout when both controls are already tripped", async () => {
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))

    const result = await try$
      .signal(controller.signal)
      .timeout(0)
      .run((ctx) => {
        expect(ctx.signal).toBeDefined()
        return "never"
      })

    expect(result).toBeInstanceOf(CancellationError)
  })

  it("returns CancellationError when aborted during retry backoff", async () => {
    const controller = new AbortController()
    let attempts = 0

    const pending = try$
      .retry({ backoff: "constant", delayMs: 50, limit: 3 })
      .signal(controller.signal)
      .run(() => {
        attempts += 1
        throw new Error("boom")
      })

    setTimeout(() => {
      controller.abort(new Error("stop"))
    }, 5)

    const result = await pending

    expect(result).toBeInstanceOf(CancellationError)
    expect(attempts).toBe(1)
  })

  it("prefers cancellation over timeout when abort happens during catch", async () => {
    const controller = new AbortController()

    const pending = try$
      .signal(controller.signal)
      .timeout(50)
      .run({
        catch: async () => {
          await sleep(20)
          return "mapped"
        },
        try: () => {
          throw new Error("boom")
        },
      })

    setTimeout(() => {
      controller.abort(new Error("cancelled"))
    }, 5)

    const result = await pending

    expect(result).toBeInstanceOf(CancellationError)
  })
})

describe("wrap behavior", () => {
  it("supports wrap builder step", async () => {
    const result = await try$.wrap((_, next) => next()).run(() => 42)

    expect(result).toBe(42)
  })

  it("supports wrap builder runSync", () => {
    const result = try$.wrap((_, next) => next()).runSync(() => 42)

    expect(result).toBe(42)
  })

  it("supports multiple wraps in top-level wrap chain", async () => {
    const events: string[] = []

    const result = await try$
      .wrap((_, next) => {
        events.push("outer-before")
        const value = next()
        events.push("outer-after")
        return value
      })
      .wrap((_, next) => {
        events.push("inner-before")
        const value = next()
        events.push("inner-after")
        return value
      })
      .run(() => 42)

    expect(result).toBe(42)
    expect(events).toEqual(["outer-before", "inner-before", "inner-after", "outer-after"])
  })

  it("runs wraps once when retries are handled asynchronously", async () => {
    let wrapCalls = 0
    let attempts = 0

    const result = await try$
      .wrap((_, next) => {
        wrapCalls += 1
        return next()
      })
      .retry({ backoff: "constant", delayMs: 1, limit: 3 })
      .run(async (ctx) => {
        attempts += 1

        if (attempts === 1) {
          throw new Error("boom")
        }

        await Promise.resolve()
        return ctx.retry.attempt
      })

    expect(result).toBe(2)
    expect(wrapCalls).toBe(1)
    expect(attempts).toBe(2)
  })
})
