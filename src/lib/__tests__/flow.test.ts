import { describe, expect, it } from "bun:test"
import { CancellationError, RetryExhaustedError, TimeoutError } from "../errors"
import { executeFlow } from "../flow"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe("executeFlow", () => {
  it("throws when no task calls $exit", async () => {
    try {
      await executeFlow(
        {},
        {
          a() {
            return 1
          },
          async b() {
            const a = await this.$result.a
            return a + 1
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("Flow completed without exit")
    }
  })

  it("returns early when a task calls $exit", async () => {
    const result = await executeFlow(
      {},
      {
        a() {
          return this.$exit("done" as const)
        },
        async b() {
          await sleep(50)
          return 2
        },
      }
    )

    expect(result).toBe("done")
  })

  it("returns early when a dependent task reads a task that already exited", async () => {
    const result = await executeFlow(
      {},
      {
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
      }
    )

    expect(result).toBe("done")
  })

  it("resolves dependent execution in a -> b -> c order", async () => {
    const order: string[] = []

    const result = await executeFlow(
      {},
      {
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
          return this.$exit(`exit-${b}`)
        },
      }
    )

    expect(order).toEqual(["a", "b", "c"])
    expect(result).toBe("exit-2")
  })

  it("still runs disposer cleanup on early exit", async () => {
    const calls: string[] = []

    const result = await executeFlow(
      {},
      {
        a() {
          this.$disposer.defer(() => {
            calls.push("cleanup")
          })

          return this.$exit("stop")
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

          return null
        },
      }
    )

    expect(result).toBe("stop")
    expect(calls).toEqual(["cleanup"])
  })

  it("throws task failure when no task exits", async () => {
    try {
      await executeFlow(
        {},
        {
          a() {
            throw new Error("boom")
          },
          b() {
            return 1
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("boom")
    }
  })

  it("rejects when a task awaits its own result", async () => {
    try {
      await executeFlow(
        {},
        {
          async a() {
            return await (this.$result as Record<string, Promise<unknown>>).a
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toContain("cannot await its own result")
    }
  })

  it("rejects when accessing inherited keys on $result", async () => {
    try {
      await executeFlow(
        {},
        {
          async a() {
            const key = "toString"
            const value = (this.$result as Record<string, Promise<unknown>>)[key]
            return await value
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toContain("Unknown task")
    }
  })

  it("applies wrap middleware around flow execution", async () => {
    let wrapCalls = 0

    const result = await executeFlow(
      {
        wraps: [
          (ctx, next) => {
            wrapCalls += 1
            expect(ctx.retry.attempt).toBe(1)
            return next(ctx)
          },
        ],
      },
      {
        a() {
          return this.$exit("done")
        },
      }
    )

    expect(result).toBe("done")
    expect(wrapCalls).toBe(1)
  })

  it("applies retry policy to flow execution", async () => {
    let attempts = 0

    const result = await executeFlow(
      {
        retry: {
          backoff: "constant",
          delayMs: 0,
          limit: 2,
        },
      },
      {
        a() {
          attempts += 1

          if (attempts === 1) {
            throw new Error("boom")
          }

          return this.$exit("ok")
        },
      }
    )

    expect(result).toBe("ok")
    expect(attempts).toBe(2)
  })

  it("throws RetryExhaustedError when flow retries are exhausted", async () => {
    try {
      await executeFlow(
        {
          retry: {
            backoff: "constant",
            delayMs: 0,
            limit: 2,
          },
        },
        {
          a() {
            throw new Error("boom")
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(RetryExhaustedError)
    }
  })

  it("applies timeout policy to flow execution", async () => {
    try {
      await executeFlow(
        {
          timeout: {
            ms: 5,
            scope: "total",
          },
        },
        {
          async a() {
            await sleep(20)
            return this.$exit("late")
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError)
    }
  })

  it("respects external signal cancellation via composite task signal", async () => {
    const controller = new AbortController()

    const pending = executeFlow(
      { signals: [controller.signal] },
      {
        async a() {
          await sleep(20)

          if (this.$signal.aborted) {
            throw this.$signal.reason
          }

          return this.$exit("done")
        },
      }
    )

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

  it("throws when accessing an unknown task result", async () => {
    try {
      await executeFlow(
        {},
        {
          async a() {
            return await (this.$result as Record<string, Promise<unknown>>).doesNotExist
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toContain("Unknown task")
    }
  })

  it("aborts sibling task signal after early exit", async () => {
    let signalAbortedInB = false

    const result = await executeFlow(
      {},
      {
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
      }
    )

    expect(result).toBe("done")
    expect(signalAbortedInB).toBe(true)
  })
})
