import fc from "fast-check"
import { describe, expect, it, vi } from "vitest"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../errors"
import * as try$ from "../index"
import { expectPanic } from "./test-utils"

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

function never<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Intentionally never settles.
  })
}

describe("runSync", () => {
  describe("function form", () => {
    it("returns value when function succeeds", () => {
      const value = try$.runSync(() => 42)

      expect(value).toBe(42)
    })

    it("returns UnhandledException with the thrown error as cause", () => {
      const failure = new Error("boom")

      const result = try$.runSync(() => {
        throw failure
      })

      expect(result).toBeInstanceOf(UnhandledException)
      expect(result.cause).toBe(failure)
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
  })

  describe("object form", () => {
    it("returns the catch result and passes it the thrown error", () => {
      const failure = new Error("boom")
      const caught: unknown[] = []

      const result = try$.runSync({
        catch: (error) => {
          caught.push(error)
          return "mapped"
        },
        try: () => {
          throw failure
        },
      })

      expect(result).toBe("mapped")
      expect(caught).toEqual([failure])
    })

    it("does not call catch when try succeeds", () => {
      let catchCalls = 0

      const result = try$.runSync({
        catch: () => {
          catchCalls += 1
          return "mapped"
        },
        try: () => 42,
      })

      expect(result).toBe(42)
      expect(catchCalls).toBe(0)
    })

    it("throws Panic with the catch error as cause when catch throws", () => {
      const catchFailure = new Error("catch failed")

      try {
        try$.runSync({
          catch: () => {
            throw catchFailure
          },
          try: () => {
            throw new Error("boom")
          },
        })
        expect.unreachable("should have thrown")
      } catch (error) {
        expectPanic(error, "RUN_SYNC_CATCH_HANDLER_THROW")
        expect((error as Panic).cause).toBe(catchFailure)
      }
    })

    it("throws Panic when catch returns a Promise via unsafe cast", () => {
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

    it("returns UnhandledException with the rejection as cause when async function rejects", async () => {
      const failure = new Error("boom")

      const result = await try$.run(async () => {
        await Promise.resolve()
        throw failure
      })

      expect(result).toBeInstanceOf(UnhandledException)
      expect(result.cause).toBe(failure)
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

    it("returns UnhandledException with the thrown error as cause when sync function throws", async () => {
      const failure = new Error("boom")

      const result = await try$.run(() => {
        throw failure
      })

      expect(result).toBeInstanceOf(UnhandledException)
      expect(result.cause).toBe(failure)
    })
  })

  describe("object form", () => {
    it("returns the catch result and passes it the rejection", async () => {
      const failure = new Error("boom")
      const caught: unknown[] = []

      const result = await try$.run({
        catch: (error) => {
          caught.push(error)
          return "mapped"
        },
        try: async () => {
          await Promise.resolve()
          throw failure
        },
      })

      expect(result).toBe("mapped")
      expect(caught).toEqual([failure])
    })

    it("throws Panic with the catch error as cause when catch throws synchronously", async () => {
      const catchFailure = new Error("catch failed")

      try {
        await try$.run({
          catch: () => {
            throw catchFailure
          },
          try: () => {
            throw new Error("boom")
          },
        })
        expect.unreachable("should have thrown")
      } catch (error) {
        expectPanic(error, "RUN_CATCH_HANDLER_THROW")
        expect((error as Panic).cause).toBe(catchFailure)
      }
    })

    it("throws Panic with the rejection as cause when async catch rejects", async () => {
      const catchFailure = new Error("catch failed")

      try {
        await try$.run({
          catch: async () => {
            await Promise.resolve()
            throw catchFailure
          },
          try: async () => {
            await Promise.resolve()
            throw new Error("boom")
          },
        })
        expect.unreachable("should have thrown")
      } catch (error) {
        expectPanic(error, "RUN_CATCH_HANDLER_REJECT")
        expect((error as Panic).cause).toBe(catchFailure)
      }
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

  it("runs exactly once with retry(1) and reports give-up on failure", async () => {
    const failure = new Error("boom")
    let attempts = 0

    const result = await try$.retry(1).run(() => {
      attempts += 1
      throw failure
    })

    expect(result).toBeInstanceOf(RetryExhaustedError)
    expect(result.cause).toBe(failure)
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

  it.each([
    { backoff: "constant", delayMs: 10, limit: 2 },
    { backoff: "constant", jitter: true, limit: 2 },
    { backoff: "linear", delayMs: 10, limit: 2 },
  ] as const)("panics when runSync receives an async retry policy via casts: %o", (policy) => {
    const unsafeBuilder = try$.retry(policy) as unknown as {
      runSync(tryFn: () => number): unknown
    }
    let tryCalls = 0

    try {
      unsafeBuilder.runSync(() => {
        tryCalls += 1
        return 1
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "RUN_SYNC_ASYNC_RETRY_POLICY")
    }

    expect(tryCalls).toBe(0)
  })

  it("exposes the current attempt and limit to each sync retry", () => {
    const seen: Array<{ attempt: number; limit: number }> = []

    const result = try$.retry(3).runSync((ctx) => {
      seen.push({ ...ctx.retry })

      if (ctx.retry.attempt < 3) {
        throw new Error("boom")
      }

      return "done" as const
    })

    expect(result).toBe("done")
    expect(seen).toEqual([
      { attempt: 1, limit: 3 },
      { attempt: 2, limit: 3 },
      { attempt: 3, limit: 3 },
    ])
  })

  it("does not retry or map a TimeoutError thrown by try", () => {
    const thrown = new TimeoutError()
    let attempts = 0
    let catchCalls = 0

    const result = try$.retry(3).runSync({
      catch: () => {
        catchCalls += 1
        return "mapped"
      },
      try: () => {
        attempts += 1
        throw thrown
      },
    })

    expect(result).toBe(thrown)
    expect(attempts).toBe(1)
    expect(catchCalls).toBe(0)
  })

  it("calls shouldRetry once per failed attempt below the limit", async () => {
    const calls: Array<{ attempt: number; error: unknown }> = []
    const failures: Error[] = []

    const result = await try$
      .retry({
        backoff: "constant",
        delayMs: 1,
        limit: 3,
        shouldRetry: (error, ctx) => {
          calls.push({ attempt: ctx.retry.attempt, error })
          return true
        },
      })
      .run((ctx) => {
        const failure = new Error(`boom ${ctx.retry.attempt}`)
        failures.push(failure)
        throw failure
      })

    expect(result).toBeInstanceOf(RetryExhaustedError)
    expect(result.cause).toBe(failures[2])
    // The limit check runs before shouldRetry, so the final attempt does not consult it.
    expect(calls).toEqual([
      { attempt: 1, error: failures[0] },
      { attempt: 2, error: failures[1] },
    ])
  })

  it("keeps ctx.signal undefined for retry-only executions", async () => {
    const signals: Array<AbortSignal | undefined> = []

    const result = await try$.retry(2).run((ctx) => {
      signals.push(ctx.signal)

      if (ctx.retry.attempt === 1) {
        throw new Error("boom")
      }

      return ctx.retry.attempt
    })

    expect(result).toBe(2)
    expect(signals).toEqual([undefined, undefined])
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
    const failure = new Error("not transient")
    const caught: unknown[] = []
    let attempts = 0

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
          attempts += 1
          throw failure
        },
      })

    expect(result).toBe("mapped")
    expect(caught).toEqual([failure])
    expect(attempts).toBe(1)
  })

  it("returns TimeoutError without invoking catch when timeout fires during retry backoff", async () => {
    vi.useFakeTimers()

    try {
      const caught: unknown[] = []
      let attempts = 0

      const pending = try$
        .retry({ backoff: "constant", delayMs: 50, limit: 3 })
        .timeout(5)
        .run({
          catch: (error) => {
            caught.push(error)
            return "mapped" as const
          },
          try: () => {
            attempts += 1
            throw new Error("boom")
          },
        })

      await vi.advanceTimersByTimeAsync(5)

      const result = await pending

      expect(result).toBeInstanceOf(TimeoutError)
      expect(attempts).toBe(1)
      expect(caught).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rethrows Panic from try without invoking catch even with retry configured", async () => {
    const panic = new Panic("FLOW_NO_EXIT")
    const caught: unknown[] = []
    let attempts = 0

    try {
      await try$.retry(3).run({
        catch: (error) => {
          caught.push(error)
          return "mapped" as const
        },
        try: () => {
          attempts += 1
          throw panic
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(panic)
    }

    expect(caught).toHaveLength(0)
    expect(attempts).toBe(1)
  })
})

describe("timeout and cancellation behavior", () => {
  it("returns TimeoutError and aborts ctx.signal when timeout expires during try", async () => {
    vi.useFakeTimers()

    try {
      let taskSignal: AbortSignal | undefined

      const promise = try$.timeout(5).run((ctx) => {
        taskSignal = ctx.signal
        return never<string>()
      })

      await vi.advanceTimersByTimeAsync(5)
      const result = await promise

      expect(result).toBeInstanceOf(TimeoutError)
      expect(taskSignal?.aborted).toBe(true)
      expect(taskSignal?.reason).toBe(result)
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns TimeoutError when timeout expires during catch execution", async () => {
    vi.useFakeTimers()

    try {
      let catchCalls = 0

      const pending = try$.timeout(5).run({
        catch: () => {
          catchCalls += 1
          return never<string>()
        },
        try: () => {
          throw new Error("boom")
        },
      })

      // Stop short of the deadline so catch is known to be pending when the timeout fires.
      await vi.advanceTimersByTimeAsync(4)
      expect(catchCalls).toBe(1)

      await vi.advanceTimersByTimeAsync(1)
      const result = await pending

      expect(result).toBeInstanceOf(TimeoutError)
      expect(catchCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns CancellationError with the abort reason when signal aborts during async try", async () => {
    const controller = new AbortController()
    const reason = new Error("stop")
    let taskSignal: AbortSignal | undefined

    const pending = try$.signal(controller.signal).run((ctx) => {
      taskSignal = ctx.signal
      return never<string>()
    })

    controller.abort(reason)

    const result = await pending

    expect(result).toBeInstanceOf(CancellationError)
    expect((result as CancellationError).cause).toBe(reason)
    expect(taskSignal).not.toBe(controller.signal)
    expect(taskSignal?.aborted).toBe(true)
  })

  it("reports the configured deadline over a TimeoutError returned as a value", async () => {
    vi.useFakeTimers()

    try {
      const userTimeout = new TimeoutError("returned as a value")

      const result = await try$.timeout(5).run(() => {
        // Move the clock past the deadline without firing timers: sync work cannot
        // observe the timer, so the clock check at the result boundary must report
        // the policy timeout.
        vi.setSystemTime(Date.now() + 10)
        return userTimeout
      })

      expect(result).toBeInstanceOf(TimeoutError)
      expect(result).not.toBe(userTimeout)
      expect(result.message).toBe("Execution exceeded timeout of 5ms")
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns CancellationError when aborted during retry backoff", async () => {
    vi.useFakeTimers()

    try {
      const controller = new AbortController()
      const reason = new Error("stop")
      let attempts = 0

      const pending = try$
        .retry({ backoff: "constant", delayMs: 50, limit: 3 })
        .signal(controller.signal)
        .run(() => {
          attempts += 1
          throw new Error("boom")
        })

      await vi.advanceTimersByTimeAsync(10)
      // The backoff sleep is the only scheduled timer, so the abort lands inside it.
      expect(vi.getTimerCount()).toBe(1)

      controller.abort(reason)

      const result = await pending

      expect(result).toBeInstanceOf(CancellationError)
      expect(result.cause).toBe(reason)
      expect(attempts).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("prefers cancellation over timeout when both fire during catch", async () => {
    vi.useFakeTimers()

    try {
      const controller = new AbortController()
      const reason = new Error("cancelled")
      let catchCalls = 0

      const pending = try$
        .signal(controller.signal)
        .timeout(50)
        .run({
          catch: () => {
            catchCalls += 1
            return never<string>()
          },
          try: () => {
            throw new Error("boom")
          },
        })

      // Both controls fire before any continuation runs. The timeout race wins
      // the inner promise race, so only outcome arbitration can report cancellation.
      controller.abort(reason)
      vi.advanceTimersByTime(50)

      const result = await pending

      expect(result).toBeInstanceOf(CancellationError)
      expect(catchCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("wrap behavior", () => {
  it("runs a wrap around runSync and returns its result synchronously", () => {
    const observed: unknown[] = []

    const result = try$
      .wrap((_, next) => {
        const value = next()
        observed.push(value)
        return value
      })
      .runSync(() => 42)

    expect(result).toBe(42)
    expect(observed).toEqual([42])
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
      .run(() => {
        events.push("try")
        return 42
      })

    expect(result).toBe(42)
    expect(events).toEqual(["outer-before", "inner-before", "try", "inner-after", "outer-after"])
  })

  it("runs wraps once around the full retry scope when retries are delayed", async () => {
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
