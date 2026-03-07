import { describe, expect, it } from "bun:test"
import { CancellationError, Panic } from "../../errors"
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
    it("rejects retry/timeout config for orchestration execution", async () => {
      try {
        await executeAllSettled(
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

    it("applies wrap middleware once around settled execution", async () => {
      let wrapCalls = 0

      const result = await executeAllSettled(
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

    it("uses default retry metadata in wrap middleware for orchestration execution", async () => {
      const attempts: number[] = []
      const limits: number[] = []

      const result = await executeAllSettled(
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
          only() {
            return "ok"
          },
        }
      )

      expect(result.only).toEqual({ status: "fulfilled", value: "ok" })
      expect(attempts).toEqual([1])
      expect(limits).toEqual([1])
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
