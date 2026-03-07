import { describe, expect, it } from "bun:test"
import { CancellationError, TimeoutError } from "../../errors"
import { sleep } from "../../utils"
import { executeAllSettled } from "../all-settled"

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

  describe("wrap behavior", () => {
    it("applies wrap middleware once around settled execution", async () => {
      let wrapCalls = 0

      const result = await executeAllSettled(
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
          fail() {
            throw new Error("boom")
          },
          ok() {
            return 1
          },
        }
      )

      expect(result.ok).toEqual({ status: "fulfilled", value: 1 })
      expect(result.fail.status).toBe("rejected")
      expect(wrapCalls).toBe(1)
    })

    it("passes retry metadata to wrap middleware", async () => {
      const attempts: number[] = []
      const limits: number[] = []

      const result = await executeAllSettled(
        {
          retry: { backoff: "constant", delayMs: 0, limit: 3 },
          wraps: [
            (ctx, next) => {
              attempts.push(ctx.retry.attempt)
              limits.push(ctx.retry.limit)
              return next(ctx)
            },
          ],
        },
        {
          only() {
            return "ok"
          },
        }
      )

      expect(result.only).toEqual({ status: "fulfilled", value: "ok" })
      expect(attempts).toEqual([1])
      expect(limits).toEqual([3])
    })
  })

  describe("timeout config", () => {
    it("rejects with TimeoutError when tasks exceed configured timeout", async () => {
      try {
        await executeAllSettled(
          {
            timeout: 10,
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

    it("throws CancellationError when external signal is aborted", async () => {
      const controller = new AbortController()

      const promise = executeAllSettled(
        { signals: [controller.signal] },
        {
          async a() {
            await sleep(50)
            return 1
          },
        }
      )

      setTimeout(() => {
        controller.abort()
      }, 10)

      try {
        await promise
        expect.unreachable("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(CancellationError)
      }
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

  describe("retry", () => {
    it("returns settled results when retries are exhausted", async () => {
      let attempts = 0

      const result = await executeAllSettled(
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
            throw new Error("boom")
          },
          b() {
            return "ok"
          },
        }
      )

      expect(result.a.status).toBe("rejected")
      expect(result.b).toEqual({ status: "fulfilled", value: "ok" })
      expect(attempts).toBe(2)
    })

    it("does not retry when all tasks succeed", async () => {
      let attempts = 0

      const result = await executeAllSettled(
        {
          retry: {
            backoff: "constant",
            delayMs: 0,
            limit: 3,
          },
        },
        {
          a() {
            attempts += 1
            return 42
          },
        }
      )

      expect(result.a).toEqual({ status: "fulfilled", value: 42 })
      expect(attempts).toBe(1)
    })

    it("respects shouldRetry returning false", async () => {
      let attempts = 0

      const result = await executeAllSettled(
        {
          retry: {
            backoff: "constant",
            delayMs: 0,
            limit: 3,
            shouldRetry: () => false,
          },
        },
        {
          a() {
            attempts += 1
            throw new Error("boom")
          },
        }
      )

      expect(result.a.status).toBe("rejected")
      expect(attempts).toBe(1)
    })

    it("waits for all tasks to settle before retrying", async () => {
      let concurrentRuns = 0
      let maxConcurrentRuns = 0
      let attempts = 0

      const result = await executeAllSettled(
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

            return 42
          },
          async b() {
            concurrentRuns += 1
            maxConcurrentRuns = Math.max(maxConcurrentRuns, concurrentRuns)
            await sleep(50)
            concurrentRuns -= 1
          },
        }
      )

      expect(result.a).toEqual({ status: "fulfilled", value: 42 })
      expect(maxConcurrentRuns).toBe(1)
    })

    it("retries when a task is rejected and succeeds on next attempt", async () => {
      let attempts = 0

      const result = await executeAllSettled(
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

            return 42
          },
          b() {
            return "ok"
          },
        }
      )

      expect(result.a).toEqual({ status: "fulfilled", value: 42 })
      expect(result.b).toEqual({ status: "fulfilled", value: "ok" })
      expect(attempts).toBe(2)
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
