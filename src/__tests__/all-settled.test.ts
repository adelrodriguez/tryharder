import { describe, expect, it, vi } from "vitest"
import { CancellationError, TimeoutError } from "../errors"
import * as try$ from "../index"
import { expectPanic, sleep } from "./test-utils"

describe("allSettled", () => {
  it("returns empty object when task map is empty", async () => {
    const result = await try$.allSettled({})

    expect(result).toEqual({})
  })

  it("returns mixed fulfilled and rejected task results", async () => {
    const boom = new Error("boom")

    const result = await try$.allSettled({
      a() {
        return 1
      },
      b() {
        throw boom
      },
    })

    expect(result).toEqual({
      a: { status: "fulfilled", value: 1 },
      b: { reason: boom, status: "rejected" },
    })
    expect((result.b as { reason: unknown }).reason).toBe(boom)
  })

  it("allows dependent tasks to handle failed dependencies", async () => {
    const failure = new Error("a failed")
    let dependencyError: unknown

    const result = await try$.allSettled({
      a() {
        throw failure
      },
      async b() {
        try {
          return await this.$result.a
        } catch (error) {
          dependencyError = error
          return "fallback"
        }
      },
    })

    expect(result).toEqual({
      a: { reason: failure, status: "rejected" },
      b: { status: "fulfilled", value: "fallback" },
    })
    expect(dependencyError).toBe(failure)
  })

  it("rejects dependent task with the referenced task failure", async () => {
    const error = new Error("a failed")

    const result = await try$.allSettled({
      a() {
        throw error
      },
      async b() {
        const a = await this.$result.a
        return a
      },
    })

    expect((result.a as { reason: unknown }).reason).toBe(error)
    expect((result.b as { reason: unknown }).reason).toBe(error)
    expect(result.b.status).toBe("rejected")
  })

  it("throws a Panic from a self-referential task instead of recording it as a result", async () => {
    try {
      await try$.allSettled({
        async a() {
          return await (this.$result as Record<string, Promise<unknown>>).a
        },
        b() {
          return 1
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_SELF_REFERENCE")
    }
  })

  it("aborts sibling signals on a Panic and waits for siblings to settle before throwing", async () => {
    const events: string[] = []
    let siblingReason: unknown

    try {
      await try$.allSettled({
        async a() {
          await Promise.resolve()
          return await (this.$result as Record<string, Promise<unknown>>).a
        },
        async b() {
          await new Promise<void>((resolve) => {
            this.$signal.addEventListener(
              "abort",
              () => {
                resolve()
              },
              { once: true }
            )
          })
          siblingReason = this.$signal.reason
          await Promise.resolve()
          events.push("sibling:settled")
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      events.push("rejected")
      expectPanic(error, "TASK_SELF_REFERENCE")
      expect(siblingReason).toBe(error)
    }

    expect(events).toEqual(["sibling:settled", "rejected"])
  })

  it("throws a Panic from an unknown task reference", async () => {
    try {
      await try$.allSettled({
        async a() {
          return await (this.$result as Record<string, Promise<unknown>>).doesNotExist
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_UNKNOWN_REFERENCE")
    }
  })

  it("throws a Panic from an invalid handler", async () => {
    try {
      await try$.allSettled({
        a: 123,
      } as unknown as {
        a(): number
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_INVALID_HANDLER")
    }
  })

  it("applies nested run() policies inside allSettled tasks", async () => {
    vi.useFakeTimers()

    try {
      let attempts = 0

      const promise = try$.allSettled({
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
          const value = await try$.timeout(5).run(async () => {
            await sleep(20)
            return 2
          })

          if (value instanceof Error) {
            throw value
          }

          return value
        },
      })

      await vi.advanceTimersByTimeAsync(20)
      const result = await promise

      expect(result.a).toEqual({ status: "fulfilled", value: 1 })
      expect(result.b.status).toBe("rejected")
      expect((result.b as { reason: unknown }).reason).toBeInstanceOf(TimeoutError)
      expect(attempts).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not abort sibling signals when one task fails", async () => {
    let signalAbortedAfterFailure: boolean | undefined

    const result = await try$.allSettled({
      a() {
        throw new Error("a failed")
      },
      async b() {
        // Wait until the sibling failure is observable before reading the signal.
        await this.$result.a.catch(() => null)
        signalAbortedAfterFailure = this.$signal.aborted
        return "b done"
      },
    })

    expect(signalAbortedAfterFailure).toBe(false)
    expect(result.b).toEqual({ status: "fulfilled", value: "b done" })
  })

  it("applies wrap middleware around allSettled execution", async () => {
    const boom = new Error("boom")
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        expect(ctx.retry.attempt).toBe(1)
        return next()
      })
      .allSettled({
        fail() {
          throw boom
        },
        ok() {
          return 1
        },
      })

    expect(result).toEqual({
      fail: { reason: boom, status: "rejected" },
      ok: { status: "fulfilled", value: 1 },
    })
    expect(wrapCalls).toBe(1)
  })

  it("holds cancellation until non-cooperative tasks settle", async () => {
    const controller = new AbortController()
    const reason = new Error("stop")
    let markStarted!: () => void
    let markFinished!: () => void
    let releaseTask!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const finished = new Promise<void>((resolve) => {
      markFinished = resolve
    })
    const taskBlocker = new Promise<void>((resolve) => {
      releaseTask = resolve
    })

    const pending = try$.signal(controller.signal).allSettled({
      async blocked() {
        markStarted()

        try {
          await taskBlocker
          return 1
        } finally {
          markFinished()
        }
      },
    })

    await started
    controller.abort(reason)

    const observed = pending.then(
      () => "resolved" as const,
      (error: unknown) => error
    )
    const outcome = await Promise.race([observed, sleep(0).then(() => "blocked" as const)])

    // The orchestration must stay pending while the task is still running.
    expect(outcome).toBe("blocked")

    releaseTask()
    await finished

    const error = await observed

    expect(error).toBeInstanceOf(CancellationError)
    expect((error as CancellationError).cause).toBe(reason)
  })

  it("runs disposer cleanup for both fulfilled and rejected tasks", async () => {
    const boom = new Error("boom")
    let cleanedA = false
    let cleanedB = false

    const result = await try$.allSettled({
      a() {
        this.$disposer.defer(() => {
          cleanedA = true
        })
        return 1
      },
      b() {
        this.$disposer.defer(() => {
          cleanedB = true
        })
        throw boom
      },
    })

    expect(result).toEqual({
      a: { status: "fulfilled", value: 1 },
      b: { reason: boom, status: "rejected" },
    })
    expect(cleanedA).toBe(true)
    expect(cleanedB).toBe(true)
  })

  it("waits for in-flight tasks to settle before rejecting on the graph deadline", async () => {
    vi.useFakeTimers()

    try {
      let taskSettled = false
      let rejection: unknown

      const promise = try$
        .timeout(10)
        .allSettled({
          async a() {
            await sleep(40)
            taskSettled = true
            return "late" as const
          },
        })
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => {
            rejection = error
          }
        )

      await vi.advanceTimersByTimeAsync(10)
      expect(rejection).toBeUndefined()
      expect(taskSettled).toBe(false)

      await vi.advanceTimersByTimeAsync(30)
      await promise

      expect(taskSettled).toBe(true)
      expect(rejection).toBeInstanceOf(TimeoutError)
    } finally {
      vi.useRealTimers()
    }
  })
})
