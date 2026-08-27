import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../errors"
import * as try$ from "../index"
import { expectPanic, sleep } from "./test-utils"

class InvalidInputError extends Error {
  override name = "InvalidInputError"
}

class PermissionDeniedError extends Error {
  override name = "PermissionDeniedError"
}

class NetworkError extends Error {
  override name = "NetworkError"
}

class RemoteServiceError extends Error {
  override name = "RemoteServiceError"
}

/**
 * Patches `setTimeout` to record every scheduled delay and re-schedule callbacks with a 0ms delay.
 * Lets retry-delay tests assert the delay calculation deterministically instead of measuring
 * wall-clock time, which is flaky on contended CI.
 */
function captureScheduledDelays() {
  const values: number[] = []
  const originalSetTimeout = globalThis.setTimeout

  const capturedSetTimeout = Object.assign(
    <TArgs extends unknown[]>(callback: (...args: TArgs) => void, ms?: number, ...args: TArgs) => {
      values.push(ms ?? 0)
      return originalSetTimeout(callback, 0, ...args)
    },
    { __promisify__: originalSetTimeout.__promisify__ }
  )

  globalThis.setTimeout = capturedSetTimeout

  return {
    restore() {
      globalThis.setTimeout = originalSetTimeout
    },
    values,
  }
}

