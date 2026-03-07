import { describe, expect, it } from "bun:test"
import { CancellationError, Panic } from "../../errors"
import { sleep } from "../../utils"
import { executeAll } from "../all"

describe("executeAll", () => {
  describe("basic parallel execution", () => {
    it("runs independent tasks in parallel", async () => {
      const result = await executeAll(
        {},
        {
          a() {
            return 1
          },
          b() {
            return "hello"
          },
        }
      )

      expect(result.a).toBe(1)
      expect(result.b).toBe("hello")
    })

    it("runs async tasks in parallel", async () => {
      const result = await executeAll(
        {},
        {
          async a() {
            await sleep(10)
            return 1
          },
          async b() {
            await sleep(10)
            return 2
          },
        }
      )

      expect(result.a).toBe(1)
      expect(result.b).toBe(2)
    })

    it("runs mixed sync/async tasks", async () => {
      const result = await executeAll(
        {},
        {
          a() {
            return "sync"
          },
          async b() {
            await sleep(5)
            return "async"
          },
        }
      )

      expect(result.a).toBe("sync")
      expect(result.b).toBe("async")
    })
  })

  describe("result resolution", () => {
    it("resolves a single task result via this.$result", async () => {
      const result = await executeAll(
        {},
        {
          a() {
            return 10
          },
          async b() {
            const a = await this.$result.a
            return a + 5
          },
        }
      )

      expect(result.a).toBe(10)
      expect(result.b).toBe(15)
    })

    it("resolves chained task results", async () => {
      const result = await executeAll(
        {},
        {
          a() {
            return 1
          },
          async b() {
            const a = await this.$result.a
            return a + 1
          },
          async c() {
            const b = await this.$result.b
            return b + 1
          },
        }
      )

      expect(result.a).toBe(1)
      expect(result.b).toBe(2)
      expect(result.c).toBe(3)
    })

    it("supports fan-out (multiple tasks depending on same task)", async () => {
      const result = await executeAll(
        {},
        {
          async a() {
            const s = await this.$result.shared
            return s + 1
          },
          async b() {
            const s = await this.$result.shared
            return s + 2
          },
          shared() {
            return 100
          },
        }
      )

      expect(result.a).toBe(101)
      expect(result.b).toBe(102)
    })

    it("resolves multiple task results from one task", async () => {
      const result = await executeAll(
        {},
        {
          async sum() {
            const [x, y] = await Promise.all([this.$result.x, this.$result.y])
            return x + y
          },
          x() {
            return 10
          },
          y() {
            return 20
          },
        }
      )

      expect(result.sum).toBe(30)
    })

    it("rejects when accessing an unknown task result", async () => {
      try {
        await executeAll(
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

    it("rejects when a task accesses its own result", async () => {
      try {
        await executeAll(
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
      }
    })

    it("rejects with TASK_INVALID_HANDLER when a task is not a function", async () => {
      try {
        await executeAll({}, {
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
  })

  describe("error handling", () => {
    it("waits for all tasks to settle before returning on failure", async () => {
      let slowTaskSettled = false

      await executeAll(
        {},
        {
          a() {
            throw new Error("boom")
          },
          async b() {
            await sleep(50)
            slowTaskSettled = true
          },
        }
      ).catch(() => null)

      expect(slowTaskSettled).toBe(true)
    })

    it("rejects on first task failure (fail-fast)", async () => {
      try {
        await executeAll(
          {},
          {
            a() {
              throw new Error("task a failed")
            },
            async b() {
              await sleep(50)
              return "b done"
            },
          }
        )
        expect.unreachable("should have thrown")
      } catch (error) {
        expect((error as Error).message).toBe("task a failed")
      }
    })

    it("propagates errors through task results", async () => {
      try {
        await executeAll(
          {},
          {
            a() {
              throw new Error("a boom")
            },
            async b() {
              const a = await this.$result.a
              return a
            },
          }
        )
        expect.unreachable("should have thrown")
      } catch (error) {
        expect((error as Error).message).toBe("a boom")
      }
    })

    it("rejects with Panic when async catch rejects", async () => {
      try {
        await executeAll(
          {},
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
        expect(error).toBeInstanceOf(Panic)
        expect((error as Panic).code).toBe("ALL_CATCH_HANDLER_REJECT")
      }
    })
  })

  describe("return values", () => {
    it("preserves various types", async () => {
      const result = await executeAll(
        {},
        {
          arr() {
            return [1, 2, 3]
          },
          bool() {
            return true
          },
          nil() {
            return null
          },
          num() {
            return 42
          },
          obj() {
            return { key: "value" }
          },
          str() {
            return "hello"
          },
        }
      )

      expect(result.num).toBe(42)
      expect(result.str).toBe("hello")
      expect(result.bool).toBe(true)
      expect(result.nil).toBeNull()
      expect(result.arr).toEqual([1, 2, 3])
      expect(result.obj).toEqual({ key: "value" })
    })
  })

  describe("edge cases", () => {
    it("handles empty task map", async () => {
      const result = await executeAll({}, {})

      expect(result).toEqual({})
    })

    it("handles a single task", async () => {
      const result = await executeAll(
        {},
        {
          only() {
            return "solo"
          },
        }
      )

      expect(result.only).toBe("solo")
    })
  })

  describe("performance", () => {
    it("runs truly in parallel (not sequentially)", async () => {
      const a = async () => {
        await sleep(50)
        return 1
      }

      const b = async () => {
        await sleep(50)
        return 2
      }

      const c = async () => {
        await sleep(50)
        return 3
      }

      const start = Date.now()

      await executeAll(
        {},
        {
          a,
          b,
          c,
        }
      )

      const elapsed = Date.now() - start
      const sequentialStart = Date.now()

      await a()
      await b()
      await c()

      const sequentialElapsed = Date.now() - sequentialStart

      expect(elapsed).toBeLessThan(sequentialElapsed - 20)
    })
  })

  describe("abort signal ($signal)", () => {
    it("provides $signal to each task", async () => {
      let receivedSignal: AbortSignal | undefined

      await executeAll(
        {},
        {
          a() {
            receivedSignal = this.$signal
            return 1
          },
        }
      )

      expect(receivedSignal).toBeInstanceOf(AbortSignal)
      expect(receivedSignal?.aborted).toBe(false)
    })

    it("auto-aborts $signal on sibling failure", async () => {
      let signalAborted = false

      const promise = executeAll(
        {},
        {
          async a() {
            await sleep(10)
            signalAborted = this.$signal.aborted
            return 1
          },
          b() {
            throw new Error("b failed")
          },
        }
      )

      await promise.catch(() => null)
      await sleep(20)
      expect(signalAborted).toBe(true)
    })

    it("propagates external signal from builder config", async () => {
      const controller = new AbortController()
      let taskSignalAborted = false

      const promise = executeAll(
        { signals: [controller.signal] },
        {
          async a() {
            await sleep(50)
            taskSignalAborted = this.$signal.aborted
            return 1
          },
        }
      )

      setTimeout(() => {
        controller.abort(new Error("external abort"))
      }, 10)

      await promise.catch(() => null)
      await sleep(60)
      expect(taskSignalAborted).toBe(true)
    })

    it("throws CancellationError for already-aborted external signal", async () => {
      const controller = new AbortController()
      controller.abort(new Error("pre-aborted"))

      try {
        await executeAll(
          { signals: [controller.signal] },
          {
            a() {
              return 1
            },
          }
        )
        expect.unreachable("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(CancellationError)
      }
    })

    it("rejects with CancellationError when signal aborts during catch execution", async () => {
      const controller = new AbortController()

      const promise = executeAll(
        { signals: [controller.signal] },
        {
          a() {
            throw new Error("boom")
          },
        },
        {
          catch: async () => {
            await sleep(20)
            return "mapped"
          },
        }
      )

      setTimeout(() => {
        controller.abort(new Error("external abort"))
      }, 5)

      try {
        await promise
        expect.unreachable("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(CancellationError)
      }
    })
  })

  describe("disposer ($disposer)", () => {
    it("provides $disposer to each task", async () => {
      let hasDisposer = false

      await executeAll(
        {},
        {
          a() {
            hasDisposer = this.$disposer instanceof AsyncDisposableStack
            return 1
          },
        }
      )

      expect(hasDisposer).toBe(true)
    })

    it("runs disposer cleanup after all tasks complete", async () => {
      let cleaned = false

      await executeAll(
        {},
        {
          a() {
            this.$disposer.defer(() => {
              cleaned = true
            })
            return 1
          },
        }
      )

      expect(cleaned).toBe(true)
    })

    it("runs disposer cleanup even on failure", async () => {
      let cleaned = false

      await executeAll(
        {},
        {
          a() {
            this.$disposer.defer(() => {
              cleaned = true
            })
            throw new Error("boom")
          },
        }
      ).catch(() => null)

      expect(cleaned).toBe(true)
    })
  })

  describe("builder integration", () => {
    it("rejects retry/timeout config for orchestration execution", async () => {
      try {
        await executeAll(
          {
            retry: { backoff: "constant", limit: 2 },
            timeout: 100,
          },
          {
            only() {
              return 1
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

    it("passes builder signal config to task context", async () => {
      const controller = new AbortController()
      let signalSeen = false

      await executeAll(
        { signals: [controller.signal] },
        {
          a() {
            signalSeen = this.$signal instanceof AbortSignal
            return 1
          },
        }
      )

      expect(signalSeen).toBe(true)
    })

    it("applies wrap middleware around fail-fast all execution", async () => {
      let wrapCalls = 0

      const result = await executeAll(
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
            return 1
          },
        }
      )

      expect(result).toEqual({ a: 1 })
      expect(wrapCalls).toBe(1)
    })

    it("uses default retry metadata in wrap middleware for orchestration execution", async () => {
      const attempts: number[] = []
      const limits: number[] = []

      const result = await executeAll(
        {
          wraps: [
            (ctx, next) => {
              attempts.push(ctx.retry.attempt)
              limits.push(ctx.retry.limit)
              return next(ctx)
            },
          ],
        },
        {
          a() {
            return 1
          },
        }
      )

      expect(result).toEqual({ a: 1 })
      expect(attempts).toEqual([1])
      expect(limits).toEqual([1])
    })
  })
})
