import { describe, expect, it } from "bun:test"
import { CancellationError, Panic, UnhandledException } from "../errors"
import * as try$ from "../index"
import { expectPanic, sleep } from "./test-utils"

describe("all", () => {
  it("returns empty object when task map is empty", async () => {
    const result = await try$.all({})

    expect(result).toEqual({})
  })

  it("runs tasks in parallel and returns resolved values", async () => {
    const started: string[] = []

    const result = await try$.all({
      async a() {
        started.push("a")
        await sleep(10)
        return 1
      },
      async b() {
        started.push("b")
        await sleep(10)
        return "ok"
      },
    })

    expect(started).toEqual(["a", "b"])
    expect(result).toEqual({ a: 1, b: "ok" })
  })

  it("supports dependency reads through this.$result", async () => {
    const result = await try$.all({
      a() {
        return 10
      },
      async b() {
        const a = await this.$result.a
        return a + 5
      },
    })

    expect(result).toEqual({ a: 10, b: 15 })
  })

  it("passes a non-aborted task signal when no external signal is configured", async () => {
    let taskSignalAborted: boolean | undefined

    const result = await try$.all({
      a() {
        taskSignalAborted = this.$signal.aborted
        return 1
      },
    })

    expect(result).toEqual({ a: 1 })
    expect(taskSignalAborted).toBe(false)
  })

  it("rejects on first task failure", async () => {
    try {
      await try$.all({
        a() {
          throw new Error("boom")
        },
        async b() {
          await sleep(20)
          return 2
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("boom")
    }
  })

  it("rejects after a sibling stops on abort", async () => {
    let slowTaskSettled = false

    const result = await Promise.race([
      try$
        .all({
          a() {
            throw new Error("boom")
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

            slowTaskSettled = true
            return 2
          },
        })
        .then(
          () => "resolved" as const,
          (error: unknown) => error
        ),
      sleep(50).then(() => "timed-out" as const),
    ])

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe("boom")
    expect(slowTaskSettled).toBe(true)
  })

  it("aborts sibling signals on failure", async () => {
    let signalAborted = false

    const pending = try$.all({
      async a() {
        await sleep(10)
        signalAborted = this.$signal.aborted
        return 1
      },
      b() {
        throw new Error("boom")
      },
    })

    await pending.catch(() => null)
    await sleep(20)

    expect(signalAborted).toBe(true)
  })

  it("aborts dependency waiters when a sibling task fails", async () => {
    let signalAbortedWhileWaiting = false

    try {
      await try$.all({
        a() {
          throw new Error("boom")
        },
        async b() {
          try {
            await this.$result.a
            return 2
          } catch (error) {
            signalAbortedWhileWaiting = this.$signal.aborted
            throw error
          }
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("boom")
    }

    expect(signalAbortedWhileWaiting).toBe(true)
  })

  it("rejects when a task accesses its own result", async () => {
    try {
      await try$.all({
        async a() {
          return await (this.$result as Record<string, Promise<unknown>>).a
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_SELF_REFERENCE")
    }
  })

  it("rejects when accessing an unknown task result", async () => {
    try {
      await try$.all({
        async a() {
          return await (this.$result as Record<string, Promise<unknown>>).doesNotExist
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_UNKNOWN_REFERENCE")
    }
  })

  it("rejects with TASK_INVALID_HANDLER when a task is not a function", async () => {
    try {
      await try$.all({
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

  it("normalizes undefined task failures", async () => {
    try {
      await try$.all({
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

  it("maps non-Error task failures before rejecting dependent tasks", async () => {
    let dependencyError: unknown

    try {
      await try$.all({
        async a() {
          await sleep(5)
          // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Intentional coverage for non-Error task failures.
          throw "a boom"
        },
        async b() {
          try {
            return await this.$result.a
          } catch (error) {
            dependencyError = error
            throw error
          }
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(UnhandledException)
      expect((error as Error).message).toBe("Unhandled exception")
      expect((error as Error).cause).toBe("a boom")
    }

    expect(dependencyError).toBeInstanceOf(UnhandledException)
    expect((dependencyError as Error).message).toBe("Unhandled exception")
    expect((dependencyError as Error).cause).toBe("a boom")
  })

  it("returns mapped value when catch handles failure", async () => {
    const result = await try$.all(
      {
        a() {
          throw new Error("boom")
        },
        b() {
          return 2
        },
      },
      {
        catch: () => "mapped" as const,
      }
    )

    expect(result).toBe("mapped")
  })

  it("passes failed task and currently available partial results to catch", async () => {
    const result = await try$.all(
      {
        async a() {
          await sleep(5)
          return 1
        },
        b() {
          throw new Error("boom")
        },
      },
      {
        catch: (_error, ctx) => ({
          failedTask: ctx.failedTask,
          hasSignal: ctx.signal instanceof AbortSignal,
          partialA: ctx.partial.a,
        }),
      }
    )

    expect(result).toEqual({
      failedTask: "b",
      hasSignal: true,
      partialA: undefined,
    })
  })

  it("keeps catch-context signal usable after failure", async () => {
    const result = await try$.all(
      {
        a() {
          throw new Error("boom")
        },
      },
      {
        catch: (_error, ctx) => ({
          aborted: ctx.signal.aborted,
          hasSignal: ctx.signal instanceof AbortSignal,
        }),
      }
    )

    expect(result).toEqual({
      aborted: true,
      hasSignal: true,
    })
  })

  it("throws Panic when all catch throws", async () => {
    try {
      await try$.all(
        {
          a() {
            throw new Error("boom")
          },
        },
        {
          catch: () => {
            throw new Error("catch failed")
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "ALL_CATCH_HANDLER_THROW")
    }
  })

  it("throws Panic when all catch rejects", async () => {
    try {
      await try$.all(
        {
          a() {
            throw new Error("boom")
          },
        },
        {
          catch: async () => {
            await Promise.resolve()
            throw new Error("catch failed")
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "ALL_CATCH_HANDLER_REJECT")
    }
  })

  it("retries leaf work inside all() tasks via nested run()", async () => {
    let attempts = 0

    const result = await try$.all({
      async a() {
        return await try$.retry(2).run(() => {
          attempts += 1

          if (attempts === 1) {
            throw new Error("boom")
          }

          return 1
        })
      },
      async b() {
        await sleep(5)
        return 2
      },
    })

    expect(result).toEqual({ a: 1, b: 2 })
    expect(attempts).toBe(2)
  })

  it("applies wrap middleware around all execution", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        expect(ctx.retry.attempt).toBe(1)
        return next()
      })
      .all({
        a() {
          return 1
        },
      })

    expect(result).toEqual({ a: 1 })
    expect(wrapCalls).toBe(1)
  })

  it("runs wrap promise cleanup when all() starts with an already-aborted signal", async () => {
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
        .all({
          a() {
            return 1
          },
        })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
    }

    expect(cleaned).toBe(true)
  })

  it("honors cancellation signal from builder options", async () => {
    const controller = new AbortController()

    const pending = try$.signal(controller.signal).all({
      async a() {
        await sleep(20)

        if (this.$signal.aborted) {
          throw this.$signal.reason
        }

        return 1
      },
      async b() {
        await sleep(20)
        return 2
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

  it("runs disposer cleanup after all tasks complete", async () => {
    let cleaned = false

    await try$.all({
      a() {
        this.$disposer.defer(() => {
          cleaned = true
        })
        return 1
      },
    })

    expect(cleaned).toBe(true)
  })

  it("allows disposer usage in a successful task without external cancellation", async () => {
    let cleaned = false

    const result = await try$.all({
      a() {
        this.$disposer.defer(() => {
          cleaned = true
        })
        return 1
      },
    })

    expect(result).toEqual({ a: 1 })
    expect(cleaned).toBe(true)
  })

  it("runs disposer cleanup even on failure", async () => {
    let cleaned = false

    await try$
      .all({
        a() {
          this.$disposer.defer(() => {
            cleaned = true
          })
          throw new Error("boom")
        },
      })
      .catch(() => null)

    expect(cleaned).toBe(true)
  })
})
