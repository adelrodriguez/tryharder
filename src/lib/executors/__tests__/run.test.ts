import { describe, expect, it } from "bun:test"
import type { TryCtx } from "../../types/core"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../../errors"
import { sleep } from "../../utils"
import { executeRun } from "../run"

describe("executeRun", () => {
  describe("function form", () => {
    it("returns resolved value when function form is async", async () => {
      const result = executeRun({}, async () => {
        await Promise.resolve()
        return "ok" as const
      })

      expect(await result).toBe("ok")
    })

    it("maps rejected value to UnhandledException in async function form", async () => {
      const result = executeRun({}, async () => {
        await Promise.resolve()
        throw new Error("boom")
      })

      expect(await result).toBeInstanceOf(UnhandledException)
    })
  })

  describe("object form", () => {
    it("maps async try rejection through catch in object form", async () => {
      const result = executeRun(
        {},
        {
          catch: () => "mapped",
          try: async () => {
            await Promise.resolve()
            throw new Error("boom")
          },
        }
      )

      expect(await result).toBe("mapped")
    })

    it("throws Panic when async catch rejects", async () => {
      const result = executeRun(
        {},
        {
          catch: async () => {
            await Promise.resolve()
            throw new Error("catch failed")
          },
          try: async () => {
            await Promise.resolve()
            throw new Error("boom")
          },
        }
      )

      try {
        await result
        throw new Error("Expected Panic rejection")
      } catch (error) {
        expect(error).toBeInstanceOf(Panic)
        expect((error as Panic).code).toBe("RUN_CATCH_HANDLER_REJECT")
      }
    })

    it("returns RetryExhaustedError and skips catch when retries are exhausted", async () => {
      let attempts = 0
      let mapped = false
      const cause = new Error("boom")

      const result = (await executeRun(
        {
          retry: { backoff: "constant", delayMs: 0, limit: 2 },
        },
        {
          catch: () => {
            mapped = true
            return "mapped"
          },
          try: async () => {
            await Promise.resolve()
            attempts += 1
            throw cause
          },
        }
      )) as unknown as object

      expect(result).toBeInstanceOf(RetryExhaustedError)

      if (!(result instanceof RetryExhaustedError)) {
        expect.unreachable("should return RetryExhaustedError")
      }

      expect(result.cause).toBe(cause)
      expect(attempts).toBe(2)
      expect(mapped).toBe(false)
    })
  })

  describe("timeout behavior", () => {
    it("returns TimeoutError when timeout expires during try execution", async () => {
      const result = await executeRun(
        {
          timeout: 5,
        },
        async () => {
          await sleep(20)
          return "never"
        }
      )

      expect(result).toBeInstanceOf(TimeoutError)
    })

    it("aborts ctx.signal when timeout expires", async () => {
      const result = await executeRun(
        {
          timeout: 5,
        },
        async (ctx: TryCtx) => {
          await new Promise((_resolve, reject) => {
            ctx.signal?.addEventListener(
              "abort",
              () => {
                reject(new Error("aborted by timeout"))
              },
              { once: true }
            )
          })

          return "ok"
        }
      )

      expect(result).toBeInstanceOf(TimeoutError)
    })

    it("returns TimeoutError when timeout expires during retry backoff", async () => {
      const result = await executeRun(
        {
          retry: { backoff: "constant", delayMs: 50, limit: 3 },
          timeout: 5,
        },
        () => {
          throw new Error("boom")
        }
      )

      expect(result).toBeInstanceOf(TimeoutError)
    })

    it("returns TimeoutError when timeout expires during catch execution", async () => {
      const result = await executeRun(
        {
          timeout: 5,
        },
        {
          catch: async () => {
            await sleep(20)
            return "mapped"
          },
          try: () => {
            throw new Error("boom")
          },
        }
      )

      expect(result).toBeInstanceOf(TimeoutError)
    })
  })

  describe("cancellation behavior", () => {
    it("returns CancellationError when signal aborts during async try", async () => {
      const ac = new AbortController()

      const pending = executeRun({ signals: [ac.signal] }, async () => {
        await sleep(25)
        return "ok"
      })

      setTimeout(() => {
        ac.abort(new Error("stop"))
      }, 5)

      const result = await pending

      expect(result).toBeInstanceOf(CancellationError)
    })

    it("returns CancellationError when one of many signals aborts during async run", async () => {
      const first = new AbortController()
      const second = new AbortController()

      const pending = executeRun({ signals: [first.signal, second.signal] }, async () => {
        await sleep(25)
        return "ok"
      })

      setTimeout(() => {
        second.abort(new Error("stop"))
      }, 5)

      const result = await pending

      expect(result).toBeInstanceOf(CancellationError)
    })

    it("returns CancellationError when aborted during retry backoff", async () => {
      const ac = new AbortController()
      let attempts = 0

      const pending = executeRun(
        {
          retry: { backoff: "constant", delayMs: 50, limit: 3 },
          signals: [ac.signal],
        },
        () => {
          attempts += 1
          throw new Error("boom")
        }
      )

      setTimeout(() => {
        ac.abort(new Error("stop"))
      }, 5)

      const result = await pending

      expect(result).toBeInstanceOf(CancellationError)
      expect(attempts).toBe(1)
    })

    it("prefers cancellation over timeout when abort happens during catch", async () => {
      const ac = new AbortController()

      const pending = executeRun(
        {
          signals: [ac.signal],
          timeout: 50,
        },
        {
          catch: async () => {
            await sleep(20)
            return "mapped"
          },
          try: () => {
            throw new Error("boom")
          },
        }
      )

      setTimeout(() => {
        ac.abort(new Error("cancelled"))
      }, 5)

      const result = await pending

      expect(result).toBeInstanceOf(CancellationError)
    })
  })

  describe("wrap behavior", () => {
    it("runs wraps once when retries are handled asynchronously", async () => {
      let wrapCalls = 0
      let attempts = 0

      const result = await executeRun(
        {
          retry: { backoff: "constant", delayMs: 1, limit: 3 },
          wraps: [
            (ctx, next) => {
              wrapCalls += 1
              return next()
            },
          ],
        },
        async (ctx: TryCtx) => {
          attempts += 1

          if (attempts === 1) {
            throw new Error("boom")
          }

          await Promise.resolve()
          return ctx.retry.attempt
        }
      )

      expect(result).toBe(2)
      expect(wrapCalls).toBe(1)
      expect(attempts).toBe(2)
    })

    it("keeps wrap scope around timeout during async retry backoff", async () => {
      const events: string[] = []

      const result = await executeRun(
        {
          retry: { backoff: "constant", delayMs: 50, limit: 3 },
          timeout: 5,
          wraps: [
            async (ctx, next) => {
              events.push(`before:${ctx.retry.attempt}`)
              const value = await next()
              events.push(`after:${ctx.retry.attempt}`)
              return value
            },
          ],
        },
        () => {
          throw new Error("boom")
        }
      )

      expect(result).toBeInstanceOf(TimeoutError)
      expect(events).toEqual(["before:1", "after:1"])
    })
  })
})
