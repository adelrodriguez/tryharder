import { describe, expect, it } from "bun:test"
import type { BuilderConfig } from "../builder"
import { Panic } from "../../errors"
import { BaseExecution } from "../executors/base"
import { TaskGraphExecutionBase, type ResultProxy, type TaskContext } from "../executors/shared"
import { calculateRetryDelay, retryOptions } from "../modifiers/retry"
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
    return this.createWrapContext(this.createContext({}, undefined))
  }
}

type EmptyTasks = Record<string, never>

class SharedDefaultExecution extends TaskGraphExecutionBase<EmptyTasks, TaskContext<EmptyTasks>> {
  constructor() {
    super(undefined, {})
  }

  protected override createTaskContext() {
    void this.taskNames
    return {
      $disposer: new AsyncDisposableStack(),
      $result: {} as ResultProxy<EmptyTasks>,
      $signal: new AbortController().signal,
    }
  }

  shouldAbort(error?: unknown) {
    return this.shouldAbortOnTaskError(error)
  }
}

describe("coverage exceptions", () => {
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

    it("calculates retry delay across no-policy, linear, capped exponential, and jitter branches", () => {
      expect(calculateRetryDelay(1, {})).toBe(0)
      expect(
        calculateRetryDelay(2, {
          retry: { backoff: "linear", delayMs: 10, limit: 4 },
        })
      ).toBe(20)
      expect(
        calculateRetryDelay(3, {
          retry: { backoff: "exponential", delayMs: 5, limit: 5, maxDelayMs: 12 },
        })
      ).toBe(12)

      const originalRandom = Math.random
      Math.random = () => 0.5

      try {
        expect(
          calculateRetryDelay(1, {
            retry: { backoff: "constant", delayMs: 20, jitter: true, limit: 3 },
          })
        ).toBe(10)
      } finally {
        Math.random = originalRandom
      }
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
    })

    it("resolves immediately when sleep receives zero or less", async () => {
      await sleep(0)
      await sleep(-1)
    })

    it("resolves abort result immediately when resolveWithAbort receives an already-aborted signal", async () => {
      const controller = new AbortController()
      controller.abort(new Error("stop"))
      const pending = new Promise<string>((resolve) => {
        void resolve
      })

      const result = await resolveWithAbort(controller.signal, pending, () => "aborted" as const)

      expect(result).toBe("aborted")
    })
  })

  describe("guard branches", () => {
    it("exposes proxy descriptors for existing and missing wrap-context properties", () => {
      const ctx = TestExecution.wrapContext()

      expect(Object.getOwnPropertyDescriptor(ctx, "missing")).toBeUndefined()
      expect(Object.getOwnPropertyDescriptor(ctx.retry, "missing")).toBeUndefined()
      expect(Object.getOwnPropertyDescriptor(ctx, "signal")?.writable).toBe(false)
      expect(Object.getOwnPropertyDescriptor(ctx, "retry")?.writable).toBe(false)
      expect(Object.getOwnPropertyDescriptor(ctx.retry, "attempt")?.writable).toBe(false)
    })

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

      expect(ctx.retry.attempt).toBe(1)
      expect(ctx.signal).toBeUndefined()
    })

    it("defaults to not aborting task errors in the shared base class", () => {
      const execution = new SharedDefaultExecution()

      expect(execution.shouldAbort()).toBe(false)
    })

    it("keeps control helpers inert when execution has no signal config", async () => {
      const execution = new TestExecution()

      expect(execution.signal).toBeUndefined()
      expect(execution.cancel()).toBeUndefined()
      expect(await execution.raceCancel(Promise.resolve("ok"))).toBe("ok")
    })
  })
})
