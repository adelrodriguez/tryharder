import { describe, expect, it, vi } from "vitest"
import { CancellationError, TimeoutError, UnhandledException } from "../errors"
import * as try$ from "../index"
import { expectPanic } from "./test-utils"

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve()
      },
      { once: true }
    )
  })
}

function never(): Promise<never> {
  return new Promise(() => {
    // Never settles.
  })
}

function runCacheFlow(cachedValue: string | null) {
  let fetchCalls = 0

  const pending = try$.flow({
    cached() {
      if (cachedValue !== null) {
        return this.$exit(cachedValue)
      }

      return null
    },
    async fetched() {
      await this.$result.cached
      fetchCalls += 1
      return "api-value"
    },
    async stored() {
      const apiValue = await this.$result.fetched
      return this.$exit(`${apiValue}-transformed`)
    },
  })

  return pending.then((result) => ({ fetchCalls, result }))
}

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
      expectPanic(error, "FLOW_NO_EXIT")
    }
  })

  it("aborts siblings on $exit and waits for them to settle before cleanup", async () => {
    const events: string[] = []

    const result = await try$.flow({
      async awaiting() {
        events.push(`awaiting:start:aborted=${String(this.$signal.aborted)}`)
        await waitForAbort(this.$signal)
        await Promise.resolve()
        events.push("awaiting:settled")
        return null
      },
      exiting() {
        this.$disposer.defer(() => {
          events.push("cleanup")
        })

        return this.$exit("cached" as const)
      },
    })

    expect(result).toBe("cached")
    expect(events).toEqual(["awaiting:start:aborted=false", "awaiting:settled", "cleanup"])
  })

  it("throws a Panic from a sibling that settles after the first $exit", async () => {
    try {
      await try$.flow({
        async awaiting() {
          await waitForAbort(this.$signal)
          return await (this.$result as Record<string, Promise<unknown>>).missing
        },
        exiting() {
          return this.$exit("cached" as const)
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_UNKNOWN_REFERENCE")
    }
  })

  it("resolves exactly one winner when two tasks exit near-simultaneously", async () => {
    const disposed: string[] = []
    const exitAttempts: string[] = []

    const result = await try$.flow({
      async first() {
        this.$disposer.defer(() => {
          disposed.push("first")
        })

        await Promise.resolve()
        exitAttempts.push("first")
        return this.$exit("first" as const)
      },
      async second() {
        this.$disposer.defer(() => {
          disposed.push("second")
        })
        await Promise.resolve()
        exitAttempts.push("second")
        return this.$exit("second" as const)
      },
    })

    // Both tasks yield once, queuing their exits and rejection handlers in
    // task order before the flow reads the winner. The first value remains.
    expect(exitAttempts).toEqual(["first", "second"])
    expect(result).toBe("first")
    expect(disposed).toEqual(["second", "first"])
  })

  it.each([
    ["TimeoutError", new TimeoutError("returned value")],
    ["CancellationError", new CancellationError("returned value")],
  ])("treats $exit(new %s()) as a returned value", async (_, value) => {
    const result = await try$.flow({
      a() {
        return this.$exit(value)
      },
    })

    expect(result).toBe(value)
  })

  it("runs dependencies in order and cleans up after the exit", async () => {
    const order: string[] = []

    const result = await try$.flow({
      a() {
        this.$disposer.defer(() => {
          order.push("cleanup")
        })

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

    expect(order).toEqual(["a", "b", "c", "cleanup"])
    expect(result).toBe(3)
  })

  it("returns the cached value and skips dependent work on a cache hit", async () => {
    const { fetchCalls, result } = await runCacheFlow("cached-value")

    expect(result).toBe("cached-value")
    expect(fetchCalls).toBe(0)
  })

  it("fetches and transforms the api value on a cache miss", async () => {
    const { fetchCalls, result } = await runCacheFlow(null)

    expect(result).toBe("api-value-transformed")
    expect(fetchCalls).toBe(1)
  })

  it("rejects dependent $result reads with the abort reason after early exit", async () => {
    let dependencyError: unknown
    let signalReason: unknown
    let didContinue = false

    const result = await try$.flow({
      a() {
        return this.$exit("done" as const)
      },
      async b() {
        try {
          await this.$result.a
          didContinue = true
        } catch (error) {
          dependencyError = error
          signalReason = this.$signal.reason
        }

        return null
      },
    })

    expect(result).toBe("done")
    expect(didContinue).toBe(false)
    expect(dependencyError).toBeInstanceOf(Error)
    expect(dependencyError).toBe(signalReason)
  })

  it("runs wrap middleware once around flow execution", async () => {
    const events: string[] = []

    const result = await try$
      .wrap(async (ctx, next) => {
        events.push(`wrap:before:attempt=${String(ctx.retry.attempt)}`)
        const value = await next()
        events.push("wrap:after")
        return value
      })
      .flow({
        a() {
          events.push("task")
          return this.$exit("done")
        },
      })

    expect(result).toBe("done")
    expect(events).toEqual(["wrap:before:attempt=1", "task", "wrap:after"])
  })

  it("runs wrap promise cleanup and skips tasks when flow() starts with an already-aborted signal", async () => {
    const controller = new AbortController()
    const reason = new Error("stop")
    let cleaned = false
    let taskCalls = 0

    controller.abort(reason)

    try {
      await try$
        .wrap((_, next) =>
          Promise.resolve(next()).finally(() => {
            cleaned = true
          })
        )
        .signal(controller.signal)
        .flow({
          a() {
            taskCalls += 1
            return this.$exit("done")
          },
        })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
      expect((error as CancellationError).cause).toBe(reason)
    }

    expect(cleaned).toBe(true)
    expect(taskCalls).toBe(0)
  })

  it("returns CancellationError without an unhandled rejection when a task aborts the signal synchronously", async () => {
    const controller = new AbortController()
    const reason = new Error("stop")
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => {
      unhandled.push(error)
    }

    process.on("unhandledRejection", onUnhandled)

    try {
      const error = await try$
        .signal(controller.signal)
        .flow({
          a() {
            controller.abort(reason)
            throw new Error("after abort")
          },
        })
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => error
        )

      expect(error).toBeInstanceOf(CancellationError)
      expect((error as CancellationError).cause).toBe(reason)

      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }

    expect(unhandled).toEqual([])
  })

  it("returns TimeoutError without an unhandled rejection when the deadline passes during synchronous task startup", async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => {
      unhandled.push(error)
    }

    process.on("unhandledRejection", onUnhandled)

    try {
      vi.useFakeTimers()
      let error: unknown

      try {
        error = await try$
          .timeout(5)
          .flow({
            a() {
              // The deadline passes before the fake timer can fire.
              vi.setSystemTime(Date.now() + 20)
              throw new Error("after deadline")
            },
          })
          .then(
            () => expect.unreachable("should have thrown"),
            (error: unknown) => error
          )
      } finally {
        vi.useRealTimers()
      }

      expect(error).toBeInstanceOf(TimeoutError)

      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }

    expect(unhandled).toEqual([])
  })

  it("propagates external cancellation while tasks use disposer and dependency results", async () => {
    const controller = new AbortController()
    const reason = new Error("stop")
    let cleaned = false
    let dependencyError: unknown

    try {
      await try$.signal(controller.signal).flow({
        async a() {
          this.$disposer.defer(() => {
            cleaned = true
          })

          // Abort after flow() has attached its cancellation race.
          await Promise.resolve()
          controller.abort(reason)
          await this.$race(never())
          return this.$exit("late")
        },
        async b() {
          try {
            await this.$result.a
          } catch (error) {
            dependencyError = error
            throw error
          }

          return this.$exit("late")
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
      expect((error as CancellationError).cause).toBe(reason)
    }

    expect(cleaned).toBe(true)
    expect(dependencyError).toBe(reason)
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
      expectPanic(error, "TASK_SELF_REFERENCE")
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
      expectPanic(error, "TASK_UNKNOWN_REFERENCE")
    }
  })

  it("rejects with TASK_INVALID_HANDLER when a task is not a function", async () => {
    try {
      await try$.flow({
        a: 123,
      } as unknown as {
        a(): number
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_INVALID_HANDLER")
    }
  })

  it("returns the exit value and ignores a sibling error thrown after $exit", async () => {
    let siblingThrew = false

    const result = await try$.flow({
      async a() {
        await waitForAbort(this.$signal)
        siblingThrew = true
        throw new Error("late error")
      },
      b() {
        return this.$exit("done")
      },
    })

    expect(result).toBe("done")
    expect(siblingThrew).toBe(true)
  })

  it("throws the task error and aborts a sibling that would exit later", async () => {
    const failure = new Error("fast error")
    let siblingReason: unknown

    try {
      await try$.flow({
        async a() {
          await waitForAbort(this.$signal)
          siblingReason = this.$signal.reason
          return this.$exit("late exit")
        },
        b() {
          throw failure
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(failure)
    }

    expect(siblingReason).toBe(failure)
  })

  it("surfaces a task that throws undefined as UnhandledException", async () => {
    try {
      await try$.flow({
        a() {
          // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Intentional coverage for undefined task failures.
          throw undefined
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(UnhandledException)
      expect((error as UnhandledException).cause).toBeUndefined()
    }
  })

  it("bounds the deadline with $race for signal-unaware work", async () => {
    vi.useFakeTimers()

    try {
      let signalReason: unknown

      const promise = try$
        .timeout(10)
        .flow({
          async a() {
            try {
              // Never settles: only $race can end this await.
              await this.$race(never())
            } finally {
              signalReason = this.$signal.reason
            }

            return this.$exit("late" as const)
          },
        })
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => error
        )

      await vi.advanceTimersByTimeAsync(10)
      const error = await promise

      expect(error).toBeInstanceOf(TimeoutError)
      expect(error).toBe(signalReason)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects with TimeoutError when the graph deadline fires before $exit", async () => {
    vi.useFakeTimers()

    try {
      let signalReason: unknown

      const promise = try$
        .timeout(10)
        .flow({
          async a() {
            await waitForAbort(this.$signal)
            signalReason = this.$signal.reason
            return this.$exit("late" as const)
          },
        })
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => error
        )

      await vi.advanceTimersByTimeAsync(10)
      const error = await promise

      expect(error).toBeInstanceOf(TimeoutError)
      expect((error as TimeoutError).message).toBe("Execution exceeded timeout of 10ms")
      expect(error).toBe(signalReason)
    } finally {
      vi.useRealTimers()
    }
  })
})
