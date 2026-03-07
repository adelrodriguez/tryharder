import { describe, expect, it } from "bun:test"
import type { BuilderConfig } from "../../types/builder"
import { CancellationError, TimeoutError } from "../../errors"
import { BaseExecution } from "../base"

class TestExecution<TResult> extends BaseExecution<TResult> {
  readonly #core: () => TResult

  constructor(config: BuilderConfig, core: () => TResult) {
    super(config)
    this.#core = core
  }

  protected override executeCore(): TResult {
    return this.#core()
  }

  setAttempt(attempt: number): void {
    this.ctx.retry.attempt = attempt
  }

  currentAttempt(): number {
    return this.ctx.retry.attempt
  }

  buildDecision(error: unknown) {
    return this.buildRetryDecision(error)
  }

  checkControl(cause?: unknown) {
    return this.checkDidControlFail(cause)
  }

  async raceValue<V>(promise: PromiseLike<V>, cause?: unknown) {
    return await this.race(promise, cause)
  }

  async waitDelay(ms: number) {
    return await this.waitForRetryDelay(ms)
  }
}

describe("BaseExecution", () => {
  it("applies wraps around executeCore in registration order", () => {
    const events: string[] = []

    using execution = new TestExecution(
      {
        wraps: [
          (ctx, next) => {
            events.push(`outer:before:${ctx.retry.attempt}`)
            const value = next()
            events.push(`outer:after:${ctx.retry.attempt}`)
            return value
          },
          (ctx, next) => {
            events.push(`inner:before:${ctx.retry.attempt}`)
            const value = next()
            events.push(`inner:after:${ctx.retry.attempt}`)
            return value
          },
        ],
      },
      () => {
        events.push("core")
        return "ok"
      }
    )

    const result = execution.execute()

    expect(result).toBe("ok")
    expect(events).toEqual([
      "outer:before:1",
      "inner:before:1",
      "core",
      "inner:after:1",
      "outer:after:1",
    ])
  })

  it("runs wrapped async core exactly once", async () => {
    let coreCalls = 0
    let wrapCalls = 0

    using execution = new TestExecution(
      {
        wraps: [
          (ctx, next) => {
            wrapCalls += 1
            return next()
          },
        ],
      },
      async () => {
        await Promise.resolve()
        coreCalls += 1
        return "ok"
      }
    )

    const result = await execution.execute()

    expect(result).toBe("ok")
    expect(coreCalls).toBe(1)
    expect(wrapCalls).toBe(1)
  })

  it("prevents wrap middleware from mutating ctx at runtime", () => {
    let mutationError: unknown

    using execution = new TestExecution(
      {
        wraps: [
          (ctx, next) => {
            const wrapCtx = ctx

            try {
              ;(wrapCtx.retry as { attempt: number }).attempt = 4
            } catch (error) {
              mutationError = error
            }

            return next()
          },
        ],
      },
      () => "ok"
    )

    const result = execution.execute()

    expect(result).toBe("ok")
    expect(execution.currentAttempt()).toBe(1)
    expect(mutationError).toBeInstanceOf(TypeError)
  })

  it("prefers cancellation over timeout for control checks", () => {
    const controller = new AbortController()
    controller.abort(new Error("stop"))

    using execution = new TestExecution(
      {
        signals: [controller.signal],
        timeout: 0,
      },
      () => "ok"
    )

    const control = execution.checkControl()

    expect(control).toBeInstanceOf(CancellationError)
  })

  it("builds retry decisions from current attempt", () => {
    using execution = new TestExecution(
      {
        retry: {
          backoff: "constant",
          delayMs: 5,
          limit: 3,
        },
      },
      () => "ok"
    )

    execution.setAttempt(1)
    const first = execution.buildDecision(new Error("boom"))
    expect(first).toEqual({ delay: 5, isRetryExhausted: false, shouldAttemptRetry: true })

    execution.setAttempt(3)
    const last = execution.buildDecision(new Error("boom"))
    expect(last).toEqual({ delay: 0, isRetryExhausted: true, shouldAttemptRetry: false })
  })

  it("returns timeout control result when waiting retry delay", async () => {
    using execution = new TestExecution(
      {
        timeout: 0,
      },
      () => "ok"
    )

    const delayed = await execution.waitDelay(10)

    expect(delayed).toBeInstanceOf(TimeoutError)
  })
})