describe("captureScheduledDelays", () => {
  it("preserves setTimeout callback arguments", async () => {
    const scheduledDelays = captureScheduledDelays()

    try {
      const result = await new Promise<string>((resolve) => {
        setTimeout(
          (prefix, value) => {
            resolve(`${prefix}${value}`)
          },
          25,
          "value-",
          42
        )
      })

      expect(result).toBe("value-42")
      expect(scheduledDelays.values).toEqual([25])
    } finally {
      scheduledDelays.restore()
    }
  })
})

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

  it("runs no more than the numeric retry limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ max: 100, min: 1 }),
        fc.integer({ max: 100, min: 1 }),
        (limit, successfulAttempt) => {
          let attempts = 0

          const result = try$.retry(limit).runSync(() => {
            attempts += 1

            if (attempts < successfulAttempt) {
              throw new Error("try again")
            }

            return successfulAttempt
          })

          expect(attempts).toBe(Math.min(limit, successfulAttempt))

          if (successfulAttempt <= limit) {
            expect(result).toBe(successfulAttempt)
          } else {
            expect(result).toBeInstanceOf(RetryExhaustedError)
          }
        }
      )
    )
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

  it("runs exactly once with retry(1) and reports give-up on failure", async () => {
    let attempts = 0

    const result = await try$.retry(1).run(() => {
      attempts += 1
      throw new Error("boom")
    })

    expect(result).toBeInstanceOf(RetryExhaustedError)
    expect(attempts).toBe(1)
  })

  it("caps exponential backoff delays at maxDelayMs through the public API", async () => {
    const scheduledDelays = captureScheduledDelays()

    try {
      let attempts = 0

      const result = await try$
        .retry({ backoff: "exponential", delayMs: 25, limit: 4, maxDelayMs: 25 })
        .run(() => {
          attempts += 1
          throw new Error("boom")
        })

      expect(result).toBeInstanceOf(RetryExhaustedError)
      expect(attempts).toBe(4)
      // Uncapped exponential delays would be [25, 50, 100]; the cap keeps
      // every scheduled retry sleep at 25ms.
      expect(scheduledDelays.values).toEqual([25, 25, 25])
    } finally {
      scheduledDelays.restore()
    }
  })

  it("applies jitter to retry delays through the public API", async () => {
    const originalRandom = Math.random
    Math.random = () => 0.5
    const scheduledDelays = captureScheduledDelays()

    try {
      let attempts = 0

      const result = await try$
        .retry({ backoff: "constant", delayMs: 50, jitter: true, limit: 3 })
        .run(() => {
          attempts += 1
          throw new Error("boom")
        })

      expect(result).toBeInstanceOf(RetryExhaustedError)
      expect(attempts).toBe(3)
      // With Math.random() === 0.5, jitter floors each 50ms delay to 25ms;
      // without jitter both scheduled sleeps would be 50ms.
      expect(scheduledDelays.values).toEqual([25, 25])
    } finally {
      scheduledDelays.restore()
      Math.random = originalRandom
    }
  })

  it("panics when runSync receives a delayed retry policy via casts", () => {
    const unsafeBuilder = try$.retry({
      backoff: "constant",
      delayMs: 10,
      limit: 2,
    }) as unknown as { runSync(tryFn: () => number): unknown }

    try {
      unsafeBuilder.runSync(() => 1)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "RUN_SYNC_ASYNC_RETRY_POLICY")
    }
  })

  it("panics when runSync receives a jittered retry policy via casts", () => {
    const unsafeBuilder = try$.retry({
      backoff: "constant",
      jitter: true,
      limit: 2,
    }) as unknown as { runSync(tryFn: () => number): unknown }

    try {
      unsafeBuilder.runSync(() => 1)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "RUN_SYNC_ASYNC_RETRY_POLICY")
    }
  })

  it("runs retries synchronously with the numeric shorthand", () => {
    const attempts: number[] = []

    const result = try$.retry(3).runSync((ctx) => {
      attempts.push(ctx.retry.attempt)

      if (ctx.retry.attempt < 3) {
        throw new Error("boom")
      }

      return "done" as const
    })

    // The whole retry loop completed synchronously: the result is available
    // on the same tick, with no awaits in between.
    expect(result).toBe("done")
    expect(attempts).toEqual([1, 2, 3])
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

describe("retry give-up and catch contract", () => {
  it("routes the last error through catch when retries exhaust", async () => {
    const caught: unknown[] = []

    const result = await try$.retry(3).run({
      catch: (error) => {
        caught.push(error)
        return "mapped" as const
      },
      try: (ctx) => {
        throw new Error(`boom ${ctx.retry.attempt}`)
      },
    })

    expect(result).toBe("mapped")
    expect(caught).toHaveLength(1)
    expect((caught[0] as Error).message).toBe("boom 3")
  })

  it("routes the last error through catch when retries exhaust in runSync", () => {
    const caught: unknown[] = []

    const result = try$.retry(2).runSync({
      catch: (error) => {
        caught.push(error)
        return "mapped" as const
      },
      try: (ctx) => {
        throw new Error(`boom ${ctx.retry.attempt}`)
      },
    })

    expect(result).toBe("mapped")
    expect(caught).toHaveLength(1)
    expect((caught[0] as Error).message).toBe("boom 2")
  })

  it("returns RetryExhaustedError with the last error as cause when no catch is provided", async () => {
    const result = await try$.retry(2).run((ctx) => {
      throw new Error(`boom ${ctx.retry.attempt}`)
    })

    expect(result).toBeInstanceOf(RetryExhaustedError)
    expect((result.cause as Error).message).toBe("boom 2")
  })

  it("returns RetryExhaustedError with cause in runSync when no catch is provided", () => {
    const result = try$.retry(2).runSync((ctx) => {
      throw new Error(`boom ${ctx.retry.attempt}`)
    })

    expect(result).toBeInstanceOf(RetryExhaustedError)
    expect((result.cause as Error).message).toBe("boom 2")
  })

  it("returns RetryExhaustedError when shouldRetry declines and no catch is provided", async () => {
    let attempts = 0

    const result = await try$
      .retry({
        backoff: "constant",
        limit: 5,
        shouldRetry: () => false,
      })
      .run(() => {
        attempts += 1
        throw new Error("not transient")
      })

    expect(result).toBeInstanceOf(RetryExhaustedError)
    expect((result.cause as Error).message).toBe("not transient")
    expect(attempts).toBe(1)
  })

  it("passes the original error to catch when shouldRetry declines", async () => {
    const caught: unknown[] = []

    const result = await try$
      .retry({
        backoff: "constant",
        limit: 5,
        shouldRetry: () => false,
      })
      .run({
        catch: (error) => {
          caught.push(error)
          return "mapped" as const
        },
        try: () => {
          throw new Error("not transient")
        },
      })

    expect(result).toBe("mapped")
    expect(caught).toHaveLength(1)
    expect((caught[0] as Error).message).toBe("not transient")
  })

  it("does not invoke catch when timeout fires during retry backoff", async () => {
    const caught: unknown[] = []

    const result = await try$
      .retry({ backoff: "constant", delayMs: 50, limit: 3 })
      .timeout(5)
      .run({
        catch: (error) => {
          caught.push(error)
          return "mapped" as const
        },
        try: () => {
          throw new Error("boom")
        },
      })

    expect(result).toBeInstanceOf(TimeoutError)
    expect(caught).toHaveLength(0)
  })

  it("rethrows Panic from try without invoking catch even with retry configured", async () => {
    const panic = new Panic("FLOW_NO_EXIT")
    const caught: unknown[] = []

    try {
      await try$.retry(3).run({
        catch: (error) => {
          caught.push(error)
          return "mapped" as const
        },
        try: () => {
          throw panic
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(panic)
    }

    expect(caught).toHaveLength(0)
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

  it("reports the configured deadline over a TimeoutError returned as a value", async () => {
    const userTimeout = new TimeoutError("returned as a value")

    const result = await try$.timeout(5).run(() => {
      const startedAt = Date.now()
      let spins = 0

      // Busy-wait past the deadline: sync work cannot observe the timer, so the
      // wall-clock check at the result boundary must report the policy timeout.
      while (Date.now() - startedAt < 10) {
        spins += 1
      }

      void spins
      return userTimeout
    })

    expect(result).toBeInstanceOf(TimeoutError)
    expect(result).not.toBe(userTimeout)
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
