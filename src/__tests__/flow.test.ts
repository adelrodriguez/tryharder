import { describe, expect, it } from "bun:test"
import { CancellationError, TimeoutError, UnhandledException } from "../errors"
import * as try$ from "../index"
import { expectPanic, sleep } from "./test-utils"

function runCacheFlow(cachedValue: string | null) {
  return try$.flow({
    a() {
      const cached = cachedValue

      if (cached !== null) {
        return this.$exit(cached)
      }

      return null
    },
    async b() {
      await sleep(5)
      return "api-value"
    },
    async c() {
      const apiValue = await this.$result.b
      return this.$exit(`${apiValue}-transformed`)
    },
  })
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

  it("returns value from $exit", async () => {
    const result = await try$.flow({
      async api() {
        await sleep(50)
        return "remote"
      },
      cache() {
        return this.$exit("cached" as const)
      },
    })

    expect(result).toBe("cached")
  })

  it("treats $exit(new TimeoutError()) as a returned value", async () => {
    const timeout = new TimeoutError("returned value")

    const result = await try$.flow({
      a() {
        return this.$exit(timeout)
      },
    })

    expect(result).toBe(timeout)
  })

  it("treats $exit(new CancellationError()) as a returned value", async () => {
    const cancellation = new CancellationError("returned value")

    const result = await try$.flow({
      a() {
        return this.$exit(cancellation)
      },
    })

    expect(result).toBe(cancellation)
  })

  it("runs cleanup on early exit", async () => {
    let cleaned = false

    const result = await try$.flow({
      first() {
        this.$disposer.defer(() => {
          cleaned = true
        })

        return this.$exit(42)
      },
      async second() {
        if (!this.$signal.aborted) {
          await new Promise<void>((resolve) => {
            this.$signal.addEventListener(
              "abort",
              () => {
                resolve()
              },
              { once: true }
            )
          })
        }

        return 0
      },
    })

    expect(result).toBe(42)
    expect(cleaned).toBe(true)
  })

  it("keeps dependency flow order from a to b to c", async () => {
    const order: string[] = []

    const result = await try$.flow({
      a() {
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

    expect(order).toEqual(["a", "b", "c"])
    expect(result).toBe(3)
  })

  it("returns cached value with early exit when cache has data", async () => {
    const result = await runCacheFlow("cached-value")

    expect(result).toBe("cached-value")
  })

  it("fetches and transforms api value when cache is empty", async () => {
    const result = await runCacheFlow(null)

    expect(result).toBe("api-value-transformed")
  })

  it("passes a non-aborted task signal when no external signal is configured", async () => {
    let taskSignalAborted: boolean | undefined

    const result = await try$.flow({
      a() {
        taskSignalAborted = this.$signal.aborted
        return this.$exit("done" as const)
      },
    })

    expect(result).toBe("done")
    expect(taskSignalAborted).toBe(false)
  })

  it("returns early when a dependent task reads a task that already exited", async () => {
    const result = await try$.flow({
      a() {
        return this.$exit("done" as const)
      },
      async b() {
        if (!this.$signal.aborted) {
          await new Promise<void>((resolve) => {
            this.$signal.addEventListener(
              "abort",
              () => {
                resolve()
              },
              { once: true }
            )
          })
        }

        await this.$result.a
        return "never"
      },
    })

    expect(result).toBe("done")
  })

  it("aborts dependent waiters after early exit", async () => {
    let dependencySawAbort = false

    const result = await try$.flow({
      a() {
        return this.$exit("done" as const)
      },
      async b() {
        try {
          await this.$result.a
        } catch {
          dependencySawAbort = this.$signal.aborted
        }

        return null
      },
    })

    expect(result).toBe("done")
    expect(dependencySawAbort).toBe(true)
  })

  it("applies wrap middleware in chained flow execution", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        expect(ctx.retry.attempt).toBe(1)
        return next()
      })
      .flow({
        a() {
          return this.$exit("done")
        },
      })

    expect(result).toBe("done")
    expect(wrapCalls).toBe(1)
  })

  it("runs wrap promise cleanup when flow() starts with an already-aborted signal", async () => {
    const controller = new AbortController()
    let cleaned = false

    controller.abort(new Error("stop"))

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
            return this.$exit("done")
          },
        })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
    }

    expect(cleaned).toBe(true)
  })

  it("runs cleanup after early exit even when a task starts through normal dependency flow", async () => {
    let cleaned = false

    const result = await try$.flow({
      a() {
        this.$disposer.defer(() => {
          cleaned = true
        })

        return 1
      },
      async b() {
        const value = await this.$result.a
        return this.$exit(value + 1)
      },
    })

    expect(result).toBe(2)
    expect(cleaned).toBe(true)
  })

  it("retries leaf work inside flow tasks via nested run()", async () => {
    let attempts = 0

    const result = await try$.flow({
      async a() {
        const value = await try$.retry(2).run(() => {
          attempts += 1

          if (attempts === 1) {
            throw new Error("boom")
          }

          return "ok"
        })

        return this.$exit(value)
      },
    })

    expect(result).toBe("ok")
    expect(attempts).toBe(2)
  })

  it("applies timeout policy to leaf work inside flow tasks via nested run()", async () => {
    const result = await try$.flow({
      async a() {
        return this.$exit(
          await try$.timeout(5).run(async () => {
            await sleep(20)
            return "late"
          })
        )
      },
    })

    expect(result).toBeInstanceOf(TimeoutError)
  })

  it("honors cancellation signal in chained flow execution", async () => {
    const controller = new AbortController()

    const pending = try$.signal(controller.signal).flow({
      async a() {
        await sleep(20)
        return this.$exit("late")
      },
    })

    setTimeout(() => {
      controller.abort(new Error("stop"))
    }, 5)

    try {
      await pending
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
    }
  })

  it("propagates external cancellation while tasks use disposer and dependency results", async () => {
    const controller = new AbortController()
    let cleaned = false
    let dependencySawAbort = false

    const pending = try$.signal(controller.signal).flow({
      async a() {
        this.$disposer.defer(() => {
          cleaned = true
        })

        if (!this.$signal.aborted) {
          await new Promise<void>((resolve) => {
            this.$signal.addEventListener(
              "abort",
              () => {
                resolve()
              },
              { once: true }
            )
          })
        }

        throw this.$signal.reason
      },
      async b() {
        try {
          await this.$result.a
        } catch {
          dependencySawAbort = this.$signal.aborted
          throw this.$signal.reason
        }

        return this.$exit("late")
      },
    })

    setTimeout(() => {
      controller.abort(new Error("stop"))
    }, 5)

    try {
      await pending
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
    }

    expect(cleaned).toBe(true)
    expect(dependencySawAbort).toBe(true)
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

  it("returns exit value when $exit fires before a sibling error", async () => {
    const result = await try$.flow({
      a() {
        return this.$exit("done")
      },
      async b() {
        await sleep(10)
        throw new Error("late error")
      },
    })

    expect(result).toBe("done")
  })

  it("throws error when a task fails before a sibling calls $exit", async () => {
    try {
      await try$.flow({
        a() {
          throw new Error("fast error")
        },
        async b() {
          await sleep(10)
          return this.$exit("late exit")
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("fast error")
    }
  })

  it("surfaces a task that throws undefined", async () => {
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
    }
  })

  it("aborts sibling task signal after early exit", async () => {
    let signalAbortedInB = false

    const result = await try$.flow({
      a() {
        return this.$exit("done" as const)
      },
      async b() {
        if (!this.$signal.aborted) {
          await new Promise<void>((resolve) => {
            this.$signal.addEventListener(
              "abort",
              () => {
                resolve()
              },
              { once: true }
            )
          })
        }

        signalAbortedInB = this.$signal.aborted
        return null
      },
    })

    expect(result).toBe("done")
    expect(signalAbortedInB).toBe(true)
  })
})
