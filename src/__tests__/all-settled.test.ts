import { describe, expect, it } from "bun:test"
import { CancellationError, Panic, TimeoutError } from "../errors"
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

    expect(result.a).toEqual({ status: "fulfilled", value: 1 })
    expect(result.b).toEqual({ reason: boom, status: "rejected" })
  })

  it("does not reject outer promise when tasks fail", async () => {
    const result = await try$.allSettled({
      a() {
        throw new Error("a failed")
      },
      b() {
        throw new Error("b failed")
      },
    })

    expect(result.a.status).toBe("rejected")
    expect(result.b.status).toBe("rejected")
  })

  it("allows dependent tasks to handle failed dependencies", async () => {
    const result = await try$.allSettled({
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
    })

    expect(result.a.status).toBe("rejected")
    expect(result.b).toEqual({ status: "fulfilled", value: "fallback" })
  })

  it("resolves dependent tasks when referenced task succeeds", async () => {
    const result = await try$.allSettled({
      a() {
        return 10
      },
      async b() {
        const a = await this.$result.a
        return a + 5
      },
    })

    expect(result.a).toEqual({ status: "fulfilled", value: 10 })
    expect(result.b).toEqual({ status: "fulfilled", value: 15 })
  })

  it("passes a non-aborted task signal when no external signal is configured", async () => {
    let taskSignalAborted: boolean | undefined

    const result = await try$.allSettled({
      a() {
        taskSignalAborted = this.$signal.aborted
        return 1
      },
    })

    expect(result.a).toEqual({ status: "fulfilled", value: 1 })
    expect(taskSignalAborted).toBe(false)
  })

  it("rejects dependent task when referenced task fails", async () => {
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

    expect(result.a).toEqual({ reason: error, status: "rejected" })
    expect(result.b.status).toBe("rejected")
  })

  it("marks self-referential task as rejected", async () => {
    const result = await try$.allSettled({
      async a() {
        return await (this.$result as Record<string, Promise<unknown>>).a
      },
      b() {
        return 1
      },
    })

    expect(result.a.status).toBe("rejected")
    expect(result.b).toEqual({ status: "fulfilled", value: 1 })
  })

  it("rejects when accessing an unknown task result", async () => {
    const result = await try$.allSettled({
      async a() {
        return await (this.$result as Record<string, Promise<unknown>>).doesNotExist
      },
    })

    expect(result.a.status).toBe("rejected")
    expect((result.a as { reason: unknown }).reason).toBeInstanceOf(Panic)
    expectPanic((result.a as { reason: unknown }).reason, "TASK_UNKNOWN_REFERENCE")
  })

  it("rejects invalid handlers in the settled result", async () => {
    const result = await try$.allSettled({
      a: 123,
    } as unknown as {
      a(): number
    })

    expect(result.a.status).toBe("rejected")
    expect((result.a as { reason: unknown }).reason).toBeInstanceOf(Panic)
    expectPanic((result.a as { reason: unknown }).reason, "TASK_INVALID_HANDLER")
  })

  it("applies nested run() policies inside allSettled tasks", async () => {
    let attempts = 0

    const result = await try$.allSettled({
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

    expect(result.a).toEqual({ status: "fulfilled", value: 1 })
    expect(result.b.status).toBe("rejected")
    expect(attempts).toBe(2)
  })

  it("does not abort sibling signals when one task fails", async () => {
    let signalAbortedInB = false

    const result = await try$.allSettled({
      a() {
        throw new Error("a failed")
      },
      async b() {
        await sleep(20)
        signalAbortedInB = this.$signal.aborted
        return "b done"
      },
    })

    expect(signalAbortedInB).toBe(false)
    expect(result.b).toEqual({ status: "fulfilled", value: "b done" })
  })

  it("keeps sibling task signals usable after another task fails", async () => {
    const signalStates: boolean[] = []

    const result = await try$.allSettled({
      a() {
        throw new Error("a failed")
      },
      async b() {
        signalStates.push(this.$signal.aborted)
        await sleep(10)
        signalStates.push(this.$signal.aborted)
        return "b done"
      },
    })

    expect(signalStates).toEqual([false, false])
    expect(result.b).toEqual({ status: "fulfilled", value: "b done" })
  })

  it("applies wrap middleware around allSettled execution", async () => {
    let wrapCalls = 0

    const result = await try$
      .wrap((ctx, next) => {
        wrapCalls += 1
        expect(ctx.retry.attempt).toBe(1)
        return next()
      })
      .allSettled({
        fail() {
          throw new Error("boom")
        },
        ok() {
          return 1
        },
      })

    expect(result.ok).toEqual({ status: "fulfilled", value: 1 })
    expect(result.fail.status).toBe("rejected")
    expect(wrapCalls).toBe(1)
  })

  it("runs wrap promise cleanup when allSettled() starts with an already-aborted signal", async () => {
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
        .allSettled({
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

    const pending = try$.signal(controller.signal).allSettled({
      async a() {
        await sleep(20)

        if (this.$signal.aborted) {
          throw this.$signal.reason
        }

        return 1
      },
      async b() {
        await sleep(25)

        if (this.$signal.aborted) {
          throw this.$signal.reason
        }

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

  it("holds cancellation until non-cooperative tasks settle", async () => {
    const controller = new AbortController()
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
    controller.abort(new Error("stop"))

    const observed = pending.then(
      () => "resolved" as const,
      (error: unknown) => error
    )
    const outcome = await Promise.race([observed, sleep(0).then(() => "blocked" as const)])

    // The orchestration must stay pending while the task is still running.
    expect(outcome).toBe("blocked")

    releaseTask()
    await finished

    expect(await observed).toBeInstanceOf(CancellationError)
  })

  it("runs disposer cleanup after all tasks settle", async () => {
    let cleaned = false

    await try$.allSettled({
      a() {
        this.$disposer.defer(() => {
          cleaned = true
        })
        return 1
      },
      b() {
        throw new Error("boom")
      },
    })

    expect(cleaned).toBe(true)
  })

  it("runs disposer cleanup for both fulfilled and rejected tasks without external signals", async () => {
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
        throw new Error("boom")
      },
    })

    expect(result.a).toEqual({ status: "fulfilled", value: 1 })
    expect(result.b.status).toBe("rejected")
    expect(cleanedA).toBe(true)
    expect(cleanedB).toBe(true)
  })

  it("rejects with TimeoutError when the graph deadline fires", async () => {
    try {
      await try$.timeout(10).allSettled({
        async a() {
          await sleep(40)
          return "late" as const
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError)
    }
  })

  it("waits for in-flight tasks to settle before rejecting on the graph deadline", async () => {
    let taskSettled = false

    try {
      await try$.timeout(10).allSettled({
        async a() {
          await sleep(40)
          taskSettled = true
          return "late" as const
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError)
    }

    expect(taskSettled).toBe(true)
  })

  it("waits for in-flight tasks to settle before rejecting on cancellation", async () => {
    const controller = new AbortController()
    let taskSettled = false

    setTimeout(() => {
      controller.abort(new Error("stop"))
    }, 5)

    try {
      await try$.signal(controller.signal).allSettled({
        async a() {
          await sleep(30)
          taskSettled = true
          return 1
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
    }

    expect(taskSettled).toBe(true)
  })
})
