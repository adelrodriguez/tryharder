import { describe, expect, it, vi } from "vitest"
import { CancellationError, RetryExhaustedError, TimeoutError, UnhandledException } from "../errors"
import * as try$ from "../index"
import { expectPanic } from "./test-utils"

function succeedOnSecondAttempt(ctx: { retry: { attempt: number } }) {
  if (ctx.retry.attempt < 2) {
    throw new Error("boom")
  }

  return ctx.retry.attempt
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Intentionally never settles.
  })
}

describe("builder chaining", () => {
  it("passes wraps a read-only view of ctx that tracks the current attempt", async () => {
    let retryDescriptor: PropertyDescriptor | undefined
    let signalDescriptor: PropertyDescriptor | undefined
    let missingCtxDescriptor: PropertyDescriptor | undefined
    let attemptDescriptor: PropertyDescriptor | undefined
    let missingRetryDescriptor: PropertyDescriptor | undefined
    let didSetAttempt: boolean | undefined
    let attemptBeforeNext: number | undefined
    let attemptAfterNext: number | undefined

    const result = await try$
      .wrap(async (ctx, next) => {
        retryDescriptor = Object.getOwnPropertyDescriptor(ctx, "retry")
        signalDescriptor = Object.getOwnPropertyDescriptor(ctx, "signal")
        missingCtxDescriptor = Object.getOwnPropertyDescriptor(ctx, "missing")
        attemptDescriptor = Object.getOwnPropertyDescriptor(ctx.retry, "attempt")
        missingRetryDescriptor = Object.getOwnPropertyDescriptor(ctx.retry, "missing")
        didSetAttempt = Reflect.set(ctx.retry, "attempt", 99)
        attemptBeforeNext = ctx.retry.attempt
        const value = await next()
        attemptAfterNext = ctx.retry.attempt
        return value
      })
      .retry(2)
      .run(succeedOnSecondAttempt)

    expect(result).toBe(2)
    expect(retryDescriptor?.writable).toBe(false)
    expect(signalDescriptor?.writable).toBe(false)
    expect(missingCtxDescriptor).toBeUndefined()
    expect(attemptDescriptor?.writable).toBe(false)
    expect(missingRetryDescriptor).toBeUndefined()
    expect(didSetAttempt).toBe(false)
    expect(attemptBeforeNext).toBe(1)
    expect(attemptAfterNext).toBe(2)
  })

  it("panics at execution when orchestration is invoked after retry() via casts", async () => {
    const unsafeRetryBuilder = try$.retry(3) as unknown as { all: typeof try$.all }
    let taskCalls = 0

    try {
      await unsafeRetryBuilder.all({
        a() {
          taskCalls += 1
          return 1
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "ORCHESTRATION_UNSUPPORTED_POLICY")
    }

    expect(taskCalls).toBe(0)
  })

  it("treats wrap after retry as behavior-identical to wrap before retry", async () => {
    let wrapBeforeCalls = 0
    const wrapBeforeResult = await try$
      .wrap((_, next) => {
        wrapBeforeCalls += 1
        return next()
      })
      .retry(2)
      .run(succeedOnSecondAttempt)

    let wrapAfterCalls = 0
    const unsafeRetryBuilder = try$.retry(2) as unknown as {
      wrap(fn: Parameters<typeof try$.wrap>[0]): ReturnType<typeof try$.retry<2>>
    }
    const wrapAfterResult = await unsafeRetryBuilder
      .wrap((_, next) => {
        wrapAfterCalls += 1
        return next()
      })
      .run(succeedOnSecondAttempt)

    expect(wrapBeforeResult).toBe(2)
    expect(wrapAfterResult).toBe(2)
    expect(wrapBeforeCalls).toBe(1)
    expect(wrapAfterCalls).toBe(1)
  })

  it("applies wrap around failing all and preserves rejection", async () => {
    const failure = new Error("boom")
    let wrapCalls = 0

    try {
      await try$
        .wrap((_, next) => {
          wrapCalls += 1
          return next()
        })
        .all({
          a() {
            throw failure
          },
        })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(failure)
    }

    expect(wrapCalls).toBe(1)
  })

  it("derives new builders without mutating the parent builder", async () => {
    const events: string[] = []
    const aborted = new AbortController()
    aborted.abort(new Error("stop"))

    const base = try$.wrap((_, next) => {
      events.push("base")
      return next()
    })
    const withWrap = base.wrap((_, next) => {
      events.push("derived")
      return next()
    })
    const withSignal = base.signal(aborted.signal)
    const withRetry = base.retry(2)

    expect(await base.run(() => 1)).toBe(1)
    expect(events).toEqual(["base"])

    expect(await withWrap.run(() => 2)).toBe(2)
    expect(events).toEqual(["base", "base", "derived"])

    expect(await withSignal.run(() => 3)).toBeInstanceOf(CancellationError)
    expect(await withRetry.run(() => Promise.reject(new Error("boom")))).toBeInstanceOf(
      RetryExhaustedError
    )

    let rootAttempts = 0
    const rooted = await try$.run(() => {
      rootAttempts += 1
      throw new Error("boom")
    })

    expect(rooted).toBeInstanceOf(UnhandledException)
    expect(rootAttempts).toBe(1)
    expect(events).toEqual(["base", "base", "derived", "base", "base"])
  })

  it("throws Panic when wrapped runSync returns a Promise", () => {
    const unsafeWrap = (() => Promise.resolve(1)) as unknown as Parameters<typeof try$.wrap>[0]

    try {
      try$.wrap(unsafeWrap).runSync(() => 1)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "RUN_SYNC_WRAPPED_RESULT_PROMISE")
    }
  })
})

describe("full builder chain", () => {
  it("retries a sync-throwing try under retry + timeout + signal in run", async () => {
    vi.useFakeTimers()

    // Frozen clock: the 100ms deadline cannot elapse on a busy machine.
    try {
      const controller = new AbortController()
      const seen: Array<{
        aborted: boolean
        attempt: number
        limit: number
        signal?: AbortSignal
      }> = []

      const result = await try$
        .retry(3)
        .timeout(100)
        .signal(controller.signal)
        .run((ctx) => {
          seen.push({
            aborted: ctx.signal?.aborted ?? true,
            attempt: ctx.retry.attempt,
            limit: ctx.retry.limit,
            signal: ctx.signal,
          })

          if (ctx.retry.attempt === 1) {
            throw new Error("boom")
          }

          return ctx.retry.attempt
        })

      expect(result).toBe(2)
      expect(seen.map(({ attempt, limit }) => ({ attempt, limit }))).toEqual([
        { attempt: 1, limit: 3 },
        { attempt: 2, limit: 3 },
      ])
      expect(seen.every(({ aborted }) => !aborted)).toBe(true)
      expect(seen[0]?.signal).toBeInstanceOf(AbortSignal)
      expect(seen[0]?.signal).not.toBe(controller.signal)
    } finally {
      vi.useRealTimers()
    }
  })

  it("maps the try error through catch under retry + timeout + signal", async () => {
    vi.useFakeTimers()

    // Frozen clock: the 100ms deadline cannot elapse on a busy machine.
    try {
      const controller = new AbortController()
      const failure = new Error("boom")
      const caught: unknown[] = []
      const signals: Array<AbortSignal | undefined> = []

      const result = await try$
        .retry({
          backoff: "constant",
          delayMs: 1,
          limit: 3,
          shouldRetry: () => false,
        })
        .timeout(100)
        .signal(controller.signal)
        .run({
          catch: (error) => {
            caught.push(error)
            return "mapped" as const
          },
          try: async (ctx) => {
            signals.push(ctx.signal)
            await Promise.resolve()
            throw failure
          },
        })

      expect(result).toBe("mapped")
      expect(caught).toEqual([failure])
      expect(signals).toHaveLength(1)
      expect(signals[0]).toBeInstanceOf(AbortSignal)
      expect(signals[0]).not.toBe(controller.signal)
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns CancellationError when one chained signal aborts", async () => {
    const first = new AbortController()
    const second = new AbortController()
    const reason = new Error("stop")
    let taskSignal: AbortSignal | undefined

    const pending = try$
      .signal(first.signal)
      .signal(second.signal)
      .run((ctx) => {
        taskSignal = ctx.signal
        return never<number>()
      })

    second.abort(reason)

    const result = await pending

    expect(result).toBeInstanceOf(CancellationError)
    expect((result as CancellationError).cause).toBe(reason)
    expect(taskSignal).not.toBe(first.signal)
    expect(taskSignal).not.toBe(second.signal)
    expect(taskSignal?.aborted).toBe(true)
    expect(first.signal.aborted).toBe(false)
  })

  it("returns TimeoutError from retry + timeout + signal when deadline is exceeded", async () => {
    vi.useFakeTimers()

    try {
      const controller = new AbortController()
      let attempts = 0
      let taskSignal: AbortSignal | undefined

      const pending = try$
        .retry(3)
        .timeout(5)
        .signal(controller.signal)
        .run((ctx) => {
          attempts += 1
          taskSignal = ctx.signal
          return never<number>()
        })

      await vi.advanceTimersByTimeAsync(5)
      const result = await pending

      expect(result).toBeInstanceOf(TimeoutError)
      expect(attempts).toBe(1)
      expect(taskSignal?.reason).toBe(result)
    } finally {
      vi.useRealTimers()
    }
  })

  it("prefers cancellation over timeout regardless of timeout/signal chain order", async () => {
    const controller = new AbortController()
    const reason = new Error("cancelled")
    controller.abort(reason)
    let tryCalls = 0

    const timeoutFirst = await try$
      .timeout(0)
      .signal(controller.signal)
      .run(() => {
        tryCalls += 1
        return 7
      })

    const signalFirst = await try$
      .signal(controller.signal)
      .timeout(0)
      .run(() => {
        tryCalls += 1
        return 7
      })

    expect(timeoutFirst).toBeInstanceOf(CancellationError)
    expect(signalFirst).toBeInstanceOf(CancellationError)
    expect((timeoutFirst as CancellationError).cause).toBe(reason)
    expect((signalFirst as CancellationError).cause).toBe(reason)
    expect(tryCalls).toBe(0)
  })
})
