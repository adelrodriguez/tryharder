import { describe, expect, it } from "bun:test"
import { CancellationError, Panic, TimeoutError } from "../../errors"
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
      expect(error).toBeInstanceOf(Panic)
      expect((error as Panic).code).toBe("FLOW_NO_EXIT")
    }
  })

  it("rejects retry/timeout config for orchestration execution", async () => {
    try {
      await executeFlow(
        {
          retry: { backoff: "constant", limit: 2 },
          timeout: 100,
        },
        {
          a() {
            return this.$exit("done")
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Panic)
      expect((error as Panic).code).toBe("ORCHESTRATION_UNSUPPORTED_POLICY")
      expect((error as Error).message).toContain("retry")
      expect((error as Error).message).toContain("timeout")
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

  it("treats $exit(new TimeoutError()) as a returned exit value", async () => {
    const timeout = new TimeoutError("returned value")

    const result = await executeFlow(
      {},
      {
        a() {
          return this.$exit(timeout)
        },
      }
    )

    expect(result).toBe(timeout)
  })

  it("treats $exit(new CancellationError()) as a returned exit value", async () => {
    const cancellation = new CancellationError("returned value")

    const result = await executeFlow(
      {},
      {
        a() {
          return this.$exit(cancellation)
        },
      }
    )

    expect(result).toBe(cancellation)
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
      expect(error).toBeInstanceOf(Panic)
      expect((error as Panic).code).toBe("TASK_SELF_REFERENCE")
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
      expect(error).toBeInstanceOf(Panic)
      expect((error as Panic).code).toBe("TASK_UNKNOWN_REFERENCE")
      expect((error as Error).message).toContain("Unknown task")
    }
  })

  it("rejects with TASK_INVALID_HANDLER when a task is not a function", async () => {
    try {
      await executeFlow({}, {
        a: 123,
      } as unknown as {
        a(): number
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Panic)
      expect((error as Panic).code).toBe("TASK_INVALID_HANDLER")
      expect((error as Error).message).toContain('Task "a" is not a function')
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
            return next()
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

  it("uses default retry metadata in wrap middleware for orchestration execution", async () => {
    const attempts: number[] = []
    const limits: number[] = []

    const result = await executeFlow(
      {
        wraps: [
          (ctx, next) => {
            attempts.push(ctx.retry.attempt)
            limits.push(ctx.retry.limit)
            return next()
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
    expect(attempts).toEqual([1])
    expect(limits).toEqual([1])
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
      expect(error).toBeInstanceOf(Panic)
      expect((error as Panic).code).toBe("TASK_UNKNOWN_REFERENCE")
    }
  })

  it("returns exit value when $exit fires before a sibling error", async () => {
    const result = await executeFlow(
      {},
      {
        a() {
          return this.$exit("done")
        },
        async b() {
          await sleep(10)
          throw new Error("late error")
        },
      }
    )

    expect(result).toBe("done")
  })

  it("throws error when a task fails before a sibling calls $exit", async () => {
    try {
      await executeFlow(
        {},
        {
          a() {
            throw new Error("fast error")
          },
          async b() {
            await sleep(10)
            return this.$exit("late exit")
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("fast error")
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
