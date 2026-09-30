import { afterEach, describe, expect, it, vi } from "vitest"
import type { BuilderConfig } from "../builder"
import { Panic } from "../../errors"
import { BaseExecution } from "../execution/base"
import { calculateRetryDelay, retryOptions } from "../policies/retry"
import { assertUnreachable, resolveWithAbort, sleep } from "../utils"

// Coverage-only tests for internal helper and guard branches that are not
// practical to exercise through the public API without heavy contrivance.

class TestExecution extends BaseExecution<number> {
  constructor(config: BuilderConfig = {}) {
    super(config)
  }

  protected override executeCore() {
    void this.config
    return 1
  }

  cancel(cause?: unknown) {
    return this.checkDidCancel(cause)
  }

  get signal() {
    return this.ctx.signal
  }

  raceCancel<V>(promise: PromiseLike<V>, cause?: unknown) {
    return this.raceWithCancellation(promise, cause)
  }

  static wrapContext() {
    return TestExecution.createWrapContext(TestExecution.createContext({}, undefined))
  }
}

describe("coverage exceptions", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe("retry helpers", () => {
    it("normalizes exponential retry options", () => {
      expect(
        retryOptions({
          backoff: "exponential",
          delayMs: 5,
          limit: 4,
          maxDelayMs: 12,
        })
      ).toEqual({
        backoff: "exponential",
        delayMs: 5,
        jitter: undefined,
        limit: 4,
        maxDelayMs: 12,
        shouldRetry: undefined,
      })
    })

    it("defaults delayMs to 0 and omits maxDelayMs for linear retry options", () => {
      const normalized = retryOptions({ backoff: "linear", limit: 2 })

      expect(normalized).toEqual({
        backoff: "linear",
        delayMs: 0,
        jitter: undefined,
        limit: 2,
        shouldRetry: undefined,
      })
      expect("maxDelayMs" in normalized).toBe(false)
    })

    it("calculates retry delay for no-policy, constant, linear, and exponential backoff", () => {
      expect(calculateRetryDelay(1, {})).toBe(0)
      expect(
        calculateRetryDelay(3, {
          retry: { backoff: "constant", delayMs: 7, limit: 4 },
        })
      ).toBe(7)
      expect(
        calculateRetryDelay(2, {
          retry: { backoff: "linear", delayMs: 10, limit: 4 },
        })
      ).toBe(20)
      expect(
        calculateRetryDelay(3, {
          retry: { backoff: "exponential", delayMs: 5, limit: 5 },
        })
      ).toBe(20)
      expect(
        calculateRetryDelay(3, {
          retry: { backoff: "exponential", delayMs: 5, limit: 5, maxDelayMs: 12 },
        })
      ).toBe(12)
    })

    it("applies jitter only when the computed delay is positive", () => {
      const random = vi.spyOn(Math, "random").mockReturnValue(0.5)

      expect(
        calculateRetryDelay(1, {
          retry: { backoff: "constant", delayMs: 0, jitter: true, limit: 3 },
        })
      ).toBe(0)
      expect(random).not.toHaveBeenCalled()

      expect(
        calculateRetryDelay(1, {
          retry: { backoff: "constant", delayMs: 25, jitter: true, limit: 3 },
        })
      ).toBe(12)
      expect(random).toHaveBeenCalledTimes(1)
    })
  })

  describe("utils", () => {
    it("throws Panic from assertUnreachable", () => {
      let thrown: unknown

      try {
        assertUnreachable("unexpected" as never, "UNREACHABLE_RETRY_POLICY_BACKOFF")
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Panic)
      expect((thrown as Panic).code).toBe("UNREACHABLE_RETRY_POLICY_BACKOFF")
      expect((thrown as Panic).message).toContain("Unreachable case: unexpected")
    })

    it("resolves without scheduling a timer when sleep receives zero or less", async () => {
      vi.useFakeTimers()

      const pending = [sleep(0), sleep(-1)]

      expect(vi.getTimerCount()).toBe(0)
      await expect(Promise.all(pending)).resolves.toEqual([undefined, undefined])
    })

    it("returns the abort result and observes the input rejection when the signal is already aborted", async () => {
      const controller = new AbortController()
      controller.abort(new Error("stop"))
      const unhandledRejections: unknown[] = []
      const onUnhandledRejection = (reason: unknown) => {
        unhandledRejections.push(reason)
      }
      let abortFactoryCalls = 0

      process.on("unhandledRejection", onUnhandledRejection)

      try {
        const rejected = Promise.reject(new Error("later"))
        const result = await resolveWithAbort(controller.signal, rejected, () => {
          abortFactoryCalls += 1
          return "aborted" as const
        })

        await sleep(1)

        expect(result).toBe("aborted")
        expect(abortFactoryCalls).toBe(1)
        expect(unhandledRejections).toHaveLength(0)
      } finally {
        process.off("unhandledRejection", onUnhandledRejection)
      }
    })

    it("returns the promise value and detaches the abort listener when the promise settles first", async () => {
      const controller = new AbortController()
      let resolvePromise!: (value: string) => void
      let abortFactoryCalls = 0

      const pending = new Promise<string>((resolve) => {
        resolvePromise = resolve
      })

      const resultPromise = resolveWithAbort(controller.signal, pending, () => {
        abortFactoryCalls += 1
        return "aborted" as const
      })

      resolvePromise("done")

      const result = await resultPromise
      controller.abort(new Error("too late"))

      expect(result).toBe("done")
      expect(abortFactoryCalls).toBe(0)
    })

    it("returns the abort result once when abort happens after registration and before settlement", async () => {
      const controller = new AbortController()
      let resolvePromise!: (value: string) => void
      let abortFactoryCalls = 0

      const pending = new Promise<string>((resolve) => {
        resolvePromise = resolve
      })

      const resultPromise = resolveWithAbort(controller.signal, pending, () => {
        abortFactoryCalls += 1
        return "aborted" as const
      })

      controller.abort(new Error("stop"))
      resolvePromise("done")

      expect(await resultPromise).toBe("aborted")
      expect(abortFactoryCalls).toBe(1)
    })
  })

  describe("guard branches", () => {
    it("rejects writes, defines, and deletes through wrap-context proxies", () => {
      const ctx = TestExecution.wrapContext()

      expect(Reflect.set(ctx, "signal", new AbortController().signal)).toBe(false)
      expect(Reflect.set(ctx.retry, "attempt", 99)).toBe(false)

      expect(
        Reflect.defineProperty(ctx, "signal", {
          configurable: true,
          value: new AbortController().signal,
        })
      ).toBe(false)
      expect(
        Reflect.defineProperty(ctx.retry, "attempt", {
          configurable: true,
          value: 99,
        })
      ).toBe(false)

      expect(Reflect.deleteProperty(ctx, "signal")).toBe(false)
      expect(Reflect.deleteProperty(ctx.retry, "attempt")).toBe(false)

      expect(ctx.retry).toEqual({ attempt: 1, limit: 1 })
      expect("signal" in ctx).toBe(true)
      expect(ctx.signal).toBeUndefined()
    })

    it("keeps control helpers inert when execution has no signal config", () => {
      const execution = new TestExecution()
      const promise = Promise.resolve("ok")

      expect(execution.signal).toBeUndefined()
      expect(execution.cancel(new Error("cause"))).toBeUndefined()
      expect(execution.raceCancel(promise)).toBe(promise)
    })
  })
})
