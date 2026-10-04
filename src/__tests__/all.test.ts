import { runInNewContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"
import { CancellationError, TimeoutError, UnhandledException } from "../errors"
import * as try$ from "../index"
import { expectPanic, sleep } from "./test-utils"

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    signal.addEventListener(
      "abort",
      () => {
        resolve()
      },
      { once: true }
    )
  })
}

function never(): Promise<never> {
  return new Promise(() => {
    // Never settles.
  })
}

describe("all", () => {
  it("returns empty object when task map is empty", async () => {
    const result = await try$.all({})

    expect(result).toEqual({})
  })

  it("starts every task before any task finishes and returns resolved values", async () => {
    const events: string[] = []

    const result = await try$.all({
      async a() {
        events.push("a:start")
        await Promise.resolve()
        events.push("a:end")
        return 1
      },
      async b() {
        events.push("b:start")
        await Promise.resolve()
        events.push("b:end")
        return "ok"
      },
    })

    expect(events).toEqual(["a:start", "b:start", "a:end", "b:end"])
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

  it("rejects with the first task failure when several tasks fail", async () => {
    const first = new Error("first")
    const second = new Error("second")

    try {
      await try$.all({
        a() {
          throw first
        },
        async b() {
          await Promise.resolve()
          throw second
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(first)
    }
  })

  it("aborts sibling signals with the failure and waits for siblings to settle before rejecting", async () => {
    vi.useFakeTimers()

    try {
      const boom = new Error("boom")
      let siblingAbortReason: unknown
      let siblingSettled = false
      let settled = false

      const promise = try$
        .all({
          a() {
            throw boom
          },
          async b() {
            await waitForAbort(this.$signal)
            siblingAbortReason = this.$signal.reason
            await sleep(5)
            siblingSettled = true
            return 2
          },
        })
        .then(
          () => "resolved" as const,
          (error: unknown) => error
        )
        .finally(() => {
          settled = true
        })

      await vi.advanceTimersByTimeAsync(0)
      expect(siblingAbortReason).toBe(boom)
      expect(siblingSettled).toBe(false)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(5)
      const result = await promise

      expect(result).toBe(boom)
      expect(siblingSettled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("aborts dependency waiters when a sibling task fails", async () => {
    const boom = new Error("boom")
    let dependencyError: unknown
    let signalAbortedWhileWaiting = false

    try {
      await try$.all({
        a() {
          throw boom
        },
        async b() {
          try {
            await this.$result.a
            return 2
          } catch (error) {
            dependencyError = error
            signalAbortedWhileWaiting = this.$signal.aborted
            throw error
          }
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(boom)
    }

    expect(dependencyError).toBe(boom)
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
      expectPanic(error, "TASK_INVALID_HANDLER")
      expect((error as Error).message).toBe('Task "a" is not a function')
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

  it.each([undefined, null])(
    "keeps a first task failure of %s when a later task also fails",
    async (reason) => {
      let failedTask: string | undefined

      const result = await try$.all(
        {
          first() {
            // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Task failures can be any JavaScript value.
            throw reason
          },
          second() {
            throw new Error("later failure")
          },
        },
        {
          catch(error, ctx) {
            failedTask = ctx.failedTask
            return error
          },
        }
      )

      expect(failedTask).toBe("first")
      expect(result).toBeInstanceOf(UnhandledException)
      expect((result as UnhandledException).cause).toBe(reason)
    }
  )

  it("keeps a task result named __proto__ as an own property", async () => {
    const value = { answer: 42 }

    const result = await try$.all({
      ["__proto__"]() {
        return value
      },
    })

    expect(Object.hasOwn(result, "__proto__")).toBe(true)
    expect(Object.getOwnPropertyDescriptor(result, "__proto__")?.value).toBe(value)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  it("passes catch a partial result named __proto__ as an own property", async () => {
    const value = { answer: 42 }
    const boom = new Error("boom")

    const partial = await try$.all(
      {
        ["__proto__"]() {
          return value
        },
        async failing() {
          await Promise.resolve()
          throw boom
        },
      },
      {
        catch(_error, ctx) {
          return ctx.partial
        },
      }
    )

    expect(Object.hasOwn(partial, "__proto__")).toBe(true)
    expect(Object.getOwnPropertyDescriptor(partial, "__proto__")?.value).toBe(value)
  })

  it("maps non-Error task failures before rejecting dependent tasks", async () => {
    let dependencyError: unknown

    try {
      await try$.all({
        async a() {
          await Promise.resolve()
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

  it("maps the failure through catch with the failed task, partial results, and aborted signal", async () => {
    const boom = new Error("boom")
    const catchErrors: unknown[] = []

    const result = await try$.all(
      {
        a() {
          return 1
        },
        async b() {
          await this.$result.a
          throw boom
        },
        async c() {
          await waitForAbort(this.$signal)
          throw this.$signal.reason
        },
      },
      {
        catch: (error, ctx) => {
          catchErrors.push(error)

          return {
            aborted: ctx.signal.aborted,
            failedTask: ctx.failedTask,
            partial: { ...ctx.partial },
            reason: ctx.signal.reason as unknown,
          }
        },
      }
    )

    expect(result).toEqual({
      aborted: true,
      failedTask: "b",
      partial: { a: 1 },
      reason: boom,
    })
    expect(catchErrors).toHaveLength(1)
    expect(catchErrors[0]).toBe(boom)
  })

  it("throws a task Panic without passing it through the catch option", async () => {
    const catchErrors: unknown[] = []

    try {
      await try$.all(
        {
          async a() {
            return await (this.$result as Record<string, Promise<unknown>>).a
          },
        },
        {
          catch: (error) => {
            catchErrors.push(error)
            return "mapped" as const
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_SELF_REFERENCE")
    }

    expect(catchErrors).toEqual([])
  })

  it("throws a Panic from another copy of tryharder without passing it through catch", async () => {
    const foreignPanic = Object.assign(new Error("foreign panic"), {
      code: "TASK_SELF_REFERENCE",
      name: "Panic",
    })
    const catchErrors: unknown[] = []

    await expect(
      try$.all(
        {
          a() {
            throw foreignPanic
          },
        },
        {
          catch: (error) => {
            catchErrors.push(error)
            return "mapped" as const
          },
        }
      )
    ).rejects.toBe(foreignPanic)
    expect(catchErrors).toEqual([])
  })

  it("throws a cross-realm Panic without passing it through catch", async () => {
    const foreignPanic: unknown = runInNewContext(
      'Object.assign(new Error("foreign panic"), { code: "TASK_SELF_REFERENCE", name: "Panic" })'
    )
    const catchErrors: unknown[] = []

    await expect(
      try$.all(
        {
          a() {
            throw foreignPanic
          },
        },
        {
          catch: (error) => {
            catchErrors.push(error)
            return "mapped" as const
          },
        }
      )
    ).rejects.toBe(foreignPanic)
    expect(catchErrors).toEqual([])
  })

  it("throws a task Panic even when cancellation fires while siblings settle", async () => {
    const controller = new AbortController()

    try {
      await try$.signal(controller.signal).all({
        async a() {
          return await (this.$result as Record<string, Promise<unknown>>).a
        },
        async b() {
          await waitForAbort(this.$signal)
          controller.abort(new Error("stop"))
          await Promise.resolve()
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_SELF_REFERENCE")
    }
  })

  it("throws a Panic from a sibling that settles after catch mapped an earlier failure", async () => {
    const release = Promise.withResolvers<boolean>()

    try {
      await try$.all(
        {
          a() {
            throw new Error("boom")
          },
          async b() {
            await release.promise
            return await (this.$result as Record<string, Promise<unknown>>).missing
          },
        },
        {
          catch: () => {
            release.resolve(true)
            return "mapped" as const
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TASK_UNKNOWN_REFERENCE")
    }
  })

  it("passes catch a partial snapshot that does not change when siblings settle later", async () => {
    const boom = new Error("boom")
    const release = Promise.withResolvers<boolean>()
    const lateSettled = Promise.withResolvers<boolean>()

    const result = await try$.all(
      {
        a() {
          return 1
        },
        async b() {
          await this.$result.a
          throw boom
        },
        async c() {
          await release.promise
          lateSettled.resolve(true)
          return 3
        },
      },
      {
        catch: async (_, ctx) => {
          release.resolve(true)
          await lateSettled.promise
          await Promise.resolve()
          return ctx.partial
        },
      }
    )

    expect(result).toEqual({ a: 1 })
  })

  it("awaits an async catch and returns its mapped value", async () => {
    const boom = new Error("boom")

    const result = await try$.all(
      {
        a() {
          throw boom
        },
      },
      {
        catch: async (failure) => {
          await Promise.resolve()
          return { mapped: failure }
        },
      }
    )

    expect(result).toEqual({ mapped: boom })
    expect((result as { mapped: unknown }).mapped).toBe(boom)
  })

  it("throws Panic when all catch throws", async () => {
    const catchFailure = new Error("catch failed")

    try {
      await try$.all(
        {
          a() {
            throw new Error("boom")
          },
        },
        {
          catch: () => {
            throw catchFailure
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "ALL_CATCH_HANDLER_THROW")
      expect((error as Error).cause).toBe(catchFailure)
    }
  })

  it("throws Panic when all catch rejects", async () => {
    const catchFailure = new Error("catch failed")

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
            throw catchFailure
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "ALL_CATCH_HANDLER_REJECT")
      expect((error as Error).cause).toBe(catchFailure)
    }
  })

  it("throws Panic when catch rejects with a CancellationError that no signal caused", async () => {
    const cancellation = new CancellationError()

    try {
      await try$.all(
        {
          a() {
            throw new Error("boom")
          },
        },
        {
          catch: () => Promise.reject(cancellation),
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "ALL_CATCH_HANDLER_REJECT")
      expect((error as Error).cause).toBe(cancellation)
    }
  })

  it("rejects with CancellationError when the signal aborts while an async catch is pending", async () => {
    const controller = new AbortController()
    const reason = new Error("stop")

    try {
      await try$.signal(controller.signal).all(
        {
          a() {
            throw new Error("boom")
          },
        },
        {
          catch: () => {
            queueMicrotask(() => {
              controller.abort(reason)
            })
            return never()
          },
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
      expect((error as CancellationError).cause).toBe(reason)
    }
  })

  it("rejects before running tasks and still runs wrap cleanup when the signal is already aborted", async () => {
    const controller = new AbortController()
    const reason = new Error("stop")
    let cleaned = false
    let taskCalls = 0

    controller.abort(reason)

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
            taskCalls += 1
            return 1
          },
        })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
      expect((error as CancellationError).cause).toBe(reason)
    }

    expect(cleaned).toBe(true)
    expect(taskCalls).toBe(0)
  })

  it("aborts the task signal and rejects with CancellationError when the builder signal aborts", async () => {
    const controller = new AbortController()
    const reason = new Error("stop")
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let taskAbortReason: unknown

    const pending = try$.signal(controller.signal).all({
      async a() {
        markStarted()
        await waitForAbort(this.$signal)
        taskAbortReason = this.$signal.reason
        throw this.$signal.reason
      },
    })

    await started
    controller.abort(reason)

    try {
      await pending
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
      expect((error as CancellationError).cause).toBe(reason)
    }

    expect(taskAbortReason).toBe(reason)
  })

  it("runs disposer cleanup even on failure", async () => {
    const boom = new Error("boom")
    let cleaned = false

    try {
      await try$.all({
        a() {
          this.$disposer.defer(() => {
            cleaned = true
          })
          throw boom
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(boom)
    }

    expect(cleaned).toBe(true)
  })

  it("aborts the task signal with the TimeoutError it rejects with when the graph deadline fires", async () => {
    vi.useFakeTimers()

    try {
      let abortReason: unknown

      const promise = try$
        .timeout(10)
        .all({
          async a() {
            await waitForAbort(this.$signal)
            abortReason = this.$signal.reason
            throw this.$signal.reason
          },
        })
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => error
        )

      await vi.advanceTimersByTimeAsync(10)
      const error = await promise

      expect(error).toBeInstanceOf(TimeoutError)
      expect(error).toBe(abortReason)
    } finally {
      vi.useRealTimers()
    }
  })

  it("prefers cancellation over the graph deadline when both fire in flight", async () => {
    vi.useFakeTimers()

    try {
      const controller = new AbortController()

      setTimeout(() => {
        controller.abort(new Error("stop"))
      }, 10)

      const promise = try$
        .signal(controller.signal)
        .timeout(30)
        .all({
          async a() {
            await sleep(60)
            return 1
          },
        })
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => error
        )

      await vi.advanceTimersByTimeAsync(60)
      const error = await promise

      expect(error).toBeInstanceOf(CancellationError)
    } finally {
      vi.useRealTimers()
    }
  })

  it("prefers cancellation even when it fires after the graph deadline", async () => {
    vi.useFakeTimers()

    try {
      const controller = new AbortController()
      const reason = new Error("stop")
      let deadlineReason: unknown
      let taskSettled = false

      const promise = try$
        .signal(controller.signal)
        .timeout(10)
        .all({
          async a() {
            // The deadline fires first, cancellation second, and arbitration
            // happens only once this task settles.
            await waitForAbort(this.$signal)
            deadlineReason = this.$signal.reason
            controller.abort(reason)
            await Promise.resolve()
            taskSettled = true
            return 1
          },
        })
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => error
        )

      await vi.advanceTimersByTimeAsync(10)
      const error = await promise

      expect(error).toBeInstanceOf(CancellationError)
      expect((error as CancellationError).cause).toBe(reason)
      expect(deadlineReason).toBeInstanceOf(TimeoutError)
      expect(taskSettled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("prefers cancellation over the graph deadline when both are tripped before execution", async () => {
    const controller = new AbortController()

    controller.abort(new Error("stop"))

    try {
      await try$
        .signal(controller.signal)
        .timeout(0)
        .all({
          a() {
            return 1
          },
        })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError)
    }
  })

  it("bounds the deadline with $race for signal-unaware work", async () => {
    vi.useFakeTimers()

    try {
      let racedRejection: unknown

      const promise = try$
        .timeout(10)
        .all({
          async a() {
            try {
              // Never settles: without $race the task would never settle.
              await this.$race(never())
              return "late" as const
            } catch (error) {
              racedRejection = error
              throw error
            }
          },
        })
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => error
        )

      await vi.advanceTimersByTimeAsync(10)
      const error = await promise

      expect(error).toBeInstanceOf(TimeoutError)
      expect(racedRejection).toBe(error)
    } finally {
      vi.useRealTimers()
    }
  })

  it("passes values and failures through $race when the signal stays quiet", async () => {
    const boom = new Error("boom")

    const result = await try$.all({
      async a() {
        return await this.$race(Promise.resolve(1))
      },
    })

    expect(result).toEqual({ a: 1 })

    try {
      await try$.all({
        async b() {
          return await this.$race(Promise.reject(boom))
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(boom)
    }
  })

  it("rejects $race with the sibling failure that aborted the task signal", async () => {
    const boom = new Error("boom")
    let racedRejection: unknown

    try {
      await try$.all({
        a() {
          throw boom
        },
        async b() {
          try {
            // Never settles: $race must reject via the aborted task signal.
            await this.$race(never())
          } catch (error) {
            racedRejection = error
            throw error
          }
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(boom)
    }

    expect(racedRejection).toBe(boom)
  })

  it("normalizes an undefined sibling failure observed through $race", async () => {
    let racedRejection: unknown

    try {
      await try$.all({
        a() {
          // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Intentional coverage for undefined task failures.
          throw undefined
        },
        async b() {
          try {
            // Never settles: $race must reject via the aborted task signal.
            await this.$race(never())
          } catch (error) {
            racedRejection = error
            throw error
          }
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(UnhandledException)
      expect((error as UnhandledException).cause).toBeUndefined()
    }

    expect(racedRejection).toBeInstanceOf(UnhandledException)
    expect((racedRejection as UnhandledException).cause).toBeUndefined()
  })

  it("does not pass failures caused by the graph deadline through the catch option", async () => {
    vi.useFakeTimers()

    try {
      let catchCalls = 0
      let taskObservedAbort = false

      const promise = try$
        .timeout(10)
        .all(
          {
            async a() {
              await waitForAbort(this.$signal)
              taskObservedAbort = true
              throw new Error("boom")
            },
          },
          {
            catch: () => {
              catchCalls += 1
              return "mapped" as const
            },
          }
        )
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => error
        )

      await vi.advanceTimersByTimeAsync(10)
      const error = await promise

      expect(error).toBeInstanceOf(TimeoutError)
      expect(taskObservedAbort).toBe(true)
      expect(catchCalls).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("reports the graph deadline instead of calling catch when a task fails after the deadline elapsed", async () => {
    vi.useFakeTimers()

    try {
      const boom = new Error("boom")
      let catchCalls = 0

      const error = await try$
        .timeout(10)
        .all(
          {
            async a() {
              await Promise.resolve()
              // The deadline elapses, but its fake timer never fires before the failure is mapped.
              vi.setSystemTime(Date.now() + 20)
              throw boom
            },
          },
          {
            catch: () => {
              catchCalls += 1
              return "mapped" as const
            },
          }
        )
        .then(
          () => expect.unreachable("should have thrown"),
          (error: unknown) => error
        )

      expect(error).toBeInstanceOf(TimeoutError)
      expect((error as TimeoutError).cause).toBe(boom)
      expect(catchCalls).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
