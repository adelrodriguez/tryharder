import { describe, expect, it } from "bun:test"
import type { TryCtx } from "../types/core"
import { CancellationError, Panic, TimeoutError, UnhandledException } from "../errors"
import { executeRunAsync, executeRunSync } from "../runner"

describe("executeRunSync / executeRunAsync", () => {
  describe("sync", () => {
    it("returns success value in function form", () => {
      const result = executeRunSync({}, () => "ok" as const)

      expect(result).toBe("ok")
    })

    it("returns UnhandledException when function form throws", () => {
      const result = executeRunSync({}, () => {
        throw new Error("boom")
      })

      expect(result).toBeInstanceOf(UnhandledException)
    })

    it("maps errors in object form with try and catch", () => {
      const result = executeRunSync(
        {},
        {
          catch: () => "mapped" as const,
          try: () => {
            throw new Error("boom")
          },
        }
      )

      expect(result).toBe("mapped")
    })

    it("throws Panic when catch throws", () => {
      expect(() =>
        executeRunSync(
          {},
          {
            catch: () => {
              throw new Error("catch failed")
            },
            try: () => {
              throw new Error("boom")
            },
          }
        )
      ).toThrow(Panic)
    })

    it("passes normalized context to try", () => {
      const result = executeRunSync(
        {
          retry: { backoff: "constant", limit: 3 },
        },
        (ctx: TryCtx) => ({
          attempt: ctx.retry.attempt,
          hasSignal: Boolean(ctx.signal),
          limit: ctx.retry.limit,
        })
      )

      expect(result).toEqual({
        attempt: 1,
        hasSignal: false,
        limit: 3,
      })
    })

    it("throws Panic when sync runner returns a promise via unsafe cast", () => {
      const unsafeSyncFn = (() => Promise.resolve("ok")) as unknown as () => string

      expect(() => executeRunSync({}, unsafeSyncFn)).toThrow(Panic)
    })

    it("returns CancellationError when signal is already aborted", () => {
      const ac = new AbortController()
      ac.abort(new Error("stop"))

      const result = executeRunSync({ signal: ac.signal }, () => "ok")

      expect(result).toBeInstanceOf(CancellationError)
    })

    it("prefers CancellationError over TimeoutError when both are already true", () => {
      const ac = new AbortController()
      ac.abort(new Error("stop"))

      const result = executeRunSync(
        {
          signal: ac.signal,
          timeout: { ms: 0, scope: "total" },
        },
        () => "ok"
      )

      expect(result).toBeInstanceOf(CancellationError)
    })

    it("applies wraps in registration order around full run", () => {
      const events: string[] = []
      let attempts = 0

      const result = executeRunSync(
        {
          retry: { backoff: "constant", limit: 3 },
          wraps: [
            (ctx, next) => {
              events.push(`outer:before:${ctx.retry.attempt}`)
              const value = next(ctx)
              events.push(`outer:after:${ctx.retry.attempt}`)
              return value
            },
            (ctx, next) => {
              events.push(`inner:before:${ctx.retry.attempt}`)
              const value = next(ctx)
              events.push(`inner:after:${ctx.retry.attempt}`)
              return value
            },
          ],
        },
        (ctx: TryCtx) => {
          attempts += 1
          events.push(`try:${ctx.retry.attempt}`)

          if (attempts < 3) {
            throw new Error("boom")
          }

          return "ok"
        }
      )

      expect(result).toBe("ok")
      expect(attempts).toBe(3)
      expect(events).toEqual([
        "outer:before:1",
        "inner:before:1",
        "try:1",
        "try:2",
        "try:3",
        "inner:after:3",
        "outer:after:3",
      ])
    })
  })

  describe("async", () => {
    it("returns resolved value when function form is async", async () => {
      const result = executeRunAsync({}, async () => {
        await Promise.resolve()

        return "ok" as const
      })

      expect(await result).toBe("ok")
    })

    it("maps rejected value to UnhandledException in async function form", async () => {
      const result = executeRunAsync({}, async () => {
        await Promise.resolve()
        throw new Error("boom")
      })

      expect(await result).toBeInstanceOf(UnhandledException)
    })

    it("maps async try rejection through catch in object form", async () => {
      const result = executeRunAsync(
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
      const result = executeRunAsync(
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
      }
    })

    it("returns TimeoutError when timeout expires during try execution", async () => {
      const result = await executeRunAsync(
        {
          timeout: { ms: 5, scope: "total" },
        },
        async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 20)
          })
          return "never"
        }
      )

      expect(result).toBeInstanceOf(TimeoutError)
    })

    it("aborts ctx.signal when timeout expires", async () => {
      const result = await executeRunAsync(
        {
          timeout: { ms: 5, scope: "total" },
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
      const result = await executeRunAsync(
        {
          retry: { backoff: "constant", delayMs: 50, limit: 3 },
          timeout: { ms: 5, scope: "total" },
        },
        () => {
          throw new Error("boom")
        }
      )

      expect(result).toBeInstanceOf(TimeoutError)
    })

    it("returns TimeoutError when timeout expires during catch execution", async () => {
      const result = await executeRunAsync(
        {
          timeout: { ms: 5, scope: "total" },
        },
        {
          catch: async () => {
            await new Promise((resolve) => {
              setTimeout(resolve, 20)
            })
            return "mapped"
          },
          try: () => {
            throw new Error("boom")
          },
        }
      )

      expect(result).toBeInstanceOf(TimeoutError)
    })

    it("returns CancellationError when signal aborts during async try", async () => {
      const ac = new AbortController()

      const pending = executeRunAsync({ signal: ac.signal }, async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 25)
        })
        return "ok"
      })

      setTimeout(() => {
        ac.abort(new Error("stop"))
      }, 5)

      const result = await pending

      expect(result).toBeInstanceOf(CancellationError)
    })

    it("runs wraps once when retries are handled asynchronously", async () => {
      let wrapCalls = 0
      let attempts = 0

      const result = await executeRunAsync(
        {
          retry: { backoff: "constant", delayMs: 1, limit: 3 },
          wraps: [
            (ctx, next) => {
              wrapCalls += 1
              return next(ctx)
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

      const result = await executeRunAsync(
        {
          retry: { backoff: "constant", delayMs: 50, limit: 3 },
          timeout: { ms: 5, scope: "total" },
          wraps: [
            async (ctx, next) => {
              events.push(`before:${ctx.retry.attempt}`)
              const value = await next(ctx)
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
