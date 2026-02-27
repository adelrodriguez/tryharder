import { describe, expect, it } from "bun:test"
import { executeAll, executeAllSettled } from "../all"
import { TimeoutError } from "../errors"
import { sleep } from "../utils"

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
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain("Unknown task")
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
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain("cannot await its own result")
      }
    })
  })

  describe("error handling", () => {
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

  describe("timeout config", () => {
    it("rejects with TimeoutError when tasks exceed configured timeout", async () => {
      try {
        await executeAll(
          {
            timeout: {
              ms: 10,
              scope: "total",
            },
          },
          {
            async a() {
              await sleep(50)
              return 1
            },
          }
        )
        expect.unreachable("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError)
      }
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

    it("handles already-aborted external signal", async () => {
      const controller = new AbortController()
      controller.abort(new Error("pre-aborted"))

      let signalAborted = false

      await executeAll(
        { signals: [controller.signal] },
        {
          a() {
            signalAborted = this.$signal.aborted
            return 1
          },
        }
      )

      expect(signalAborted).toBe(true)
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
  })
})

describe("executeAllSettled", () => {
  describe("basic behavior", () => {
    it("returns fulfilled results for all successful tasks", async () => {
      const result = await executeAllSettled(
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

      expect(result.a).toEqual({ status: "fulfilled", value: 1 })
      expect(result.b).toEqual({ status: "fulfilled", value: "hello" })
    })

    it("returns rejected results for failed tasks", async () => {
      const error = new Error("boom")

      const result = await executeAllSettled(
        {},
        {
          a() {
            throw error
          },
          b() {
            return "ok"
          },
        }
      )

      expect(result.a).toEqual({ reason: error, status: "rejected" })
      expect(result.b).toEqual({ status: "fulfilled", value: "ok" })
    })

    it("returns mixed fulfilled and rejected results", async () => {
      const error = new Error("failed")

      const result = await executeAllSettled(
        {},
        {
          a() {
            return 42
          },
          b() {
            throw error
          },
          c() {
            return "done"
          },
        }
      )

      expect(result.a.status).toBe("fulfilled")
      expect(result.b.status).toBe("rejected")
      expect(result.c.status).toBe("fulfilled")
    })

    it("never rejects the outer promise", async () => {
      const result = await executeAllSettled(
        {},
        {
          a() {
            throw new Error("fail 1")
          },
          b() {
            throw new Error("fail 2")
          },
        }
      )

      expect(result.a.status).toBe("rejected")
      expect(result.b.status).toBe("rejected")
    })
  })

  describe("timeout config", () => {
    it("rejects with TimeoutError when tasks exceed configured timeout", async () => {
      try {
        await executeAllSettled(
          {
            timeout: {
              ms: 10,
              scope: "total",
            },
          },
          {
            async a() {
              await sleep(50)
              return 1
            },
          }
        )
        expect.unreachable("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError)
      }
    })
  })

  describe("result references with failures", () => {
    it("resolves when referenced task succeeds", async () => {
      const result = await executeAllSettled(
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

      expect(result.a).toEqual({ status: "fulfilled", value: 10 })
      expect(result.b).toEqual({ status: "fulfilled", value: 15 })
    })

    it("rejects dependent task when referenced task fails", async () => {
      const error = new Error("a failed")

      const result = await executeAllSettled(
        {},
        {
          a() {
            throw error
          },
          async b() {
            const a = await this.$result.a
            return a
          },
        }
      )

      expect(result.a).toEqual({ reason: error, status: "rejected" })
      expect(result.b.status).toBe("rejected")
    })

    it("marks self-referential task as rejected", async () => {
      const result = await executeAllSettled(
        {},
        {
          async a() {
            return await (this.$result as Record<string, Promise<unknown>>).a
          },
          b() {
            return 1
          },
        }
      )

      expect(result.a.status).toBe("rejected")
      expect(result.b).toEqual({ status: "fulfilled", value: 1 })
    })

    it("allows catch-and-handle pattern for failed referenced tasks", async () => {
      const result = await executeAllSettled(
        {},
        {
          a() {
            throw new Error("a failed")
          },
          async b() {
            try {
              return await this.$result.a
            } catch {
              return "fallback"
            }
          },
        }
      )

      expect(result.a.status).toBe("rejected")
      expect(result.b).toEqual({ status: "fulfilled", value: "fallback" })
    })

    it("does not block independent tasks on sibling failure", async () => {
      const result = await executeAllSettled(
        {},
        {
          a() {
            throw new Error("a failed")
          },
          b() {
            return "b is fine"
          },
        }
      )

      expect(result.a.status).toBe("rejected")
      expect(result.b).toEqual({ status: "fulfilled", value: "b is fine" })
    })
  })

  describe("abort signal ($signal)", () => {
    it("provides $signal but does NOT abort on sibling failure", async () => {
      let signalAbortedInB = false

      const result = await executeAllSettled(
        {},
        {
          a() {
            throw new Error("a failed")
          },
          async b() {
            await sleep(20)
            signalAbortedInB = this.$signal.aborted
            return "b done"
          },
        }
      )

      expect(signalAbortedInB).toBe(false)
      expect(result.b).toEqual({ status: "fulfilled", value: "b done" })
    })

    it("still respects external signal", async () => {
      const controller = new AbortController()
      let signalAborted = false

      const promise = executeAllSettled(
        { signals: [controller.signal] },
        {
          async a() {
            await sleep(50)
            signalAborted = this.$signal.aborted
            return 1
          },
        }
      )

      setTimeout(() => {
        controller.abort()
      }, 10)

      await promise
      await sleep(60)
      expect(signalAborted).toBe(true)
    })
  })

  describe("edge cases", () => {
    it("handles empty task map", async () => {
      const result = await executeAllSettled({}, {})

      expect(result).toEqual({})
    })

    it("handles a single successful task", async () => {
      const result = await executeAllSettled(
        {},
        {
          only() {
            return "solo"
          },
        }
      )

      expect(result.only).toEqual({ status: "fulfilled", value: "solo" })
    })

    it("handles a single failed task", async () => {
      const error = new Error("solo fail")

      const result = await executeAllSettled(
        {},
        {
          only() {
            throw error
          },
        }
      )

      expect(result.only).toEqual({ reason: error, status: "rejected" })
    })
  })

  describe("disposer ($disposer)", () => {
    it("runs disposer cleanup after all tasks settle", async () => {
      let cleaned = false

      await executeAllSettled(
        {},
        {
          a() {
            this.$disposer.defer(() => {
              cleaned = true
            })
            return 1
          },
          b() {
            throw new Error("boom")
          },
        }
      )

      expect(cleaned).toBe(true)
    })
  })
})
