import { describe, expect, it } from "bun:test"
import { CancellationError, RetryExhaustedError, TimeoutError, UnhandledException } from "../errors"
import * as try$ from "../index"
import { expectPanic, sleep } from "./test-utils"

function succeedOnSecondAttempt(ctx: { retry: { attempt: number } }) {
  if (ctx.retry.attempt < 2) {
    throw new Error("boom")
  }

  return ctx.retry.attempt
}

describe("builder chaining", () => {
  it("exposes read-only descriptors on wrap ctx and retry metadata", async () => {
    let retryDescriptor: PropertyDescriptor | undefined
    let signalDescriptor: PropertyDescriptor | undefined
    let missingCtxDescriptor: PropertyDescriptor | undefined
    let attemptDescriptor: PropertyDescriptor | undefined
    let missingRetryDescriptor: PropertyDescriptor | undefined

    const result = await try$
      .wrap((ctx, next) => {
        retryDescriptor = Object.getOwnPropertyDescriptor(ctx, "retry")
        signalDescriptor = Object.getOwnPropertyDescriptor(ctx, "signal")
        missingCtxDescriptor = Object.getOwnPropertyDescriptor(ctx, "missing")
        attemptDescriptor = Object.getOwnPropertyDescriptor(ctx.retry, "attempt")
        missingRetryDescriptor = Object.getOwnPropertyDescriptor(ctx.retry, "missing")
        return next()
      })
      .run(() => 1)

    expect(result).toBe(1)
    expect(retryDescriptor?.writable).toBe(false)
    expect(signalDescriptor?.writable).toBe(false)
    expect(missingCtxDescriptor).toBeUndefined()
    expect(attemptDescriptor?.writable).toBe(false)
    expect(missingRetryDescriptor).toBeUndefined()
  })

  it("panics at execution when orchestration is invoked after retry() via casts", async () => {
    const unsafeRetryBuilder = try$.retry(3) as unknown as { all: typeof try$.all }

    try {
      await unsafeRetryBuilder.all({
        a() {
          return 1
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "ORCHESTRATION_UNSUPPORTED_POLICY")
    }
  })

  it("panics at execution when orchestration is invoked after timeout() via casts", async () => {
    const unsafeTimeoutBuilder = try$.timeout(100) as unknown as {
      allSettled: typeof try$.allSettled
    }

    try {
      await unsafeTimeoutBuilder.allSettled({
        a() {
          return 1
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "ORCHESTRATION_UNSUPPORTED_POLICY")
    }
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

  it("applies wrap around all", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((_, next) => {
        wrapCalls += 1
        return next()
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
        .wrap((_, next) => {
          wrapCalls += 1
          return next()
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
      .wrap((_, next) => {
        wrapCalls += 1
        return next()
      })
      .flow({
        a() {
          return this.$exit("done" as const)
        },
      })

    expect(result).toBe("done")
    expect(wrapCalls).toBe(1)
  })

  it("keeps root run isolated from retry chains", async () => {
    const retried = await try$.retry(2).run(() => {
      throw new Error("boom")
    })

    const rooted = await try$.run(() => {
      throw new Error("boom")
    })

    expect(retried).toBeInstanceOf(RetryExhaustedError)
    expect(rooted).toBeInstanceOf(UnhandledException)
  })

  it("keeps root run isolated from wrap chains", async () => {
    let wrapCalls = 0

    await try$
      .wrap((_, next) => {
        wrapCalls += 1
        return next()
      })
      .run(() => 1)

    await try$.run(() => 2)

    expect(wrapCalls).toBe(1)
  })

  it("throws Panic when wrapped runSync returns a Promise", () => {
    const unsafeWrap = (() => Promise.resolve(1)) as unknown as Parameters<typeof try$.wrap>[0]

    try {
      try$.wrap(unsafeWrap).runSync(() => 1)
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe("RUN_SYNC_WRAPPED_RESULT_PROMISE")
    }
  })
})

describe("full builder chain", () => {
  it("supports retry + timeout + signal in sync run", async () => {
    const controller = new AbortController()
    let attempts = 0

    const result = await try$
      .retry(3)
      .timeout(100)
      .signal(controller.signal)
      .run((ctx) => {
        attempts += 1
        expect(ctx.signal).toBeDefined()
        expect(ctx.signal).not.toBe(controller.signal)
        expect(ctx.retry.limit).toBe(3)

        if (attempts === 1) {
          throw new Error("boom")
        }

        return ctx.retry.attempt
      })

    expect(result).toBe(2)
  })

  it("supports retry + timeout + signal in async run with mapped catch", async () => {
    const controller = new AbortController()

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
        catch: () => "mapped" as const,
        try: async (ctx) => {
          expect(ctx.signal).toBeDefined()
          expect(ctx.signal).not.toBe(controller.signal)
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

        await sleep(25)
        return 42
      })

    setTimeout(() => {
      second.abort(new Error("stop"))
    }, 5)

    const result = await pending

    expect(result).toBeInstanceOf(CancellationError)
  })

  it("returns TimeoutError from retry + timeout + signal when deadline is exceeded", async () => {
    const controller = new AbortController()

    const result = await try$
      .retry(3)
      .timeout(5)
      .signal(controller.signal)
      .run(async () => {
        await sleep(20)
        return 42
      })

    expect(result).toBeInstanceOf(TimeoutError)
  })

  it("returns same value for timeout().signal() and signal().timeout() chains", async () => {
    const controller = new AbortController()

    const directResult = await try$
      .timeout(50)
      .signal(controller.signal)
      .run((ctx) => {
        expect(ctx.signal).toBeDefined()
        expect(ctx.signal).not.toBe(controller.signal)
        return 7
      })

    const rootedResult = await try$
      .signal(controller.signal)
      .timeout(50)
      .run((ctx) => {
        expect(ctx.signal).toBeDefined()
        expect(ctx.signal).not.toBe(controller.signal)
        return 7
      })

    expect(directResult).toBe(7)
    expect(rootedResult).toBe(7)
  })

  it("supports wrap + run together", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((_, next) => {
        wrapCalls += 1
        return next()
      })
      .run(async () => {
        await sleep(5)
        return 6
      })

    expect(result).toBe(6)
    expect(wrapCalls).toBe(1)
  })
})
